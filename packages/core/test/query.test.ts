import { describe, expect, it } from "vitest";
import { parseNoQuery, parseOffsetQuery } from "../src/index.js";

const parse = (query: string) => parseOffsetQuery(new URLSearchParams(query));
const codes = (query: string) => {
  const result = parse(query);
  return result.ok ? [] : result.issues.map((issue) => [issue.field, issue.code]);
};

describe("parseOffsetQuery", () => {
  it("defaults to the first page of 20", () => {
    expect(parse("")).toEqual({ ok: true, value: { limit: 20, offset: 0 } });
  });

  it("accepts plain integers at the bounds", () => {
    expect(parse("limit=1&offset=0")).toEqual({ ok: true, value: { limit: 1, offset: 0 } });
    expect(parse("limit=100&offset=9007199254740991")).toEqual({
      ok: true,
      value: { limit: 100, offset: Number.MAX_SAFE_INTEGER },
    });
    expect(parse("limit=007")).toEqual({ ok: true, value: { limit: 7, offset: 0 } });
  });

  it.each(["", "abc", "1.5", "-1", "+5", "1e2", "0x10", " 5", "5 ", "١٢"])(
    "rejects %j as a limit instead of coercing it",
    (value) => {
      expect(codes(`limit=${encodeURIComponent(value)}`)).toEqual([["limit", "invalid_integer"]]);
    },
  );

  it("rejects values outside the allowed range", () => {
    expect(codes("limit=0")).toEqual([["limit", "out_of_range"]]);
    expect(codes("limit=101")).toEqual([["limit", "out_of_range"]]);
    expect(codes("offset=9007199254740992")).toEqual([["offset", "out_of_range"]]);
    expect(codes(`offset=1${"0".repeat(400)}`)).toEqual([["offset", "out_of_range"]]);
  });

  it("rejects a repeated parameter once without parsing its values", () => {
    expect(codes("limit=5&limit=abc&limit=7")).toEqual([["limit", "duplicate_parameter"]]);
  });

  it("rejects parameters it does not support", () => {
    expect(codes("page=2&cursor=x&page=3")).toEqual([
      ["page", "unknown_parameter"],
      ["cursor", "unknown_parameter"],
    ]);
  });

  it("reports every problem in one result", () => {
    expect(codes("sort=id&offset=1&offset=2&limit=0")).toEqual([
      ["sort", "unknown_parameter"],
      ["offset", "duplicate_parameter"],
      ["limit", "out_of_range"],
    ]);
  });

  it("explains each problem", () => {
    const result = parse("limit=500");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]?.message).toBe('"limit" must be between 1 and 100.');
  });
});

describe("parseNoQuery", () => {
  it("accepts an empty query", () => {
    expect(parseNoQuery(new URLSearchParams(""))).toEqual({ ok: true, value: null });
  });

  it("reports each distinct parameter once", () => {
    const result = parseNoQuery(new URLSearchParams("a=1&b=2&a=3"));
    expect(result.ok ? [] : result.issues.map((issue) => [issue.field, issue.code])).toEqual([
      ["a", "unknown_parameter"],
      ["b", "unknown_parameter"],
    ]);
  });
});
