import { describe, expect, it } from "vitest";
import { json, problem, serialize } from "../src/index.js";

describe("serialize", () => {
  it("writes a JSON body as text", () => {
    expect(serialize(json(200, { ok: true }, { etag: '"1"' }))).toEqual({
      status: 200,
      headers: { "content-type": "application/json", etag: '"1"' },
      body: '{"ok":true}',
    });
  });

  it("keeps an absent body as null", () => {
    expect(serialize({ status: 204, headers: {} })).toEqual({
      status: 204,
      headers: {},
      body: null,
    });
  });
});

describe("problem", () => {
  it.each([
    [413, "Content Too Large"],
    [415, "Unsupported Media Type"],
    [422, "Unprocessable Content"],
    [503, "Service Unavailable"],
  ] as const)("titles %i as %j", (status, title) => {
    expect(problem(status, "code", "detail").body).toMatchObject({ title, status });
  });

  it("includes errors only when given", () => {
    expect(problem(400, "x", "y").body).not.toHaveProperty("errors");
    expect(problem(400, "x", "y", []).body).toHaveProperty("errors", []);
  });
});
