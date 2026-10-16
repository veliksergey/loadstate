import { describe, expect, it } from "vitest";
import { excerptFrom, fold } from "../src/text.js";

describe("fold", () => {
  it.each([
    ["Zoë", "zoe"],
    ["ÅNGSTRÖM", "angstrom"],
    ["Zoe\u1AB0", "zoe"],
    ["Ｆｕｌｌ", "full"],
    ["ﬁ", "fi"],
  ])("folds %j to %j", (text, folded) => {
    expect(fold(text)).toBe(folded);
  });
});

describe("excerptFrom", () => {
  it("drops Markdown markers and list bullets", () => {
    expect(excerptFrom("## Title\n\n  - **one**\n* two\n> quote", "fallback")).toBe(
      "Title one two quote",
    );
  });

  it("falls back when the body has no text", () => {
    expect(excerptFrom("\n\n## \n- ", "fallback")).toBe("fallback");
  });

  it("stays linear on long runs of blank lines", () => {
    // a quadratic pattern needs seconds here; a linear one needs milliseconds
    const body = `${"\n".repeat(100_000)}x`;
    const start = performance.now();
    expect(excerptFrom(body, "fallback")).toBe("x");
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});
