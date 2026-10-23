import { MAX_NAME_CHARS, MAX_QUESTION_CHARS } from "./sanitize.js";

export const EXAMPLE_QUESTIONS = ["What was last week's revenue per store?", "Which five products had the highest return rate last week?"];

export function renderForm(askedId?: string): string {
  const banner = askedId
    ? `<div id="out" class="ok" role="status">Asked! Watch the big board, your question is on its way.</div>`
    : `<div id="out" role="status"></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ask the lakehouse</title>
<style>
:root{--bg:#0b1a17;--card:#13302a;--ink:#f0fff9;--muted:#a9d6c7;--accent:#34d399;--err:#fb7185}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:560px;margin:0 auto;padding:24px 16px 48px}h1{font-size:1.6rem;margin:0 0 4px}p.lead{color:var(--muted);margin:0 0 20px}
.card{background:var(--card);border-radius:16px;padding:20px}label{display:block;font-weight:600;margin:16px 0 6px}
input[type=text],textarea{width:100%;font:inherit;color:var(--ink);background:#0d231f;border:1px solid #2b5c4f;border-radius:10px;padding:12px}
textarea{min-height:96px;resize:vertical}.hint{color:var(--muted);font-size:.9rem;margin-top:4px}
.check{display:flex;gap:10px;align-items:center;font-weight:500;margin-top:16px}.check input{width:20px;height:20px;accent-color:var(--accent)}
button{margin-top:22px;width:100%;font:inherit;font-weight:700;color:#0b1a17;background:var(--accent);border:0;border-radius:12px;padding:14px}
#out{margin-top:18px;padding:16px;border-radius:12px;display:none}#out.ok{display:block;background:#0f2a22;border:1px solid var(--accent)}#out.err{display:block;background:#2a1020;border:1px solid var(--err)}
.ex{color:var(--muted);font-size:.95rem}.ex li{margin:4px 0}
</style></head><body><main>
<h1>Ask the lakehouse 🟢</h1>
<p class="lead">An agent on Amazon Bedrock AgentCore answers from the retail lakehouse through a governed data model. Every answer carries evidence and is checked before Caroline sees it.</p>
<form id="f" class="card" method="post" action="/questions">
  <label for="name">Your name</label>
  <input id="name" name="name" type="text" maxlength="${MAX_NAME_CHARS}" placeholder="Ida">
  <label for="question">Your question</label>
  <textarea id="question" name="question" maxlength="${MAX_QUESTION_CHARS}" required placeholder="${EXAMPLE_QUESTIONS[0]}"></textarea>
  <div class="hint">Try one of these:</div>
  <ul class="ex">${EXAMPLE_QUESTIONS.map((q) => `<li>${q}</li>`).join("")}<li>How did Göteborg's revenue last week compare with the week before?</li></ul>
  <label class="check"><input type="checkbox" name="publish" value="on" checked> Post the answer on the demo issue when approved</label>
  <button type="submit">Ask</button>
  ${banner}
</form>
</main></body></html>`;
}
