import { describe, expect, test } from "vitest";
import { extractNumbers, numbersTraceable } from "../src/numbers.js";

describe("extractNumbers", () => {
  test("extracts swedish and english formats", () => {
    expect(extractNumbers("Revenue was 112 000 SEK, up from 1,234.5 and 1.234,5; share 12.5 %")).toEqual([
      112000, 1234.5, 1234.5, 12.5,
    ]);
  });
  test("ignores years and small numbers", () => {
    expect(extractNumbers("In week 43 of 2026 the top 5 stores sold 8 items")).toEqual([43]);
  });
});

describe("numbersTraceable", () => {
  const rows = [
    [
      { store: "Göteborg", revenue: 112000.4 },
      { store: "Malmö", revenue: 100000 },
    ],
  ];
  test("exact and rounded numbers trace to rows", () => {
    expect(numbersTraceable("Göteborg made 112 000 and Malmö 100000", rows)).toEqual({ ok: true, missing: [] });
  });
  test("derived percentage allowed", () => {
    const r = numbersTraceable("Göteborg is up 12 % (112 000 vs 100 000)", rows);
    expect(r.ok).toBe(true);
  });
  test("a number quoted from the question is allowed, but not as a base for derivations", () => {
    expect(numbersTraceable("In week 42 Göteborg made 112 000", rows, [42]).ok).toBe(true);
    expect(numbersTraceable("In week 42 Göteborg made 112 000", rows).missing).toEqual([42]);
    expect(numbersTraceable("Göteborg made 42 000", rows, [42]).missing).toEqual([42000]);
  });
  test("untraceable number rejected", () => {
    const r = numbersTraceable("Göteborg made 999 999 last week", rows);
    expect(r).toEqual({ ok: false, missing: [999999] });
  });
  test("ratio of two row values counts as traceable", () => {
    expect(numbersTraceable("That is 1.12 times Malmö", rows).ok).toBe(true);
  });
});

describe("extractNumbers ignores dates", () => {
  test("iso dates, day ranges and day-month phrases are not facts", () => {
    expect(
      extractNumbers(
        "Last week (2026-10-12 to 2026-10-19), i.e. 12–18 Oct, and from 19 October to 25 October 2026, Göteborg made 112 000.",
      ),
    ).toEqual([112000]);
    expect(extractNumbers("Week 43 runs Oct 19 to Oct 25; revenue was 1059350.7")).toEqual([43, 1059350.7]);
  });
  test("plain numbers next to words are still facts", () => {
    expect(extractNumbers("Göteborg sold 1490 units in 12 stores")).toEqual([1490, 12]);
  });
});

test("words that merely start like a month are not dates", () => {
  expect(extractNumbers("30 marbles and 44 decades, 12 Sept, 99 October")).toEqual([30, 44, 99]);
});

describe("review fixes", () => {
  test("athena scientific notation in rows is traceable", () => {
    expect(numbersTraceable("Total revenue was 13707707.8 SEK", [[{ total_revenue: "1.37077078E7" }]])).toEqual({
      ok: true,
      missing: [],
    });
  });
  test("a leading zero decimal is not a thousands group", () => {
    expect(extractNumbers("return rate 0.125 and 0.1509433962264151")).toEqual([]);
    expect(extractNumbers("rate 12.125 and 1,250.5")).toEqual([12.125, 1250.5]);
  });
});

test("scientific notation in the summary is one number", () => {
  expect(extractNumbers("Total revenue was 2.18061E7 SEK and 1.5e3 units")).toEqual([21806100, 1500]);
  expect(numbersTraceable("Total revenue was 2.18061E7 SEK", [[{ revenue: "2.18061E7" }]]).ok).toBe(true);
});
