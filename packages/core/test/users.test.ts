import { describe, expect, it } from "vitest";
import { userSchema, users } from "../src/index.js";

describe("users fixture", () => {
  it("has more than one default page of records", () => {
    expect(users.length).toBeGreaterThan(20);
  });

  it("orders records by unique ascending id starting at 1", () => {
    expect(users.map((user) => user.id)).toEqual(users.map((_, i) => i + 1));
  });

  it("satisfies the user schema", () => {
    for (const user of users) expect(userSchema.parse(user)).toEqual(user);
  });

  it("uses reserved example addresses and unique usernames", () => {
    for (const user of users) expect(user.email).toBe(`${user.username}@example.com`);
    expect(new Set(users.map((user) => user.username)).size).toBe(users.length);
  });

  it("is reproducible from a fixed epoch", () => {
    expect(users[0]).toEqual({
      id: 1,
      name: "Mira Okafor",
      username: "mira.okafor",
      email: "mira.okafor@example.com",
      createdAt: "2026-01-05T09:00:00.000Z",
      updatedAt: "2026-01-05T09:00:00.000Z",
    });
    for (const user of users) expect(user.updatedAt >= user.createdAt).toBe(true);
  });

  it("cannot be mutated", () => {
    expect(Object.isFrozen(users)).toBe(true);
    for (const user of users) expect(Object.isFrozen(user)).toBe(true);
  });
});
