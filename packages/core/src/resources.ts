import type { z } from "zod";
import {
  categorySchema,
  commentSchema,
  type PackData,
  postSchema,
  productSchema,
  todoSchema,
  userSchema,
} from "./contracts.js";

export type ResourceName = keyof PackData;

export interface Relation {
  resource: ResourceName;
  foreignKey: string;
}

// a to-one link: `field` on this record holds the id of a `resource` record
export interface Reference {
  resource: ResourceName;
  field: string;
}

export interface Resource {
  name: ResourceName;
  singular: string;
  schema: z.ZodObject;
  // fields holding an image object or an array of them
  images: readonly string[];
  relations: Readonly<Record<string, Relation>>;
  // fields `q` searches
  search: readonly string[];
  // fields usable as filters; each filter's type comes from the record schema
  filters: readonly string[];
  sortable: readonly string[];
  expansions: Readonly<Record<string, Reference>>;
}

export const resources: readonly Resource[] = [
  {
    name: "users",
    singular: "User",
    schema: userSchema,
    images: ["avatar"],
    relations: {
      posts: { resource: "posts", foreignKey: "userId" },
      comments: { resource: "comments", foreignKey: "userId" },
      todos: { resource: "todos", foreignKey: "userId" },
    },
    search: ["name", "username", "email"],
    filters: ["role", "status", "locale", "createdAt"],
    sortable: ["id", "name", "username", "email", "createdAt", "updatedAt"],
    expansions: {},
  },
  {
    name: "posts",
    singular: "Post",
    schema: postSchema,
    images: ["cover"],
    relations: { comments: { resource: "comments", foreignKey: "postId" } },
    search: ["title", "excerpt", "tags"],
    filters: ["userId", "status", "tags", "readingTimeMinutes", "publishedAt", "createdAt"],
    sortable: ["id", "title", "readingTimeMinutes", "publishedAt", "createdAt", "updatedAt"],
    expansions: { author: { resource: "users", field: "userId" } },
  },
  {
    name: "comments",
    singular: "Comment",
    schema: commentSchema,
    images: [],
    relations: { replies: { resource: "comments", foreignKey: "parentId" } },
    search: ["body"],
    filters: ["postId", "userId", "parentId", "likes", "createdAt"],
    sortable: ["id", "likes", "createdAt", "updatedAt"],
    expansions: {
      author: { resource: "users", field: "userId" },
      post: { resource: "posts", field: "postId" },
      parent: { resource: "comments", field: "parentId" },
    },
  },
  {
    name: "categories",
    singular: "Category",
    schema: categorySchema,
    images: ["image"],
    relations: {
      products: { resource: "products", foreignKey: "categoryId" },
      children: { resource: "categories", foreignKey: "parentId" },
    },
    search: ["name"],
    filters: ["parentId"],
    sortable: ["id", "name", "createdAt", "updatedAt"],
    expansions: { parent: { resource: "categories", field: "parentId" } },
  },
  {
    name: "products",
    singular: "Product",
    schema: productSchema,
    images: ["images"],
    relations: {},
    search: ["title", "description", "brand"],
    filters: [
      "categoryId",
      "status",
      "currency",
      "brand",
      "priceMinor",
      "rating",
      "ratingCount",
      "stock",
      "createdAt",
    ],
    sortable: [
      "id",
      "title",
      "priceMinor",
      "rating",
      "ratingCount",
      "stock",
      "createdAt",
      "updatedAt",
    ],
    expansions: { category: { resource: "categories", field: "categoryId" } },
  },
  {
    name: "todos",
    singular: "Todo",
    schema: todoSchema,
    images: [],
    relations: {},
    search: ["title"],
    filters: ["userId", "completed", "priority", "dueDate", "createdAt"],
    sortable: ["id", "title", "completed", "priority", "dueDate", "createdAt", "updatedAt"],
    expansions: { user: { resource: "users", field: "userId" } },
  },
];

export function resourceNamed(name: ResourceName): Resource {
  const resource = resources.find((candidate) => candidate.name === name);
  if (!resource) throw new Error(`Unknown resource "${name}".`);
  return resource;
}
