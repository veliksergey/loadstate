import { corePack, type ResourceName, resourceNamed } from "../src/index.js";

export type Row = { id: number } & Record<string, unknown>;
export const rows = (name: ResourceName) => corePack.data[name] as readonly Row[];
export const nextIdOf = (name: ResourceName) => Math.max(...rows(name).map((row) => row.id)) + 1;

// names of the relations that still point at a record, with their counts
export function dependentsOf(name: ResourceName, id: number): [string, number][] {
  return Object.entries(resourceNamed(name).relations).flatMap(
    ([relation, { resource, foreignKey }]) => {
      const count = rows(resource).filter((row) => row[foreignKey] === id).length;
      return count > 0 ? [[relation, count] as [string, number]] : [];
    },
  );
}

function pick<T>(found: T | undefined, what: string): T {
  if (found === undefined) throw new Error(`The core pack has no ${what}.`);
  return found;
}

const { posts, comments, categories } = corePack.data;
const hasComments = (postId: number) => comments.some((comment) => comment.postId === postId);
const hasReplies = (commentId: number) =>
  comments.some((comment) => comment.parentId === commentId);

export const pack = {
  publishedPost: pick(
    posts.find((post) => post.status === "published" && hasComments(post.id)),
    "published post with comments",
  ),
  quietPost: pick(
    posts.find((post) => post.status === "published" && !hasComments(post.id)),
    "published post without comments",
  ),
  draftPost: pick(
    posts.find((post) => post.status === "draft"),
    "draft post",
  ),
  threadRoot: pick(
    comments.find((comment) => comment.parentId === null && hasReplies(comment.id)),
    "comment with replies",
  ),
  loneComment: pick(
    comments.find((comment) => comment.parentId === null && !hasReplies(comment.id)),
    "top-level comment without replies",
  ),
  reply: pick(
    comments.find((comment) => comment.parentId !== null),
    "reply",
  ),
  topCategory: pick(
    categories.find((category) => category.parentId === null),
    "top-level category",
  ),
  subcategory: pick(
    categories.find(
      (category) =>
        category.parentId !== null &&
        corePack.data.products.some((product) => product.categoryId === category.id),
    ),
    "subcategory with products",
  ),
};

// the smallest valid create body for each resource
export const createBodies: Record<ResourceName, Record<string, unknown>> = {
  users: { name: "Ines Duarte", username: "ines.duarte", email: "ines.duarte@example.com" },
  posts: { userId: 1, title: "Writing tests first", body: "A short body." },
  comments: { postId: pack.publishedPost.id, userId: 1, body: "Nice post." },
  categories: { name: "Pet supplies" },
  products: {
    categoryId: pack.subcategory.id,
    title: "Steel trowel",
    description: "A small hand trowel.",
    priceMinor: 1999,
    brand: "Acme",
  },
  todos: { userId: 1, title: "Buy milk" },
};

// a second valid body per resource, with every optional field set
export const fullBodies: Record<ResourceName, Record<string, unknown>> = {
  users: {
    name: "Ana Lima",
    username: "ana.lima",
    email: "ana.lima@example.com",
    role: "editor",
    status: "invited",
    address: { street: "1 Main Street", city: "Lisbon", postalCode: "1000-001", country: "PT" },
    company: "Lima Studio",
    locale: "pt-PT",
    timezone: "Europe/Lisbon",
  },
  posts: {
    userId: 2,
    title: "Second thoughts",
    body: "Another body.",
    excerpt: "Custom excerpt.",
    tags: ["testing"],
    status: "archived",
  },
  comments: { postId: pack.publishedPost.id, userId: 2, body: "Replying.", parentId: null },
  categories: { name: "Pet beds", parentId: pack.topCategory.id },
  products: {
    categoryId: pack.subcategory.id,
    title: "Copper trowel",
    description: "A shiny hand trowel.",
    priceMinor: 2999,
    brand: "Acme",
    currency: "EUR",
    stock: 5,
    status: "active",
  },
  todos: {
    userId: 2,
    title: "Call home",
    completed: true,
    dueDate: "2026-04-01",
    priority: "high",
  },
};

// fields each record carries but no client may write
export const readOnly: Record<ResourceName, string[]> = {
  users: ["id", "avatar", "createdAt", "updatedAt"],
  posts: ["id", "slug", "cover", "readingTimeMinutes", "publishedAt", "createdAt", "updatedAt"],
  comments: ["id", "likes", "createdAt", "updatedAt"],
  categories: ["id", "slug", "image", "createdAt", "updatedAt"],
  products: ["id", "slug", "images", "rating", "ratingCount", "createdAt", "updatedAt"],
  todos: ["id", "createdAt", "updatedAt"],
};
