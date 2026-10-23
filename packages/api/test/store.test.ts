import { describe, expect, test } from "vitest";
import { newQuestionId } from "../src/store.js";

describe("newQuestionId", () => {
  test("ids unique", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newQuestionId()));
    expect(ids.size).toBe(1000);
  });
  test("ids are url-safe and at least 33 chars as a runtime session id", () => {
    const id = newQuestionId();
    expect(id).toMatch(/^[a-z0-9-]+$/);
    expect(id.length).toBeGreaterThanOrEqual(33);
  });
});
