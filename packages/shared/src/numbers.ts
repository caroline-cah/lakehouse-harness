// Grouped form must start with 1–3 digits that are not a leading zero, so "0.125" is a decimal, not a thousands group.
const NUMBER = /\d+(?:\.\d+)?[eE][+-]?\d+|(?<![\d.])[1-9]\d{0,2}(?:[ \u00a0,.]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?/g;

function parseNumber(raw: string): number {
  if (/[eE]/.test(raw)) return Number(raw); // scientific notation, as Athena prints large doubles
  let s = raw.replace(/[  ]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? "." : ",";
    s = s.replace(new RegExp(`\\${decimal === "." ? "," : "."}`, "g"), "").replace(decimal, ".");
  } else if (lastComma >= 0) {
    const after = s.length - lastComma - 1;
    s = after === 3 && (s.match(/,/g) ?? []).length >= 1 && !/^\d{1,3},\d{1,2}$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (lastDot >= 0) {
    const after = s.length - lastDot - 1;
    // Rows and summaries are English-formatted: a single dot is a decimal point ("12.125"); only repeated dot groups
    // ("1.234.567") are thousands separators.
    if (after === 3 && (s.match(/\./g) ?? []).length >= 2) s = s.replace(/\./g, "");
  }
  return Number(s);
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(?:0?[1-9]|[12]\\d|3[01])";
/** Dates are not facts about the data: ISO dates, day ranges before a month name, "19 October", "Oct 19". Day must be 1–31, month a real name. */
const DATE_PATTERNS = [
  /\b\d{4}-\d{2}-\d{2}(?:T[\d:]+Z?)?/gi,
  new RegExp(`\\b${DAY}(?:\\s*[–-]\\s*${DAY})?\\s+${MONTH}\\b(?:\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b${MONTH}\\s+${DAY}(?:\\s*[–-]\\s*${DAY})?\\b`, "gi"),
];

function stripDates(text: string): string {
  let t = text;
  for (const re of DATE_PATTERNS) t = t.replace(re, " ");
  return t;
}

/** Numbers a reader would treat as facts: ≥ 10, not a year 2020–2030, not part of a date. Percent signs are dropped, the value kept. */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of stripDates(text).matchAll(NUMBER)) {
    const n = parseNumber(m[0]);
    if (!Number.isFinite(n) || n < 10) continue;
    if (Number.isInteger(n) && n >= 2020 && n <= 2030) continue;
    out.push(n);
  }
  return out;
}

function rowValues(rows: Record<string, unknown>[][]): number[] {
  const vals: number[] = [];
  for (const group of rows) {
    for (const row of group) {
      for (const v of Object.values(row)) {
        // Athena prints doubles ≥ 1e7 in scientific notation ("1.37077078E7").
        const n = typeof v === "number" ? v : typeof v === "string" && /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v.trim()) ? Number(v) : NaN;
        if (Number.isFinite(n)) vals.push(n);
      }
    }
  }
  return vals;
}

const direct = (n: number, v: number) => Math.abs(v - n) <= 0.5 || (v !== 0 && Math.abs(v - n) / Math.abs(v) <= 0.001);
const near = (n: number, d: number) => Number.isFinite(d) && Math.abs(d - n) <= Math.max(0.05, 0.01 * Math.abs(d));

/**
 * Every number in `summary` must be a row value, a percentage of one, or a simple derivation
 * (difference, sum, ratio, percentage change) of two row values. Lenient on rounding, strict on invention.
 */
export function numbersTraceable(summary: string, rows: Record<string, unknown>[][]): { ok: boolean; missing: number[] } {
  const values = rowValues(rows);
  const missing: number[] = [];
  for (const n of extractNumbers(summary)) {
    let found = values.some((v) => direct(n, v) || direct(n, v * 100) || direct(n * 100, v));
    if (!found) {
      outer: for (const a of values) {
        for (const b of values) {
          if (a === b) continue;
          const candidates = [a - b, a + b, b === 0 ? NaN : a / b, b === 0 ? NaN : (a / b - 1) * 100, b === 0 ? NaN : (a / b) * 100];
          if (candidates.some((d) => near(n, d))) {
            found = true;
            break outer;
          }
        }
      }
    }
    if (!found) missing.push(n);
  }
  return { ok: missing.length === 0, missing };
}
