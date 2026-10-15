import { describe, expect, it } from "vitest";
import { paginate } from "../src/index.js";

const items = Array.from({ length: 25 }, (_, i) => i + 1);

describe("paginate", () => {
  it("returns the first page with totals", () => {
    const page = paginate(items, { limit: 20, offset: 0 });
    expect(page.data).toEqual(items.slice(0, 20));
    expect(page.meta).toEqual({ limit: 20, offset: 0, total: 25, hasMore: true });
  });

  it("returns a partial last page without more", () => {
    const page = paginate(items, { limit: 20, offset: 20 });
    expect(page.data).toEqual([21, 22, 23, 24, 25]);
    expect(page.meta.hasMore).toBe(false);
  });

  it("treats an exact page-size multiple as the end", () => {
    expect(paginate(items, { limit: 5, offset: 20 }).meta.hasMore).toBe(false);
    expect(paginate(items, { limit: 25, offset: 0 }).meta.hasMore).toBe(false);
  });

  it("returns an empty page past the end", () => {
    const page = paginate(items, { limit: 10, offset: Number.MAX_SAFE_INTEGER });
    expect(page.data).toEqual([]);
    expect(page.meta).toEqual({
      limit: 10,
      offset: Number.MAX_SAFE_INTEGER,
      total: 25,
      hasMore: false,
    });
  });

  it("handles an empty collection", () => {
    expect(paginate([], { limit: 20, offset: 0 })).toEqual({
      data: [],
      meta: { limit: 20, offset: 0, total: 0, hasMore: false },
    });
  });

  it("does not modify the source", () => {
    const source = Object.freeze([1, 2, 3]);
    const page = paginate(source, { limit: 2, offset: 0 });
    page.data.push(99);
    expect(source).toEqual([1, 2, 3]);
  });
});
