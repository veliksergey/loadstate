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

export interface Resource {
  name: ResourceName;
  singular: string;
  schema: z.ZodObject;
  // fields holding an image object or an array of them
  images: readonly string[];
  relations: Readonly<Record<string, Relation>>;
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
  },
  {
    name: "posts",
    singular: "Post",
    schema: postSchema,
    images: ["cover"],
    relations: { comments: { resource: "comments", foreignKey: "postId" } },
  },
  {
    name: "comments",
    singular: "Comment",
    schema: commentSchema,
    images: [],
    relations: { replies: { resource: "comments", foreignKey: "parentId" } },
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
  },
  {
    name: "products",
    singular: "Product",
    schema: productSchema,
    images: ["images"],
    relations: {},
  },
  {
    name: "todos",
    singular: "Todo",
    schema: todoSchema,
    images: [],
    relations: {},
  },
];

export function resourceNamed(name: ResourceName): Resource {
  const resource = resources.find((candidate) => candidate.name === name);
  if (!resource) throw new Error(`Unknown resource "${name}".`);
  return resource;
}
