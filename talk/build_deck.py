"""Builds harness-engineering-live.pptx from outline.md on the AWS Dev Day theme.

Usage (from talk/):
  python3 -m venv .venv && .venv/bin/pip install python-pptx==1.0.2 "qrcode[pil]==8.0"
  .venv/bin/python -I build_deck.py [--form-url URL] [--repo-url URL]

Without a URL, its QR code is replaced by a highlighted [[FORM URL]] / [[REPO URL]] placeholder.
"""
import argparse
import io
import json
import re
from pathlib import Path

import qrcode
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

HERE = Path(__file__).parent
TEMPLATE = HERE / "theme" / "aws-dev-day-template.pptx"
OUT = HERE / "harness-engineering-live.pptx"

# Theme colours (theme1.xml): the slides are dark, text is white.
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
PANEL = RGBColor(0x16, 0x1D, 0x26)
MUTED = RGBColor(0x8A, 0x94, 0xA6)
BLUE = RGBColor(0x41, 0xB3, 0xFF)
PURPLE = RGBColor(0xAD, 0x5C, 0xFF)
GREEN = RGBColor(0x00, 0xE5, 0x00)
PINK = RGBColor(0xFF, 0x5C, 0x85)
ORANGE = RGBColor(0xFF, 0x69, 0x3C)
YELLOW = RGBColor(0xFB, 0xD3, 0x32)

# Template slides: 1-2 event branding, 3 title, 4 agenda, 5-10 old samples, 11 Builder Center, 12 Thank you.
KEEP_START, TITLE, AGENDA, SAMPLES, KEEP_END = (0, 1), 2, 3, range(4, 10), (10, 11)


# ---------- facts from the code ----------
# The deck states numbers the code decides. They are read here, not typed into slides, so the build fails instead of
# the talk drifting: %tests%, %golden%, %scan_mb%, %grounding% and %attempts% in outline.md or below.

ROOT = HERE.parent


def facts():
    def find(path, pattern, convert=lambda m: m[1]):
        text = (ROOT / path).read_text(encoding="utf-8")
        m = re.search(pattern, text)
        if not m:
            raise SystemExit(f"fact not found: /{pattern}/ in {path}")
        return convert(m)

    tests = sum(len(re.findall(r"^\s*test\(", f.read_text(encoding="utf-8"), re.M))
                for f in ROOT.glob("packages/*/test/*.ts*"))
    return {
        "tests": str(tests),
        "golden": str(len(json.loads((ROOT / "golden/questions.json").read_text(encoding="utf-8")))),
        "scan_mb": find("infra/lakehouse.tf", r"bytes_scanned_cutoff_per_query\s*=\s*(\d+)", lambda m: str(int(m[1]) // 1048576)),
        "grounding": find("infra/api.tf", r'variable "grounding_threshold"[^}]*default\s*=\s*([\d.]+)'),
        "attempts": find("packages/agent/src/output.ts", r"const retries = opts\.retries \?\? (\d+);", lambda m: str(int(m[1]) + 1)),
    }


def fill_facts(prs, values):
    """Replace %fact% tokens in every run, table cell and speaker note; fail on any token left."""
    def runs(slide):
        for sh in slide.shapes:
            frames = [sh.text_frame] if sh.has_text_frame else []
            if sh.has_table:
                frames += [c.text_frame for row in sh.table.rows for c in row.cells]
            for tf in frames:
                for p in tf.paragraphs:
                    yield from p.runs
        if slide.has_notes_slide:
            for p in slide.notes_slide.notes_text_frame.paragraphs:
                yield from p.runs

    for n, slide in enumerate(prs.slides, 1):
        for run in runs(slide):
            text = run.text
            for k, v in values.items():
                text = text.replace(f"%{k}%", v)
            if re.search(r"%[a-z_]+%", text):
                raise SystemExit(f"slide {n}: unknown fact in {text!r}")
            run.text = text


# ---------- outline ----------

def parse_outline(text):
    slides = []
    for chunk in re.split(r"^# Slide: ", text, flags=re.M)[1:]:
        head, _, notes = chunk.partition("\nNotes:\n")
        lines = head.split("\n")
        s = {"title": lines[0].strip(), "meta": {}, "blocks": [[]], "code": None, "notes": notes.strip()}
        in_code = False
        code = []
        for line in lines[1:]:
            if line.startswith("```"):
                if in_code:
                    s["code"] = "\n".join(code)
                in_code = not in_code
                continue
            if in_code:
                code.append(line)
            elif m := re.match(r"^([a-z-]+): (.*)$", line):
                s["meta"][m[1]] = m[2]
            elif line.strip() == "---":
                s["blocks"].append([])
            elif m := re.match(r"^( *)- (.*)$", line):
                s["blocks"][-1].append((len(m[1]) // 2, m[2]))
        slides.append(s)
    return slides


# ---------- helpers ----------

def layout(prs, name):
    for l in prs.slide_layouts:
        if l.name == name:
            return l
    raise KeyError(f"layout {name!r} not in the template")


def ph(slide, idx):
    for p in slide.placeholders:
        if p.placeholder_format.idx == idx:
            return p
    raise KeyError(f"placeholder {idx} not on slide layout {slide.slide_layout.name!r}")


def place(shape, left=None, top=None, width=None, height=None):
    """Resize a placeholder. Its position is inherited from the layout until set, so set all four at once
    (setting one alone writes zeros for the rest)."""
    l, t, w, h = shape.left, shape.top, shape.width, shape.height
    shape.left, shape.top = Inches(left) if left is not None else l, Inches(top) if top is not None else t
    shape.width, shape.height = Inches(width) if width is not None else w, Inches(height) if height is not None else h


def set_bullets(tf, items, size):
    """Explicit sizes: the master's body style is 28 pt with 10 pt before each paragraph, too big for real sentences."""
    tf.clear()
    tf.word_wrap = True
    for i, (level, text) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.level = level
        p.space_before = Pt(size * 0.6)
        r = p.add_run()
        r.text = text
        r.font.size = Pt(size - 2 * level)


def drop_empty_placeholders(slide):
    for p in list(slide.placeholders):
        if p.has_text_frame and not p.text_frame.text.strip():
            p._element.getparent().remove(p._element)


def text_box(slide, x, y, w, h, text, size=14, color=WHITE, bold=False, align=PP_ALIGN.LEFT, font=None):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, line in enumerate(text.split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = align
        r = p.add_run()
        r.text = line
        r.font.size = Pt(size)
        r.font.color.rgb = color
        r.font.bold = bold
        if font:
            r.font.name = font
    return tb


def box(slide, x, y, w, h, title, sub=None, color=BLUE, fill=PANEL, size=14, anchor=MSO_ANCHOR.MIDDLE):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.adjustments[0] = 0.12
    shp.fill.solid()
    shp.fill.fore_color.rgb = fill
    shp.line.color.rgb = color
    shp.line.width = Pt(1.5)
    shp.shadow.inherit = False
    tf = shp.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    for m in ("margin_left", "margin_right"):
        setattr(tf, m, Inches(0.08))
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = title
    r.font.size = Pt(size)
    r.font.bold = True
    r.font.color.rgb = WHITE
    if sub:
        for line in sub.split("\n"):
            q = tf.add_paragraph()
            q.alignment = PP_ALIGN.CENTER
            r = q.add_run()
            r.text = line
            r.font.size = Pt(size - 3)
            r.font.color.rgb = color
    return shp


def arrow(slide, x1, y1, x2, y2, color=MUTED, label=None):
    c = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.line.color.rgb = color
    c.line.width = Pt(1.75)
    ln = c.line._get_or_add_ln()
    tail = ln.makeelement(qn("a:tailEnd"), {"type": "triangle", "w": "med", "len": "med"})
    ln.append(tail)
    if label:
        text_box(slide, min(x1, x2) - 0.2, min(y1, y2) - 0.32, abs(x2 - x1) + 0.4, 0.3, label, size=10, color=MUTED, align=PP_ALIGN.CENTER)
    return c


def qr_or_placeholder(slide, url, label, x, y, size):
    if url:
        img = qrcode.make(url, border=2)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        slide.shapes.add_picture(buf, Inches(x), Inches(y), Inches(size), Inches(size))
        text_box(slide, x - 0.4, y + size + 0.05, size + 0.8, 0.35, url, size=11, color=MUTED, align=PP_ALIGN.CENTER)
    else:
        b = box(slide, x, y, size, size, f"[[{label}]]", "QR code goes here:\nrebuild with --" + label.lower().replace(" ", "-"), color=YELLOW, fill=RGBColor(0x3A, 0x31, 0x08), size=16)
        b.line.dash_style = 4


# ---------- diagrams ----------

# ---------- AWS architecture style: official icons, group boundaries, numbered steps ----------

ICONS = HERE / "theme" / "icons"
TEAL = RGBColor(0x00, 0xA4, 0xA6)


def icon(slide, name, cx, top, label, sub=None, size=0.62, width=1.7):
    """An official AWS icon centred on cx, with its label (and an optional sub-label) underneath."""
    slide.shapes.add_picture(str(ICONS / f"{name}.png"), Inches(cx - size / 2), Inches(top), Inches(size), Inches(size))
    text_box(slide, cx - width / 2, top + size + 0.02, width, 0.3, label, size=12, bold=True, align=PP_ALIGN.CENTER)
    if sub:
        text_box(slide, cx - width / 2, top + size + 0.27, width, 0.4, sub, size=10, color=MUTED, align=PP_ALIGN.CENTER)


def group(slide, x, y, w, h, label, name, color, dashed=False):
    """An AWS group boundary (AWS Cloud, Region): outline, its icon in the top-left corner, the label beside it."""
    shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.fill.background()
    shp.line.color.rgb = color
    shp.line.width = Pt(1.25)
    shp.shadow.inherit = False
    if dashed:
        shp.line.dash_style = 4
    slide.shapes.add_picture(str(ICONS / f"{name}.png"), Inches(x), Inches(y), Inches(0.3), Inches(0.3))
    text_box(slide, x + 0.32, y - 0.02, w - 0.4, 0.3, label, size=11, color=color)


def step(slide, n, cx, cy):
    """A numbered step badge, as in AWS reference architectures; the legend is in the speaker notes."""
    d = 0.3
    c = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(cx - d / 2), Inches(cy - d / 2), Inches(d), Inches(d))
    c.fill.solid()
    c.fill.fore_color.rgb = ORANGE
    c.line.fill.background()
    c.shadow.inherit = False
    tf = c.text_frame
    for m in ("margin_left", "margin_right", "margin_top", "margin_bottom"):
        setattr(tf, m, 0)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = str(n)
    r.font.size = Pt(11)
    r.font.bold = True
    r.font.color.rgb = WHITE


def draw_architecture(s):
    group(s, 1.55, 1.75, 10.4, 5.5, "AWS Cloud", "aws-cloud", WHITE)
    group(s, 1.75, 2.12, 10.0, 5.0, "Region eu-central-1", "region", TEAL, dashed=True)
    c = (2.65, 4.25, 5.85, 7.5, 9.15, 10.75)
    r1, r2, r3, ic = 2.5, 4.15, 5.8, 0.62
    mid = lambda r: r + ic / 2

    icon(s, "mobile", 0.85, r1 + 0.05, "Phone", "QR form", size=0.5, width=1.3)
    icon(s, "user", 0.85, r2 + 0.05, "Presenter", "Approve on the board", size=0.5, width=1.3)
    icon(s, "git", 0.85, r3 + 0.05, "GitHub issue", "after Approve", size=0.5, width=1.3)

    icon(s, "api-gateway", c[0], r1, "API Gateway")
    icon(s, "lambda", c[1], r1, "Adapter", "intake · Approve")
    icon(s, "step-functions", c[2], r1, "Step Functions", "one run per question")
    icon(s, "agentcore", c[3], r1, "Analyst agent", "AgentCore Runtime")
    icon(s, "agentcore", c[4], r1, "AgentCore Gateway", "MCP tools")
    icon(s, "lambda", c[5], r1, "Tools", "3 tools · SQL guard")

    icon(s, "bedrock", c[2], r2, "Guardrails", "contextual grounding")
    icon(s, "agentcore", c[3], r2, "Evidence agent", "AgentCore Runtime")
    icon(s, "cognito", c[4], r2, "Cognito", "JWT for the Gateway")
    icon(s, "athena", c[5], r2, "Athena", "reader role: gold only")

    icon(s, "dynamodb", c[1], r3, "DynamoDB", "questions · task token")
    icon(s, "cloudwatch", c[2], r3, "CloudWatch", "traces · Evaluations")
    icon(s, "bedrock", c[3], r3, "Amazon Bedrock", "Claude, both agents")
    icon(s, "glue-data-catalog", c[4], r3, "Glue Data Catalog", "lakehouse_gold")
    icon(s, "s3", c[5], r3, "Amazon S3", "Iceberg gold views")

    h = ic / 2 + 0.05
    below = r1 + ic + 0.62
    below2 = r2 + ic + 0.62
    arrow(s, 1.1, mid(r1), c[0] - h, mid(r1), BLUE); step(s, 1, 1.75, mid(r1) - 0.25)
    arrow(s, 1.1, mid(r2), c[0] - h + 0.05, r1 + ic - 0.08, YELLOW)
    for i in range(5):
        arrow(s, c[i] + h, mid(r1), c[i + 1] - h, mid(r1), PURPLE if i >= 2 else BLUE)
    step(s, 2, (c[1] + c[2]) / 2, mid(r1) - 0.25)
    step(s, 3, (c[2] + c[3]) / 2, mid(r1) - 0.25)
    step(s, 4, (c[3] + c[4]) / 2, mid(r1) - 0.25)
    arrow(s, c[1], below, c[1], r3 - 0.05, BLUE)
    arrow(s, c[2], below, c[2], r2 - 0.05, ORANGE); step(s, 6, c[2] + 0.25, (below + r2) / 2)
    arrow(s, c[2] + 0.4, below - 0.1, c[3] - h, r2 + 0.1, GREEN); step(s, 7, (c[2] + c[3]) / 2 + 0.15, (below + r2) / 2 + 0.1)
    arrow(s, c[4], below, c[4], r2 - 0.05, MUTED)
    arrow(s, c[5], below, c[5], r2 - 0.05, PURPLE); step(s, 5, c[5] + 0.25, (below + r2) / 2)
    arrow(s, c[3], below2, c[3], r3 - 0.05, MUTED)
    arrow(s, c[5], below2, c[5], r3 - 0.05, PURPLE)
    arrow(s, c[5] - 0.3, below2, c[4] + h, r3 + 0.1, PURPLE)
    arrow(s, c[2] - 0.25, below, 1.15, mid(r3), YELLOW); step(s, 8, 3.2, 4.75)


def draw_medallion(s):
    group(s, 0.6, 1.9, 12.1, 2.05, "Region eu-central-1", "region", TEAL, dashed=True)
    top = 2.45
    steps = (
        ("s3", 1.5, "CSV drop", "S3 data/ · raw files"),
        ("glue", 3.6, "Glue job", "loads once, as-is"),
        ("s3", 5.7, "Bronze", "Iceberg · personal data"),
        ("glue-data-catalog", 7.8, "Gold: sales", "Iceberg materialized view"),
        ("athena", 9.9, "Athena", "reader role: gold only"),
        ("agentcore", 11.8, "Agents", "through the data model"),
    )
    for name, cx, label, sub in steps:
        icon(s, name, cx, top, label, sub, size=0.75)
    for (_, a, *_), (_, b, *_) in zip(steps, steps[1:]):
        arrow(s, a + 0.45, top + 0.37, b - 0.45, top + 0.37, YELLOW if b == 7.8 else MUTED)
    text_box(s, 6.15, top - 0.42, 1.75, 0.35, "Glue refreshes hourly", size=11, color=YELLOW, align=PP_ALIGN.CENTER)
    text_box(s, 0.7, 4.3, 12.0, 0.4, "What you no longer build:", size=14, color=MUTED)
    for i, name in enumerate(("ETL jobs between layers", "An orchestrator", "Change-data-capture code")):
        b = box(s, 0.7 + i * 4.1, 4.8, 3.8, 0.75, "✕  " + name, None, MUTED, size=16)
        b.line.dash_style = 4
    text_box(s, 0.7, 5.9, 12.0, 0.4, "The view's SQL lives in data-model/sales.md: the contract and the build are the same document.", size=13)


def draw_evidence(s):
    box(s, 0.7, 2.6, 2.6, 2.2, "Analyst's answer", "claims\n+ cited SQL\n(not its rows)", PURPLE, size=16)
    steps = ("1  describe_model: is it in the model?", "2  explain_metric: right definition?", "3  query: run it myself")
    box(s, 4.0, 2.0, 4.4, 3.4, "Evidence agent", None, GREEN, size=16, anchor=MSO_ANCHOR.TOP)
    for i, t in enumerate(steps):
        text_box(s, 4.25, 2.6 + i * 0.8, 4.0, 0.5, t, size=16)
    arrow(s, 3.3, 3.7, 4.0, 3.7, GREEN)
    box(s, 9.1, 2.0, 3.6, 1.5, "VERIFIED", "with its own query id\n→ Approve allowed", GREEN, size=18)
    box(s, 9.1, 3.9, 3.6, 1.5, "DENIED", "with the reason on the card\n→ Approve refused (409)", PINK, size=18)
    arrow(s, 8.4, 3.2, 9.1, 2.75, GREEN)
    arrow(s, 8.4, 4.2, 9.1, 4.65, PINK)
    text_box(s, 0.7, 5.85, 12.0, 0.8, "Fails closed: no review, a late review or a malformed review counts as DENIED.\nSame code as the analyst, second AgentCore runtime: AGENT_ROLE=evidence.", size=13, color=MUTED)


def draw_loops(s):
    cols = (
        ("Before merge", "GitHub Actions", ["typecheck + %tests% tests", "guard, contracts, model drift", "next: AWS sample gates PRs", "on Evaluations (< 0.8 blocks)"], BLUE),
        ("Before release", "Golden set", ["%golden% questions, exact answers", "PII and margin must be refused", "scored by AgentCore Evaluations", "dataset evaluations (preview)"], PURPLE),
        ("In production", "Every answer", ["online Evaluations on each trace", "SqlGuard · DataModelCompliance", "evidence agent per claim", "a human presses Approve"], GREEN),
    )
    for i, (when, what, bullets, color) in enumerate(cols):
        x = 0.7 + i * 4.15
        box(s, x, 2.0, 3.75, 0.95, when, what, color, size=18)
        text_box(s, x + 0.1, 3.15, 3.6, 2.6, "\n".join("• " + b for b in bullets), size=15)
        if i < 2:
            arrow(s, x + 3.75, 2.47, x + 4.15, 2.47, MUTED)


ENFORCEMENT = [
    ("Rule", "Prompt", "Tool / guard", "Catalog + IAM", "Contract", "Guardrails", "Evidence agent", "Evaluations"),
    ("Only data-model tables", "✓", "unknown_table", "reader role", "", "", "denies", "SqlGuard"),
    ("No personal data", "✓", "pii_column", "not in gold", "", "", "", "SqlGuard"),
    ("Read-only, bounded", "✓", "select_only, limit", "scan cap", "", "", "", "SqlGuard"),
    ("Numbers come from rows", "✓", "", "", "superRefine ×2", "grounding", "reproduces", "DataModelCompliance"),
    ("Metric definitions", "✓", "explain_metric", "", "", "", "checks", "DataModelCompliance"),
    ("Refuse, don't work around", "✓", "", "", "refusals[]", "", "", "Builtin judges"),
    ("Nothing ships without a human", "", "", "", "", "", "blocks Approve", "board Approve"),
    ("Tool authorization", "✓", "3 tools via Gateway", "JWT, reader role", "", "", "", "next: AgentCore Policy"),
]


def draw_enforcement(s):
    rows, cols = len(ENFORCEMENT), len(ENFORCEMENT[0])
    widths = [2.6, 0.8, 1.6, 1.4, 1.45, 1.15, 1.45, 1.95]
    tbl = s.shapes.add_table(rows, cols, Inches(0.55), Inches(1.95), Inches(sum(widths)), Inches(0.5 * rows)).table
    for c, w in enumerate(widths):
        tbl.columns[c].width = Inches(w)
    for r, row in enumerate(ENFORCEMENT):
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x0B, 0x3B, 0x5C) if r == 0 else PANEL
            cell.text = val
            p = cell.text_frame.paragraphs[0]
            p.alignment = PP_ALIGN.LEFT if c == 0 else PP_ALIGN.CENTER
            for run in p.runs:
                run.font.size = Pt(12)
                run.font.bold = r == 0 or c == 0
                run.font.color.rgb = GREEN if val == "✓" else WHITE


def state(slide, x, y, w, label, sub, color, h=0.95):
    b = box(slide, x, y, w, h, label, sub, color, size=15)
    return b


def draw_workflow(s):
    group(s, 0.6, 1.85, 12.1, 5.25, "AWS Step Functions · Standard workflow · one execution per question", "step-functions", PINK)
    y, w, gap = 2.55, 1.75, 0.27
    xs = [0.85 + i * (w + gap) for i in range(6)]
    happy = (
        ("Answer", "analyst agent\ncontract checked", PURPLE),
        ("Ground", "Guardrails", ORANGE),
        ("Verify", "evidence agent", GREEN),
        ("Wait for decision", "task token · 24 h", YELLOW),
        ("Publish", "re-checks, then\nGitHub comment", BLUE),
    )
    for x, (label, sub, color) in zip(xs, happy):
        state(s, x, y, w, label, sub, color)
    for a, b in zip(xs, xs[1:5]):
        arrow(s, a + w, y + 0.47, b, y + 0.47, MUTED)
    state(s, xs[4], y + 1.45, w, "Reject", "reason on the card", MUTED)
    arrow(s, xs[3] + w, y + 0.75, xs[4], y + 1.75, MUTED)
    text_box(s, xs[3] + 0.1, y - 0.42, w + 1.0, 0.35, "Approve / Reject on the board", size=11, color=YELLOW)
    state(s, xs[2], y + 1.45, w, "Deny", "fail closed", PINK)
    arrow(s, xs[2] + w / 2, y + 0.95, xs[2] + w / 2, y + 1.45, PINK)
    arrow(s, xs[2] + w, y + 1.92, xs[3] + 0.3, y + 0.95, PINK)
    text_box(s, xs[2] - 0.2, y + 2.45, w + 0.4, 0.3, "Verify crashed or timed out", size=10, color=MUTED, align=PP_ALIGN.CENTER)
    state(s, xs[3], y + 2.85, w, "Expire", "reject after 24 h", MUTED)
    arrow(s, xs[3] + w / 2, y + 0.95, xs[3] + w / 2, y + 2.85, MUTED)
    state(s, xs[0], y + 2.85, w * 2 + gap, "Record failure → Failed", "any step, with the reason", PINK)
    arrow(s, xs[0] + w / 2, y + 0.95, xs[0] + w / 2, y + 2.85, PINK)
    text_box(s, 0.85, 6.55, 11.8, 0.45, "Every state has its own timeout. Retries only when Lambda itself is unavailable, never on Publish: nothing is ever posted twice.", size=13, color=MUTED)


WELL_ARCHITECTED = (
    ("Operational excellence", ["Infrastructure in Terraform", "Every run visible in Step Functions", "Online AgentCore Evaluations"]),
    ("Security", ["Reader role sees gold only", "PII never in gold, refused by name", "Gateway behind a Cognito JWT"]),
    ("Reliability", ["A timeout on every state", "Publish never retried: no double posts", "Contract validated twice"]),
    ("Performance efficiency", ["Gold is pre-joined: one table", "Glue refreshes it hourly", "Serverless, per question"]),
    ("Cost optimization", ["%scan_mb% MB scan cap per query", "Query results expire in 7 days", "Pay per use: Lambda, Athena, AgentCore"]),
    ("Sustainability", ["Arm64 (Graviton) Lambdas and runtime", "Idle: only the hourly refresh runs", "Refresh, don't rebuild pipelines"]),
)


def draw_well_architected(s):
    colors = (BLUE, PINK, GREEN, PURPLE, YELLOW, TEAL)
    for i, (pillar, points) in enumerate(WELL_ARCHITECTED):
        x, y = 0.7 + (i % 3) * 4.07, 1.95 + (i // 3) * 2.5
        panel(s, x, y, 3.85, 2.3, colors[i])
        text_box(s, x + 0.25, y + 0.15, 3.4, 0.45, pillar, size=18, color=colors[i], bold=True)
        bullets_box(s, x + 0.25, y + 0.7, 3.4, 1.5, [(0, p) for p in points], 15)


PRODUCTION = [
    ("Concern", "In the demo", "In production"),
    ("Accounts", "One account", "Data, agents and tooling in separate accounts"),
    ("Network", "AgentCore Runtime in PUBLIC mode", "VPC mode with VPC endpoints"),
    ("Data access", "IAM reader role on gold", "Lake Formation grants and LF-tags on gold views"),
    ("Encryption and audit", "S3-managed keys", "Customer-managed KMS keys, CloudTrail data events"),
    ("Tool authorization", "SQL guard in code", "The guard plus AgentCore Policy (Cedar) at the Gateway"),
    ("Approvers", "One shared board token", "Named users (IAM Identity Center), audit per Approve"),
    ("Release", "Golden set run by hand", "PR gate on AgentCore Evaluations (the AWS sample)"),
]


def draw_production(s):
    widths = [2.6, 3.9, 5.8]
    rows = len(PRODUCTION)
    tbl = s.shapes.add_table(rows, 3, Inches(0.55), Inches(1.95), Inches(sum(widths)), Inches(0.52 * rows)).table
    for c, w in enumerate(widths):
        tbl.columns[c].width = Inches(w)
    for r, row in enumerate(PRODUCTION):
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x0B, 0x3B, 0x5C) if r == 0 else PANEL
            cell.text = val
            for run in cell.text_frame.paragraphs[0].runs:
                run.font.size = Pt(14)
                run.font.bold = r == 0 or c == 0
                run.font.color.rgb = MUTED if c == 1 and r else WHITE


BUY_VS_BUILD = [
    ("Concern", "Buy on AWS", "Build: only the harness"),
    ("Ask your data", "Amazon Quick chat agents · SageMaker Data Agent", "Answers from Athena with a contract each"),
    ("Governed semantics", "Quick datasets and Topics · KB query context", "Metrics as versioned Markdown, read by all"),
    ("Agent sees gold only", "Lake Formation on materialized views", ""),
    ("Grounded answers", "Guardrails grounding · Automated Reasoning", "Evidence per claim: SQL, query id, rows"),
    ("Verify each claim", "nothing", "Evidence agent: VERIFIED or DENIED"),
    ("Approve the answer", "nothing (tool-call pauses only)", "Approve gate, blocked by DENIED"),
    ("Evaluate the agent", "AgentCore Evaluations · Strands Evals", ""),
    ("Tool authorization", "AgentCore Policy (Cedar)", "Guard that refuses PII by name"),
    ("Check before merge", "AWS sample: Actions + Evaluations, < 0.8 blocks", "CI tests for guard, contracts, model drift"),
    ("Check before release", "AgentCore dataset evaluations (preview)", "Golden set with exact expected numbers"),
]


def draw_buy_vs_build(s):
    widths = [2.6, 5.1, 4.6]
    rows = len(BUY_VS_BUILD)
    tbl = s.shapes.add_table(rows, 3, Inches(0.55), Inches(1.9), Inches(sum(widths)), Inches(0.48 * rows)).table
    for c, w in enumerate(widths):
        tbl.columns[c].width = Inches(w)
    for r, row in enumerate(BUY_VS_BUILD):
        gap = row[1].startswith("nothing")
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor(0x0B, 0x3B, 0x5C) if r == 0 else RGBColor(0x3A, 0x10, 0x1C) if gap else PANEL
            cell.text = val or "—"
            p = cell.text_frame.paragraphs[0]
            for run in p.runs:
                run.font.size = Pt(13)
                run.font.bold = r == 0 or c == 0
                run.font.color.rgb = PINK if gap and c == 1 else MUTED if not val else WHITE


DRAW = {"workflow": draw_workflow, "buy-vs-build": draw_buy_vs_build, "well-architected": draw_well_architected, "production": draw_production, "architecture": draw_architecture, "medallion": draw_medallion, "evidence": draw_evidence, "loops": draw_loops, "enforcement": draw_enforcement}


# ---------- slides ----------

# Content slides are drawn, not poured into the template's content placeholders: those inherit a 28 pt bulleted
# body style with hanging indents that broke every layout we tried. The template still supplies background and title.
DRAWN = {"Title and Bulleted Content", "Comparison", "Three column with subheadings", "Code"}
COLUMN_COLORS = (BLUE, PURPLE, GREEN)


def bullets_box(slide, x, y, w, h, items, size):
    tb = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    for i, (level, text) in enumerate(items):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.space_before = Pt(0 if i == 0 else size * 0.7)
        r = p.add_run()
        r.text = ("    – " if level else "•  ") + text
        r.font.size = Pt(size - 2 * level)
        r.font.color.rgb = WHITE if level == 0 else MUTED
    return tb


def panel(slide, x, y, w, h, color):
    shp = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shp.adjustments[0] = 0.04
    shp.fill.solid()
    shp.fill.fore_color.rgb = PANEL
    shp.line.color.rgb = color
    shp.line.width = Pt(1.25)
    shp.shadow.inherit = False
    return shp


def draw_content(slide, kind, s):
    meta, blocks = s["meta"], s["blocks"]
    if kind == "Title and Bulleted Content":
        bullets_box(slide, 0.7, 2.0, 8.4 if "qr" in meta else 12.0, 4.8, blocks[0], 24)
    elif kind == "Comparison":
        for i, (head, items) in enumerate(((meta["left-title"], blocks[0]), (meta["right-title"], blocks[1]))):
            x = 0.7 + i * 6.1
            panel(slide, x, 1.95, 5.8, 4.9, COLUMN_COLORS[i])
            text_box(slide, x + 0.3, 2.15, 5.2, 0.5, head, size=22, color=COLUMN_COLORS[i], bold=True)
            bullets_box(slide, x + 0.3, 2.85, 5.2, 3.9, items, 20)
    elif kind == "Three column with subheadings":
        heads = [h.strip() for h in meta["columns"].split("|")]
        for i, (head, items) in enumerate(zip(heads, blocks)):
            x = 0.7 + i * 4.07
            panel(slide, x, 1.95, 3.85, 4.9, COLUMN_COLORS[i])
            text_box(slide, x + 0.25, 2.15, 3.4, 0.9, head, size=20, color=COLUMN_COLORS[i], bold=True)
            bullets_box(slide, x + 0.25, 3.0, 3.4, 3.7, items, 19)
    elif kind == "Code":
        panel(slide, 0.6, 1.85, 12.1, 5.15, MUTED)
        lines = s["code"].split("\n")
        size = 15 if len(lines) <= 14 else 13
        text_box(slide, 0.85, 2.0, 11.7, 4.9, "\n".join(lines), size=size, font="Amazon Ember Mono")
        if "caption" in meta:
            text_box(slide, 0.6, 7.02, 12.1, 0.3, meta["caption"], size=11, color=MUTED)


def fill(prs, slide, s, urls, kind=None):
    meta = s["meta"]
    name = slide.slide_layout.name
    if slide.shapes.title is not None:
        slide.shapes.title.text = s["title"]
    if name == "Quote Gradient 1":
        # Long quotes would spill out of the template's 36 pt quote box.
        if len(s["title"]) > 80:
            for run in slide.shapes.title.text_frame.paragraphs[0].runs:
                run.font.size = Pt(28)
        place(ph(slide, 15), height=0.8)
        ph(slide, 15).text = meta.get("attribution", "")
        for run in ph(slide, 15).text_frame.paragraphs[0].runs:
            run.font.size = Pt(14)
    elif name == "Agenda Slide 1":
        body = ph(slide, 10)
        set_bullets(body.text_frame, s["blocks"][0], 28)
        place(body, height=4.0)
    if kind in DRAWN:
        draw_content(slide, kind, s)
    if "demo-question" in meta:
        text_box(slide, 0.67, 4.7, 11.8, 1.2, meta["demo-question"], size=20, color=YELLOW)
    if "draw" in meta:
        DRAW[meta["draw"]](slide)
    if "qr" in meta:
        kind_ = meta["qr"]
        qr_or_placeholder(slide, urls[kind_], "FORM URL" if kind_ == "form" else "REPO URL", 9.6, 2.0, 3.0)
    drop_empty_placeholders(slide)
    slide.notes_slide.notes_text_frame.text = s["notes"]


def fill_title(slide, s):
    m = s["meta"]
    slide.shapes.title.text = s["title"]
    ph(slide, 1).text = m["subtitle"]
    ph(slide, 10).text = m["event"]
    place(ph(slide, 1), width=9.0)
    for idx, size in ((1, 18), (10, 12)):
        for run in ph(slide, idx).text_frame.paragraphs[0].runs:
            run.font.size = Pt(size)
    ph(slide, 11).text = m["speaker"]
    ph(slide, 12).text = m["role"]
    slide.notes_slide.notes_text_frame.text = s["notes"]


def fill_thanks(slide):
    ph(slide, 10).text = "Caroline Cah"
    ph(slide, 11).text = "Digital Lead, Wallenius Wilhelmsen"
    place(ph(slide, 11), width=5.0)
    drop_empty_placeholders(slide)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--form-url")
    ap.add_argument("--repo-url")
    args = ap.parse_args()
    urls = {"form": args.form_url, "repo": args.repo_url}

    prs = Presentation(TEMPLATE)
    original = list(prs.slides)
    new = []
    for s in parse_outline((HERE / "outline.md").read_text(encoding="utf-8")):
        lay = s["meta"].get("layout")
        if lay == "template-title":
            fill_title(original[TITLE], s)
        elif lay == "template-agenda":
            slide = original[AGENDA]
            fill(prs, slide, s, urls)
        else:
            slide = prs.slides.add_slide(layout(prs, "Title Only" if lay in DRAWN else lay))
            fill(prs, slide, s, urls, kind=lay)
            new.append(slide)
    fill_thanks(original[KEEP_END[1]])

    # Order: event branding, title, agenda, the talk, Builder Center, Thank you. The old samples go.
    ids = prs.slides._sldIdLst
    by_slide = {sl.slide_id: el for sl, el in zip(prs.slides, list(ids))}
    for i in SAMPLES:
        el = by_slide[original[i].slide_id]
        prs.part.drop_rel(el.get(qn("r:id")))
        ids.remove(el)
    for sl in [original[i] for i in KEEP_END]:
        el = by_slide[sl.slide_id]
        ids.remove(el)
        ids.append(el)

    fill_facts(prs, facts())
    prs.save(OUT)
    print(f"{OUT.name}: {len(prs.slides)} slides")


if __name__ == "__main__":
    main()
