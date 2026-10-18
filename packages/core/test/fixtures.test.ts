import { describe, expect, it } from "vitest";
import { generateEdgePack } from "../scripts/edge-fixtures.ts";
import { checksum, fakerVersion, generateCorePack } from "../scripts/fixtures.ts";
import { corePack, edgePack, type PackData, resources } from "../src/index.js";

const { manifest, data } = corePack;
const byId = <T extends { id: number }>(rows: readonly T[]) =>
  new Map(rows.map((row) => [row.id, row]));

describe("core@1 manifest", () => {
  it("describes the pack it ships with", () => {
    expect(manifest).toMatchObject({
      id: "core@1",
      faker: "10.6.0",
      seed: 20260101,
      referenceTime: "2026-01-01T00:00:00.000Z",
      locale: "en",
    });
    for (const resource of resources) {
      expect(manifest.counts[resource.name]).toBe(data[resource.name].length);
    }
  });

  it("matches a fresh checksum of the committed data", () => {
    expect(checksum(data)).toBe(manifest.checksum);
  });
});

describe("generator drift", () => {
  it("runs on the Faker version the pack was generated with", () => {
    expect(fakerVersion()).toBe(manifest.faker);
  });

  it("regenerates exactly the committed pack", () => {
    const fresh = generateCorePack();
    expect(fresh.manifest).toEqual(manifest);
    expect(fresh.data).toEqual(data);
  });

  it("regenerates exactly the committed edge pack", () => {
    const fresh = generateEdgePack();
    expect(fresh.manifest).toEqual(edgePack.manifest);
    expect(fresh.data).toEqual(edgePack.data);
  });
});

describe("edge@1 manifest", () => {
  it("describes a pack written by hand", () => {
    expect(edgePack.manifest).toMatchObject({
      id: "edge@1",
      faker: null,
      seed: null,
      referenceTime: "2026-01-01T00:00:00.000Z",
      locale: "mul",
    });
    for (const resource of resources) {
      expect(edgePack.manifest.counts[resource.name]).toBe(edgePack.data[resource.name].length);
    }
    expect(checksum(edgePack.data)).toBe(edgePack.manifest.checksum);
  });
});

describe("edge@1 coverage", () => {
  const { users, posts, comments, categories, products, todos } = edgePack.data;
  const codePoints = (text: string) => [...text].length;
  const rtl = /[\u0590-\u08ff]/;
  const astral = /[\u{10000}-\u{10ffff}]/u;

  it("holds text at the contract's maximum lengths", () => {
    expect(users.some((user) => codePoints(user.name) === 100)).toBe(true);
    expect(users.some((user) => user.username.length === 50)).toBe(true);
    expect(users.some((user) => user.company?.length === 100)).toBe(true);
    expect(users.some((user) => user.address?.street.length === 200)).toBe(true);
    expect(posts.some((post) => codePoints(post.title) === 200)).toBe(true);
    expect(posts.some((post) => post.excerpt.length === 500)).toBe(true);
    expect(posts.some((post) => post.body.length > 19_000)).toBe(true);
    expect(
      posts.some((post) => post.tags.length === 10 && post.tags.every((tag) => tag.length === 30)),
    ).toBe(true);
    expect(comments.some((comment) => comment.body.length === 2_000)).toBe(true);
    expect(categories.some((category) => category.name.length === 60)).toBe(true);
    expect(
      products.some((product) => product.title.length === 200 && product.brand.length === 100),
    ).toBe(true);
    expect(todos.some((todo) => todo.title.length === 200)).toBe(true);
  });

  it("holds Unicode, right-to-left and emoji text", () => {
    expect(users.filter((user) => rtl.test(user.name))).toHaveLength(2);
    expect(users.some((user) => astral.test(user.name))).toBe(true);
    expect(posts.some((post) => rtl.test(post.title))).toBe(true);
    expect(
      posts.some(
        (post) =>
          /^[\p{Extended_Pictographic}\s\p{L}]+$/u.test(post.title) && astral.test(post.title),
      ),
    ).toBe(true);
    expect(products.some((product) => product.slug === `product-${product.id}`)).toBe(true);
    expect(posts.some((post) => post.slug === `post-${post.id}`)).toBe(true);
    expect(categories.some((category) => category.slug === "category")).toBe(true);
  });

  it("repeats display names and titles", () => {
    const repeated = (values: string[]) => values.length > new Set(values).size;
    expect(repeated(users.map((user) => user.name))).toBe(true);
    expect(repeated(posts.map((post) => post.title))).toBe(true);
    expect(repeated(products.map((product) => product.title))).toBe(true);
    expect(repeated(todos.map((todo) => todo.title))).toBe(true);
    expect(repeated(users.map((user) => user.createdAt))).toBe(true);
  });

  it("sits on date boundaries", () => {
    const stamps = [...users, ...posts, ...comments, ...todos].map((row) => row.createdAt);
    expect(stamps).toContain("1970-01-01T00:00:00.000Z");
    expect(stamps).toContain("2024-02-29T23:59:59.999Z");
    expect(stamps).toContain("1999-12-31T23:59:59.999Z");
    expect(users.map((user) => user.updatedAt)).toContain(edgePack.manifest.referenceTime);
    expect(todos.map((todo) => todo.dueDate)).toEqual(
      expect.arrayContaining(["1970-01-01", "2024-02-29", "2099-12-31", null]),
    );
  });

  it("holds zero and extreme values", () => {
    expect(products.some((product) => product.priceMinor === 0 && product.stock === 0)).toBe(true);
    expect(
      products.some((product) => product.priceMinor === 100_000_000 && product.stock === 1_000_000),
    ).toBe(true);
    expect(products.some((product) => product.rating === 5)).toBe(true);
    expect(products.some((product) => product.images.length === 5)).toBe(true);
    expect(comments.some((comment) => comment.likes === 0)).toBe(true);
    expect(posts.some((post) => post.tags.length === 0)).toBe(true);
  });

  it("leaves optional relations empty", () => {
    const authors = new Set([...posts, ...comments, ...todos].map((row) => row.userId));
    expect(users.some((user) => !authors.has(user.id))).toBe(true);
    expect(
      posts.some(
        (post) =>
          post.status !== "draft" && !comments.some((comment) => comment.postId === post.id),
      ),
    ).toBe(true);
    expect(
      categories.some(
        (category) =>
          category.parentId === null && !categories.some((child) => child.parentId === category.id),
      ),
    ).toBe(true);
    expect(
      categories.some(
        (category) =>
          category.parentId !== null &&
          !products.some((product) => product.categoryId === category.id),
      ),
    ).toBe(true);
  });
});

describe.each([corePack, edgePack].map((pack) => [pack.manifest.id, pack] as const))(
  "%s",
  (_id, pack) => {
    const { data } = pack;
    const reference = pack.manifest.referenceTime;

    describe("contracts", () => {
      it.each(resources.map((resource) => [resource.name, resource] as const))(
        "every %s record satisfies its contract",
        (name, resource) => {
          for (const record of data[name]) {
            const result = resource.schema.safeParse(record);
            expect(result.success, `${name} ${record.id}: ${result.error?.message}`).toBe(true);
          }
        },
      );
    });

    describe("integrity", () => {
      const users = byId(data.users);
      const posts = byId(data.posts);
      const comments = byId(data.comments);
      const categories = byId(data.categories);

      it("numbers every resource 1..n in ascending order", () => {
        for (const name of Object.keys(data) as (keyof PackData)[]) {
          expect(data[name].map((row) => row.id)).toEqual(data[name].map((_, i) => i + 1));
        }
      });

      it("resolves every foreign key", () => {
        for (const post of data.posts) expect(users.has(post.userId)).toBe(true);
        for (const comment of data.comments) {
          expect(posts.has(comment.postId)).toBe(true);
          expect(users.has(comment.userId)).toBe(true);
        }
        for (const product of data.products) expect(categories.has(product.categoryId)).toBe(true);
        for (const todo of data.todos) expect(users.has(todo.userId)).toBe(true);
      });

      it("keeps replies one level deep on the same post", () => {
        const replies = data.comments.filter((comment) => comment.parentId !== null);
        expect(replies.length).toBeGreaterThan(0);
        for (const reply of replies) {
          const parent = comments.get(reply.parentId ?? 0);
          expect(parent?.postId).toBe(reply.postId);
          expect(parent?.parentId).toBeNull();
          expect(parent && parent.id < reply.id).toBe(true);
          expect(parent && parent.createdAt <= reply.createdAt).toBe(true);
        }
      });

      it("keeps categories one level deep and products in child categories", () => {
        for (const category of data.categories) {
          if (category.parentId === null) continue;
          expect(categories.get(category.parentId)?.parentId).toBeNull();
        }
        for (const product of data.products) {
          expect(categories.get(product.categoryId)?.parentId).not.toBeNull();
        }
      });

      it("keeps identifying fields unique", () => {
        const unique = (values: string[]) => expect(new Set(values).size).toBe(values.length);
        unique(data.users.map((user) => user.username));
        unique(data.users.map((user) => user.email));
        unique(data.posts.map((post) => post.slug));
        unique(data.products.map((product) => product.slug));
        unique(data.categories.map((category) => category.slug));
      });

      it("uses reserved example.com addresses", () => {
        for (const user of data.users) expect(user.email).toBe(`${user.username}@example.com`);
      });

      it("orders timestamps and never passes the reference time", () => {
        for (const name of Object.keys(data) as (keyof PackData)[]) {
          for (const row of data[name]) {
            expect(row.createdAt <= row.updatedAt, `${name} ${row.id}`).toBe(true);
            expect(row.updatedAt <= reference, `${name} ${row.id}`).toBe(true);
          }
        }
      });

      it("publishes posts consistently with their status", () => {
        for (const post of data.posts) {
          if (post.status === "draft") {
            expect(post.publishedAt).toBeNull();
          } else {
            expect(post.publishedAt).not.toBeNull();
            expect(post.createdAt <= (post.publishedAt ?? "")).toBe(true);
            expect((post.publishedAt ?? "") <= post.updatedAt).toBe(true);
          }
        }
      });

      it("dates comments after the post was published and the author joined", () => {
        for (const comment of data.comments) {
          const post = posts.get(comment.postId);
          expect(post?.status).not.toBe("draft");
          expect((post?.publishedAt ?? "") <= comment.createdAt).toBe(true);
          expect((users.get(comment.userId)?.createdAt ?? "") <= comment.createdAt).toBe(true);
        }
        for (const post of data.posts) {
          expect((users.get(post.userId)?.createdAt ?? "") <= post.createdAt).toBe(true);
        }
        for (const todo of data.todos) {
          expect((users.get(todo.userId)?.createdAt ?? "") <= todo.createdAt).toBe(true);
        }
      });

      it("prices in integer minor units and rates only rated products", () => {
        for (const product of data.products) {
          expect(Number.isInteger(product.priceMinor)).toBe(true);
          expect(product.currency).toBe("USD");
          if (product.ratingCount === 0) expect(product.rating).toBe(0);
          else expect(product.rating).toBeGreaterThanOrEqual(1);
        }
      });

      it("covers the edge values front ends must handle", () => {
        expect(data.users.some((user) => user.address === null)).toBe(true);
        expect(data.users.some((user) => user.company === null)).toBe(true);
        expect(data.products.some((product) => product.stock === 0)).toBe(true);
        expect(data.products.some((product) => product.ratingCount === 0)).toBe(true);
        expect(data.posts.some((post) => post.status === "draft")).toBe(true);
        expect(data.todos.some((todo) => todo.dueDate === null)).toBe(true);
        expect(data.todos.some((todo) => (todo.dueDate ?? "") > reference.slice(0, 10))).toBe(true);
      });

      it("stores image paths root-relative under /img", () => {
        const images = [
          ...data.users.map((user) => user.avatar),
          ...data.posts.map((post) => post.cover),
          ...data.categories.map((category) => category.image),
          ...data.products.flatMap((product) => product.images),
        ];
        for (const image of images) expect(image.url).toMatch(/^\/img\//);
      });
    });
  },
);
