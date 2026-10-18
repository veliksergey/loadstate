import { describe, expect, it } from "vitest";
import {
  corePack,
  createEngine,
  type Engine,
  type EngineResponse,
  fixturePacks,
  type ResourceName,
  resourceNamed,
  resources,
  writeRules,
} from "../src/index.js";
import {
  createBodies,
  dependentsOf,
  fullBodies,
  nextIdOf,
  pack,
  type Row,
  readOnly,
  rows,
} from "./samples.js";

// each write reads the clock once; minute n is the (n+1)th write
const at = (minute: number) => new Date(Date.UTC(2026, 2, 1, 12, minute)).toISOString();
function clock() {
  let minute = 0;
  return () => new Date(at(minute++));
}
const memory = () => createEngine({ state: "memory", now: clock() });
const stateless = () => createEngine({ state: "stateless", now: clock() });

function send(engine: Engine, method: string, path: string, body?: unknown): EngineResponse {
  return engine.handle({
    method,
    path,
    ...(body === undefined
      ? {}
      : {
          contentType: "application/json",
          body: typeof body === "string" ? body : JSON.stringify(body),
        }),
  });
}

type Issue = { field: string; code: string; message: string };
const record = (response: EngineResponse) => response.body as Row;
const issues = (response: EngineResponse) => (response.body as { errors?: Issue[] }).errors ?? [];
const codes = (response: EngineResponse) =>
  issues(response).map((issue) => `${issue.field}:${issue.code}`);
const total = (engine: Engine, name: ResourceName) =>
  (send(engine, "GET", `/v1/${name}`).body as { meta: { total: number } }).meta.total;

// documented values for omitted optional fields, plus server-set starting values
const defaults: Record<ResourceName, Record<string, unknown>> = {
  users: {
    role: "viewer",
    status: "active",
    address: null,
    company: null,
    locale: "en-US",
    timezone: "UTC",
  },
  posts: { tags: [], status: "draft", publishedAt: null },
  comments: { parentId: null, likes: 0 },
  categories: { parentId: null },
  products: { currency: "USD", stock: 0, status: "draft", rating: 0, ratingCount: 0 },
  todos: { completed: false, dueDate: null, priority: "normal" },
};

const patches: Record<ResourceName, Record<string, unknown>> = {
  users: { company: null, name: "Ana Lima Costa" },
  posts: { tags: ["only"] },
  comments: { body: "Edited." },
  categories: { name: "Pet beds and mats" },
  products: { stock: 0, currency: "GBP" },
  todos: { completed: false, dueDate: null },
};

describe.each(resources.map((resource) => resource.name))("writes to %s", (name) => {
  const resource = resourceNamed(name);
  const id = nextIdOf(name);
  const collection = `/v1/${name}`;
  const item = `${collection}/${id}`;

  it("creates a record with a location and stores it", () => {
    const engine = memory();
    const created = send(engine, "POST", collection, createBodies[name]);
    expect(created.status).toBe(201);
    expect(created.headers).toEqual({
      "content-type": "application/json",
      location: item,
      "x-mock-state": "memory",
    });
    expect(resource.schema.parse(created.body)).toEqual(created.body);
    expect(created.body).toMatchObject({
      id,
      ...createBodies[name],
      createdAt: at(0),
      updatedAt: at(0),
    });
    expect(send(engine, "GET", item).body).toEqual(created.body);
    expect(total(engine, name)).toBe(rows(name).length + 1);
    expect(send(engine, "POST", collection, fullBodies[name]).headers.location).toBe(
      `${collection}/${id + 1}`,
    );
  });

  it("fills omitted optional fields with the documented defaults", () => {
    expect(send(memory(), "POST", collection, createBodies[name]).body).toMatchObject(
      defaults[name],
    );
  });

  it("keeps every optional field it is given", () => {
    const created = send(memory(), "POST", collection, fullBodies[name]);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject(fullBodies[name]);
    expect(resource.schema.parse(created.body)).toEqual(created.body);
  });

  it("replaces with PUT: omitted fields return to defaults and createdAt stays", () => {
    const engine = memory();
    send(engine, "POST", collection, fullBodies[name]);
    const replaced = send(engine, "PUT", item, createBodies[name]);
    expect(replaced.status).toBe(200);
    expect(replaced.headers).toEqual({
      "content-type": "application/json",
      "x-mock-state": "memory",
    });
    expect(resource.schema.parse(replaced.body)).toEqual(replaced.body);
    expect(replaced.body).toMatchObject({
      id,
      ...createBodies[name],
      ...defaults[name],
      createdAt: at(0),
      updatedAt: at(1),
    });
    expect(send(engine, "GET", item).body).toEqual(replaced.body);
    expect(total(engine, name)).toBe(rows(name).length + 1);
  });

  it("merges PATCH onto the stored record and leaves omitted fields alone", () => {
    const engine = memory();
    send(engine, "POST", collection, fullBodies[name]);
    const before = record(send(engine, "GET", item));

    const empty = send(engine, "PATCH", item, {});
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ ...before, updatedAt: at(1) });

    const patched = send(engine, "PATCH", item, patches[name]);
    expect(patched.status).toBe(200);
    expect(resource.schema.parse(patched.body)).toEqual(patched.body);
    expect(patched.body).toMatchObject({
      ...fullBodies[name],
      ...patches[name],
      createdAt: at(0),
      updatedAt: at(2),
    });
    expect(send(engine, "GET", item).body).toEqual(patched.body);
  });

  it("deletes with 204 and no body, then answers 404", () => {
    const engine = memory();
    send(engine, "POST", collection, createBodies[name]);
    expect(send(engine, "DELETE", item)).toEqual({
      status: 204,
      headers: { "x-mock-state": "memory" },
    });
    expect(send(engine, "GET", item).status).toBe(404);
    expect(send(engine, "DELETE", item).status).toBe(404);
    expect(total(engine, name)).toBe(rows(name).length);
  });

  it.each(["PUT", "PATCH", "DELETE"])("answers %s on a missing record with 404", (method) => {
    // the target is checked before the body, so even malformed JSON gets 404
    const response = send(memory(), method, item, "{");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      code: "not_found",
      detail: `No ${resource.singular.toLowerCase()} has this id.`,
    });
  });

  it("lists the allowed methods on a 405", () => {
    const engine = memory();
    const list = send(engine, "DELETE", collection);
    expect(list.status).toBe(405);
    expect(list.headers.allow).toBe("GET, HEAD, POST");
    const one = send(engine, "POST", `${collection}/1`);
    expect(one.status).toBe(405);
    expect(one.headers.allow).toBe("GET, HEAD, PUT, PATCH, DELETE");
  });

  it("takes exactly the record's fields that are not read-only", () => {
    const writable = Object.keys(resource.schema.shape).filter(
      (field) => !readOnly[name].includes(field),
    );
    expect(Object.keys(writeRules[name].input.shape).sort()).toEqual(writable.sort());
  });

  it.each(["POST", "PUT", "PATCH"])("rejects every read-only field by name on %s", (method) => {
    const fixture = rows(name)[0] ?? { id: 1 };
    const body = {
      ...createBodies[name],
      ...Object.fromEntries(readOnly[name].map((field) => [field, fixture[field]])),
    };
    const path = method === "POST" ? collection : `${collection}/1`;
    const response = send(memory(), method, path, body);
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({ code: "validation_failed" });
    expect(issues(response)).toEqual(
      readOnly[name].map((field) => ({
        field,
        code: "read_only",
        message: `"${field}" is set by the server.`,
      })),
    );
  });

  it("names an unknown field", () => {
    const response = send(memory(), "PATCH", `${collection}/1`, { nickname: "x" });
    expect(response.status).toBe(422);
    expect(issues(response)).toEqual([
      { field: "nickname", code: "unknown_field", message: 'Unknown field "nickname".' },
    ]);
  });

  it("answers like memory in a stateless engine but stores nothing", () => {
    const engine = stateless();
    const created = send(engine, "POST", collection, createBodies[name]);
    const reference = send(memory(), "POST", collection, createBodies[name]);
    expect(created.status).toBe(201);
    expect(created.body).toEqual(reference.body);
    expect(created.headers).toEqual({ ...reference.headers, "x-mock-state": "stateless" });
    expect(send(engine, "GET", item).status).toBe(404);
    expect(total(engine, name)).toBe(rows(name).length);

    const invalid = send(engine, "POST", collection, {});
    expect(invalid.status).toBe(422);
    expect(invalid.body).toEqual(send(memory(), "POST", collection, {}).body);

    const first = `${collection}/1`;
    const before = send(engine, "GET", first).body;
    expect(send(engine, "PUT", first, createBodies[name]).status).toBe(200);
    expect(send(engine, "PATCH", first, {}).status).toBe(200);
    expect(send(engine, "GET", first).body).toEqual(before);

    const leaf = rows(name).find((row) => dependentsOf(name, row.id).length === 0);
    if (leaf) {
      expect(send(engine, "DELETE", `${collection}/${leaf.id}`).status).toBe(204);
      expect(send(engine, "GET", `${collection}/${leaf.id}`).status).toBe(200);
    }
    expect(total(engine, name)).toBe(rows(name).length);
  });
});

describe("users", () => {
  const [first, second] = corePack.data.users;
  if (!first || !second) throw new Error("The core pack needs two users.");

  it("answers 409 when a username or email is taken, comparing email without case", () => {
    const engine = memory();
    const response = send(engine, "POST", "/v1/users", {
      name: "Copy",
      username: first.username,
      email: first.email.toUpperCase(),
    });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      title: "Conflict",
      code: "conflict",
      detail: "Another user already uses this value.",
    });
    expect(issues(response)).toEqual([
      {
        field: "username",
        code: "already_used",
        message: '"username" is already used by another user.',
      },
      {
        field: "email",
        code: "already_used",
        message: '"email" is already used by another user.',
      },
    ]);
    expect(total(engine, "users")).toBe(rows("users").length);
  });

  it("lets a user keep its own username and email", () => {
    const engine = memory();
    const path = `/v1/users/${first.id}`;
    const body = { name: "Renamed", username: first.username, email: first.email };
    expect(send(engine, "PUT", path, body).status).toBe(200);
    expect(send(engine, "PATCH", path, { email: first.email.toUpperCase() }).status).toBe(200);
  });

  it("answers 409 when a PATCH takes another user's email", () => {
    const response = send(memory(), "PATCH", `/v1/users/${second.id}`, {
      email: first.email.toUpperCase(),
    });
    expect(response.status).toBe(409);
    expect(codes(response)).toEqual(["email:already_used"]);
  });

  it("checks fields before conflicts", () => {
    const response = send(memory(), "POST", "/v1/users", {
      name: "",
      username: first.username,
      email: first.email,
    });
    expect(response.status).toBe(422);
    expect(codes(response)).toEqual(["name:too_short"]);
  });

  it("derives the avatar from the username and its alt text from the name", () => {
    const engine = memory();
    const path = `/v1/users/${first.id}`;
    const renamed = record(send(engine, "PATCH", path, { name: "New Name" }));
    expect(renamed.avatar).toEqual({ ...first.avatar, alt: "New Name" });

    const moved = record(send(engine, "PATCH", path, { username: "new.name" }));
    expect(moved.avatar).toEqual({
      url: "/img/avatar/new.name?size=96",
      width: 96,
      height: 96,
      alt: "New Name",
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
  });

  it("accepts null only for nullable fields and replaces nested objects whole", () => {
    const engine = memory();
    const path = `/v1/users/${first.id}`;
    expect(record(send(engine, "PATCH", path, { address: null })).address).toBeNull();

    const address = { street: "2 High Street", city: "Leeds", postalCode: "LS1", country: "GB" };
    expect(record(send(engine, "PATCH", path, { address })).address).toEqual(address);

    const partial = send(engine, "PATCH", path, { address: { city: "York" } });
    expect(codes(partial)).toEqual([
      "address.street:required",
      "address.postalCode:required",
      "address.country:required",
    ]);

    const nulls = send(engine, "PATCH", path, { name: null, role: null });
    expect(issues(nulls)).toEqual([
      { field: "name", code: "invalid_type", message: '"name" must be a string.' },
      {
        field: "role",
        code: "invalid_value",
        message: '"role" must be one of: admin, editor, viewer.',
      },
    ]);
  });
});

describe("posts", () => {
  it("derives the slug, excerpt, cover and reading time from the inputs", () => {
    const engine = memory();
    const id = nextIdOf("posts");
    const body = `## Heading\n\n- **Bold** item\n${"word ".repeat(400)}`;
    const title = "Ça va? Hello, World!";
    const created = record(send(engine, "POST", "/v1/posts", { userId: 1, title, body }));
    expect(created.slug).toBe(`ca-va-hello-world-${id}`);
    expect(created.readingTimeMinutes).toBe(3);
    expect(created.excerpt).toBe(`Heading Bold item ${"word ".repeat(28).trim()}…`);
    expect(created.cover).toEqual({
      url: `/img/1200x630?seed=post-${id}`,
      width: 1200,
      height: 630,
      alt: title,
      color: expect.stringMatching(/^#[0-9a-f]{6}$/),
    });

    const retitled = record(
      send(engine, "PATCH", `/v1/posts/${id}`, { title: "!!!", body: "One two." }),
    );
    expect(retitled.slug).toBe(`post-${id}`);
    expect(retitled.readingTimeMinutes).toBe(1);
    // the excerpt is a writable field, so a PATCH that omits it keeps it
    expect(retitled.excerpt).toBe(created.excerpt);
    expect(retitled.cover).toEqual({ ...(created.cover as object), alt: "!!!" });
  });

  it.each([
    ["exactly 200 words", "word ".repeat(200).trim(), 1],
    ["200 words and a trailing newline", `${"word ".repeat(200).trim()}\n`, 1],
    ["200 words with spaces around them", `  ${"word ".repeat(200)}  `, 1],
    ["201 words", "word ".repeat(201).trim(), 2],
  ])("counts reading time from words only: %s", (_name, body, minutes) => {
    const created = send(memory(), "POST", "/v1/posts", { ...createBodies.posts, body });
    expect(record(created).readingTimeMinutes).toBe(minutes);
  });

  it.each([
    ["an emoji split by the cut", `${"中".repeat(159)}😀x`, `${"中".repeat(159)}…`],
    ["an emoji ending at the cut", `${"中".repeat(158)}😀x`, `${"中".repeat(158)}😀…`],
  ])("never cuts a derived excerpt inside a character: %s", (_name, body, excerpt) => {
    const created = send(memory(), "POST", "/v1/posts", { ...createBodies.posts, body });
    expect(record(created).excerpt).toBe(excerpt);
  });

  it("sets publishedAt when a post leaves draft and clears it on the way back", () => {
    const engine = memory();
    const path = `/v1/posts/${nextIdOf("posts")}`;
    const publish = { ...createBodies.posts, status: "published" };
    expect(record(send(engine, "POST", "/v1/posts", createBodies.posts)).publishedAt).toBeNull();
    expect(record(send(engine, "PATCH", path, { status: "published" })).publishedAt).toBe(at(1));
    expect(record(send(engine, "PATCH", path, { status: "archived" })).publishedAt).toBe(at(1));
    expect(record(send(engine, "PATCH", path, { status: "draft" })).publishedAt).toBeNull();
    expect(record(send(engine, "PUT", path, publish)).publishedAt).toBe(at(4));
  });

  it("keeps a post with comments out of draft", () => {
    const engine = memory();
    const path = `/v1/posts/${pack.publishedPost.id}`;
    const commented = send(engine, "PATCH", path, { status: "draft" });
    expect(commented.status).toBe(422);
    expect(issues(commented)).toEqual([
      {
        field: "status",
        code: "has_comments",
        message: '"status" cannot return to draft while the post has comments.',
      },
    ]);
    // a PUT without a status means draft too
    expect(codes(send(engine, "PUT", path, createBodies.posts))).toEqual(["status:has_comments"]);

    const quiet = send(engine, "PATCH", `/v1/posts/${pack.quietPost.id}`, { status: "draft" });
    expect(quiet.status).toBe(200);
  });

  it("replaces arrays whole", () => {
    const engine = memory();
    const path = `/v1/posts/${pack.publishedPost.id}`;
    expect(record(send(engine, "PATCH", path, { tags: ["a", "b"] })).tags).toEqual(["a", "b"]);
    expect(record(send(engine, "PATCH", path, { tags: [] })).tags).toEqual([]);
    expect(codes(send(engine, "PATCH", path, { tags: null }))).toEqual(["tags:invalid_type"]);
  });
});

describe("comments", () => {
  const { publishedPost, draftPost, threadRoot, loneComment, reply, quietPost } = pack;
  const newComment = (fields: Record<string, unknown>) => ({ ...createBodies.comments, ...fields });
  const otherPost = publishedPost.id === threadRoot.postId ? quietPost.id : publishedPost.id;

  it("accepts a reply to a top-level comment on the same post", () => {
    const body = newComment({ postId: threadRoot.postId, parentId: threadRoot.id });
    const created = send(memory(), "POST", "/v1/comments", body);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ parentId: threadRoot.id, likes: 0 });
  });

  it.each([
    [
      "on a draft post",
      { postId: draftPost.id },
      "postId",
      "not_published",
      "must refer to a published or archived post",
    ],
    [
      "replying to a reply",
      { postId: reply.postId, parentId: reply.id },
      "parentId",
      "nested_reply",
      "must refer to a top-level comment",
    ],
    [
      "replying across posts",
      { postId: otherPost, parentId: threadRoot.id },
      "parentId",
      "other_post",
      "must refer to a comment on the same post",
    ],
  ])("refuses a comment %s", (_name, fields, field, code, text) => {
    const response = send(memory(), "POST", "/v1/comments", newComment(fields));
    expect(response.status).toBe(422);
    expect(issues(response)).toEqual([{ field, code, message: `"${field}" ${text}.` }]);
  });

  it("refuses a comment that replies to itself", () => {
    const response = send(memory(), "PATCH", `/v1/comments/${loneComment.id}`, {
      parentId: loneComment.id,
    });
    expect(issues(response)).toEqual([
      {
        field: "parentId",
        code: "self_reference",
        message: '"parentId" cannot refer to the comment itself.',
      },
    ]);
  });

  it("keeps a comment with replies at the top of its thread", () => {
    const engine = memory();
    const path = `/v1/comments/${threadRoot.id}`;
    const sibling = corePack.data.comments.find(
      (comment) =>
        comment.postId === threadRoot.postId &&
        comment.parentId === null &&
        comment.id !== threadRoot.id,
    );
    const parent = sibling?.id ?? loneComment.id;
    expect(codes(send(engine, "PATCH", path, { parentId: parent }))).toContain(
      "parentId:has_replies",
    );
    expect(codes(send(engine, "PATCH", path, { postId: otherPost }))).toEqual([
      "postId:has_replies",
    ]);
    expect(send(engine, "PATCH", path, { body: "Still on top." }).status).toBe(200);
  });

  it("keeps likes and createdAt on PUT", () => {
    const replaced = send(memory(), "PUT", `/v1/comments/${loneComment.id}`, {
      postId: loneComment.postId,
      userId: loneComment.userId,
      body: "Rewritten.",
    });
    expect(replaced.status).toBe(200);
    expect(replaced.body).toMatchObject({
      likes: loneComment.likes,
      createdAt: loneComment.createdAt,
    });
  });
});

describe("categories", () => {
  const { topCategory, subcategory } = pack;
  const child = corePack.data.categories.find((category) => category.parentId === topCategory.id);
  const otherTop = corePack.data.categories.find(
    (category) => category.parentId === null && category.id !== topCategory.id,
  );
  if (!child || !otherTop) throw new Error("The core pack needs two trees of categories.");

  it("builds a tree two levels deep with products only in subcategories", () => {
    const engine = memory();
    const top = record(send(engine, "POST", "/v1/categories", { name: "Pets" }));
    const sub = record(send(engine, "POST", "/v1/categories", { name: "Beds", parentId: top.id }));
    expect(sub.parentId).toBe(top.id);

    const product = { ...createBodies.products, categoryId: sub.id };
    expect(send(engine, "POST", "/v1/products", product).status).toBe(201);

    const inTop = send(engine, "POST", "/v1/products", { ...product, categoryId: top.id });
    expect(issues(inTop)).toEqual([
      {
        field: "categoryId",
        code: "not_subcategory",
        message: '"categoryId" must refer to a subcategory.',
      },
    ]);
  });

  it("derives a unique slug from the name", () => {
    const engine = memory();
    const id = nextIdOf("categories");
    const create = (name: string) => record(send(engine, "POST", "/v1/categories", { name }));
    expect(create("Pet supplies").slug).toBe("pet-supplies");
    expect(create(topCategory.name).slug).toBe(`${topCategory.slug}-${id + 1}`);
    expect(create("★").slug).toBe("category");
  });

  it("keeps a category's slug while its name stays the same", () => {
    const engine = memory();
    const id = nextIdOf("categories");
    send(engine, "POST", "/v1/categories", { name: "Pets" });
    send(engine, "POST", "/v1/categories", { name: "Pets" });
    expect(send(engine, "DELETE", `/v1/categories/${id}`).status).toBe(204);

    const path = `/v1/categories/${id + 1}`;
    expect(record(send(engine, "PATCH", path, {})).slug).toBe(`pets-${id + 1}`);
    expect(record(send(engine, "PUT", path, { name: "Pets" })).slug).toBe(`pets-${id + 1}`);
    expect(record(send(engine, "PATCH", path, { name: "Pet care" })).slug).toBe("pet-care");
  });

  it("never gives two categories the same slug", () => {
    const engine = memory();
    const id = nextIdOf("categories");
    const create = (name: string) => record(send(engine, "POST", "/v1/categories", { name }));
    // the third record's suffixed slug equals the second record's plain one
    create("Pets");
    expect(create(`Pets ${id + 2}`).slug).toBe(`pets-${id + 2}`);
    expect(create("Pets").slug).not.toBe(`pets-${id + 2}`);
    const all = (send(engine, "GET", "/v1/categories", undefined).body as { data: Row[] }).data;
    expect(new Set(all.map((category) => category.slug)).size).toBe(all.length);
  });

  it.each([
    [
      "a parent that is a subcategory",
      "POST",
      "/v1/categories",
      { name: "Deep", parentId: child.id },
      "parentId:nested_category",
    ],
    [
      "a parent that is itself",
      "PATCH",
      `/v1/categories/${child.id}`,
      { parentId: child.id },
      "parentId:self_reference",
    ],
    [
      "a parent for a category with subcategories",
      "PATCH",
      `/v1/categories/${topCategory.id}`,
      { parentId: otherTop.id },
      "parentId:has_children",
    ],
    [
      "no parent for a category with products",
      "PATCH",
      `/v1/categories/${subcategory.id}`,
      { parentId: null },
      "parentId:has_products",
    ],
  ])("refuses %s", (_name, method, path, body, expected) => {
    const response = send(memory(), method, path, body);
    expect(response.status).toBe(422);
    expect(codes(response)).toEqual([expected]);
  });
});

describe("products", () => {
  it("renames its images' alt text with the title and keeps everything else", () => {
    const [product] = corePack.data.products;
    if (!product) throw new Error("The core pack needs a product.");
    const path = `/v1/products/${product.id}`;
    const renamed = record(send(memory(), "PATCH", path, { title: "Replacement title" }));
    expect(renamed.images).toEqual(
      product.images.map((image, index) => ({
        ...image,
        alt: `Replacement title, photo ${index + 1}`,
      })),
    );
  });

  it("keeps rating and image files on PUT and derives slug and alt text from the title", () => {
    const [product] = corePack.data.products;
    if (!product) throw new Error("The core pack needs a product.");
    const replaced = send(memory(), "PUT", `/v1/products/${product.id}`, {
      ...createBodies.products,
      title: "Brass Trowel",
    });
    expect(replaced.body).toMatchObject({
      slug: `brass-trowel-${product.id}`,
      rating: product.rating,
      ratingCount: product.ratingCount,
      images: product.images.map((image, index) => ({
        ...image,
        alt: `Brass Trowel, photo ${index + 1}`,
      })),
      createdAt: product.createdAt,
      currency: "USD",
      stock: 0,
      status: "draft",
    });
  });
});

describe("references", () => {
  const missing = (name: ResourceName) => nextIdOf(name) + 100;
  const cases: [ResourceName, Record<string, unknown>, string, string][] = [
    ["posts", { ...createBodies.posts, userId: missing("users") }, "userId", "user"],
    ["comments", { ...createBodies.comments, postId: missing("posts") }, "postId", "post"],
    ["comments", { ...createBodies.comments, userId: missing("users") }, "userId", "user"],
    [
      "comments",
      { ...createBodies.comments, parentId: missing("comments") },
      "parentId",
      "comment",
    ],
    ["categories", { name: "Lost", parentId: missing("categories") }, "parentId", "category"],
    [
      "products",
      { ...createBodies.products, categoryId: missing("categories") },
      "categoryId",
      "category",
    ],
    ["todos", { ...createBodies.todos, userId: missing("users") }, "userId", "user"],
  ];

  it.each(cases)("refuses a %s write whose %s is missing", (name, body, field, noun) => {
    const response = send(memory(), "POST", `/v1/${name}`, body);
    expect(response.status).toBe(422);
    expect(issues(response)).toEqual([
      {
        field,
        code: "invalid_reference",
        message: `"${field}" must refer to an existing ${noun}.`,
      },
    ]);
  });

  it("refuses a reference to a record deleted in the same run", () => {
    const engine = memory();
    const id = nextIdOf("users");
    send(engine, "POST", "/v1/users", createBodies.users);
    expect(send(engine, "DELETE", `/v1/users/${id}`).status).toBe(204);
    const response = send(engine, "POST", "/v1/todos", { ...createBodies.todos, userId: id });
    expect(codes(response)).toEqual(["userId:invalid_reference"]);
  });
});

describe("deleting a record that others refer to", () => {
  const cases: [ResourceName, number][] = [
    ["users", 1],
    ["posts", pack.publishedPost.id],
    ["comments", pack.threadRoot.id],
    ["categories", pack.topCategory.id],
    ["categories", pack.subcategory.id],
  ];

  it.each(cases)("answers 409 for %s %i and names what depends on it", (name, id) => {
    const engine = memory();
    const dependents = dependentsOf(name, id);
    expect(dependents.length).toBeGreaterThan(0);
    const response = send(engine, "DELETE", `/v1/${name}/${id}`);
    expect(response.status).toBe(409);
    const listed = dependents.map(([relation, count]) => `${relation} (${count})`).join(", ");
    const noun = resourceNamed(name).singular.toLowerCase();
    expect(response.body).toMatchObject({
      title: "Conflict",
      code: "has_dependents",
      detail: `This ${noun} still has ${listed}. Delete or move them first.`,
    });
    expect(send(engine, "GET", `/v1/${name}/${id}`).status).toBe(200);
  });

  it("allows the delete once the dependents are gone", () => {
    const engine = memory();
    const replies = corePack.data.comments.filter(
      (comment) => comment.parentId === pack.threadRoot.id,
    );
    for (const reply of replies) {
      expect(send(engine, "DELETE", `/v1/comments/${reply.id}`).status).toBe(204);
    }
    expect(send(engine, "DELETE", `/v1/comments/${pack.threadRoot.id}`).status).toBe(204);
  });
});

describe("validation messages", () => {
  const { users, posts, products, todos } = createBodies;
  const issue = (field: string, code: string, text: string): Issue => ({
    field,
    code,
    message: `"${field}" ${text}.`,
  });
  const cases: [string, ResourceName, Record<string, unknown>, Issue[]][] = [
    [
      "a string too long",
      "posts",
      { ...posts, title: "x".repeat(201) },
      [issue("title", "too_long", "must be at most 200 characters")],
    ],
    [
      "a number below the minimum",
      "products",
      { ...products, priceMinor: -1 },
      [issue("priceMinor", "too_small", "must be at least 0")],
    ],
    [
      "a number above the maximum",
      "products",
      { ...products, stock: 1_000_001 },
      [issue("stock", "too_big", "must be at most 1000000")],
    ],
    [
      "a fraction for an integer",
      "products",
      { ...products, priceMinor: 1.5 },
      [issue("priceMinor", "invalid_type", "must be an integer")],
    ],
    [
      "a string for an integer",
      "todos",
      { ...todos, userId: "1" },
      [issue("userId", "invalid_type", "must be an integer")],
    ],
    [
      "a string for a nullable integer",
      "comments",
      { ...createBodies.comments, parentId: "1" },
      [issue("parentId", "invalid_type", "must be an integer")],
    ],
    [
      "a string for a boolean",
      "todos",
      { ...todos, completed: "yes" },
      [issue("completed", "invalid_type", "must be true or false")],
    ],
    [
      "too many array items",
      "posts",
      { ...posts, tags: Array(11).fill("t") },
      [issue("tags", "too_big", "must have at most 10 items")],
    ],
    [
      "an empty array item",
      "posts",
      { ...posts, tags: ["ok", ""] },
      [issue("tags.1", "too_short", "must not be empty")],
    ],
    [
      "an unknown enum value",
      "todos",
      { ...todos, priority: "urgent" },
      [issue("priority", "invalid_value", "must be one of: low, normal, high")],
    ],
    [
      "a bad email",
      "users",
      { ...users, email: "nope" },
      [issue("email", "invalid_format", "must be a valid email address")],
    ],
    [
      "a bad date",
      "todos",
      { ...todos, dueDate: "2026-13-01" },
      [issue("dueDate", "invalid_format", "must be a date in YYYY-MM-DD form")],
    ],
    [
      "a bad username",
      "users",
      { ...users, username: "Ines D" },
      [
        issue(
          "username",
          "invalid_format",
          'may only contain lowercase letters, digits, ".", "_" and "-", starting with a letter or digit',
        ),
      ],
    ],
    [
      "a bad currency",
      "products",
      { ...products, currency: "usd" },
      [issue("currency", "invalid_format", "must be three uppercase letters, such as USD")],
    ],
    [
      "bad nested fields",
      "users",
      { ...users, address: { street: "", city: 5, postalCode: "1", country: "us", floor: 2 } },
      [
        issue("address.street", "too_short", "must not be empty"),
        issue("address.city", "invalid_type", "must be a string"),
        issue(
          "address.country",
          "invalid_format",
          "must be a two-letter uppercase country code, such as US",
        ),
        {
          field: "address.floor",
          code: "unknown_field",
          message: 'Unknown field "address.floor".',
        },
      ],
    ],
    [
      "a string for an object",
      "users",
      { ...users, address: "Main Street" },
      [issue("address", "invalid_type", "must be an object")],
    ],
    [
      "a string for an array",
      "posts",
      { ...posts, tags: "a,b" },
      [issue("tags", "invalid_type", "must be an array")],
    ],
  ];

  it.each(cases)("words %s in the API's own terms", (_name, name, body, expected) => {
    const response = send(memory(), "POST", `/v1/${name}`, body);
    expect(response.status).toBe(422);
    expect(issues(response)).toEqual(expect.arrayContaining(expected));
    expect(issues(response)).toHaveLength(expected.length);
  });
});

describe("the packs under the write rules", () => {
  // derived fields must match the generator, and every record must pass every check
  it.each(
    Object.keys(fixturePacks).flatMap((fixture) =>
      resources.map((resource) => [fixture, resource.name] as const),
    ),
  )("round-trips every %s %s record through PUT and an empty PATCH", (fixture, name) => {
    const engine = createEngine({ state: "stateless", now: clock(), fixture });
    const fields = Object.keys(writeRules[name].input.shape);
    const records = fixturePacks[fixture]?.data[name] as readonly Row[];
    for (const [index, row] of records.entries()) {
      const path = `/v1/${name}/${row.id}`;
      const own = Object.fromEntries(fields.map((field) => [field, row[field]]));
      expect(send(engine, "PUT", path, own).body).toEqual({ ...row, updatedAt: at(2 * index) });
      expect(send(engine, "PATCH", path, {}).body).toEqual({
        ...row,
        updatedAt: at(2 * index + 1),
      });
    }
  });
});

describe("memory state", () => {
  it("stores frozen records", () => {
    const engine = memory();
    const id = nextIdOf("posts");
    send(engine, "POST", "/v1/posts", fullBodies.posts);
    const stored = record(send(engine, "GET", `/v1/posts/${id}`));
    expect(Object.isFrozen(stored)).toBe(true);
    expect(Object.isFrozen(stored.tags)).toBe(true);
    expect(Object.isFrozen(stored.cover)).toBe(true);
  });

  it("restores the pack and the next ids on reset", () => {
    const engine = memory();
    const [todo] = corePack.data.todos;
    if (!todo) throw new Error("The core pack needs a todo.");
    send(engine, "POST", "/v1/todos", createBodies.todos);
    send(engine, "PATCH", "/v1/users/1", { name: "Changed" });
    expect(send(engine, "DELETE", `/v1/todos/${todo.id}`).status).toBe(204);

    engine.reset();
    for (const resource of resources) {
      expect(total(engine, resource.name)).toBe(rows(resource.name).length);
    }
    expect(send(engine, "GET", "/v1/users/1").body).toEqual(corePack.data.users[0]);
    expect(send(engine, "GET", `/v1/todos/${todo.id}`).body).toEqual(todo);
    expect(send(engine, "POST", "/v1/todos", createBodies.todos).headers.location).toBe(
      `/v1/todos/${nextIdOf("todos")}`,
    );
  });
});
