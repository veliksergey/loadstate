import type { z } from "zod";
import {
  type Category,
  type Comment,
  categoryCreateSchema,
  commentCreateSchema,
  type Image,
  type Post,
  type Product,
  postCreateSchema,
  productCreateSchema,
  type Todo,
  todoCreateSchema,
  type User,
  userCreateSchema,
} from "./contracts.js";
import type { ResourceName } from "./resources.js";
import type { FieldIssue } from "./response.js";
import { colorFor, excerptFrom, readingMinutes, slugify } from "./text.js";

export type Row = { id: number } & Record<string, unknown>;
export type Values = Record<string, unknown>;

export interface WriteContext {
  id: number;
  at: string;
  existing: Row | undefined;
  rows(name: ResourceName): readonly Row[];
}

export interface WriteRule {
  // writable fields; PATCH uses the partial
  input: z.ZodObject;
  // values for omitted optional fields on POST and PUT
  defaults: Readonly<Values>;
  references: Readonly<Record<string, ResourceName>>;
  // fields no two records may share, compared case-insensitively
  unique: readonly string[];
  check?(values: Values, context: WriteContext): FieldIssue[];
  build(values: Values, context: WriteContext): Row;
}

const issue = (field: string, code: string, text: string): FieldIssue => ({
  field,
  code,
  message: `"${field}" ${text}.`,
});

const image = (url: string, width: number, height: number, alt: string): Image => ({
  url,
  width,
  height,
  alt,
  color: colorFor(alt),
});

const stamps = ({ existing, at }: WriteContext) => ({
  createdAt: (existing?.createdAt as string | undefined) ?? at,
  updatedAt: at,
});

const hasChildren = (rows: readonly Row[], field: string, id: number) =>
  rows.some((row) => row[field] === id);

const users: WriteRule = {
  input: userCreateSchema,
  defaults: {
    role: "viewer",
    status: "active",
    address: null,
    company: null,
    locale: "en-US",
    timezone: "UTC",
  },
  references: {},
  unique: ["username", "email"],
  build(values, context) {
    const v = values as Omit<User, "id" | "avatar" | "createdAt" | "updatedAt">;
    const existing = context.existing as User | undefined;
    // the avatar path follows the username; keep it while the username stays
    const avatar =
      existing && existing.username === v.username
        ? { ...existing.avatar, alt: v.name }
        : image(`/img/avatar/${encodeURIComponent(v.username)}?size=96`, 96, 96, v.name);
    return {
      id: context.id,
      name: v.name,
      username: v.username,
      email: v.email,
      avatar,
      role: v.role,
      status: v.status,
      address: v.address,
      company: v.company,
      locale: v.locale,
      timezone: v.timezone,
      ...stamps(context),
    };
  },
};

const posts: WriteRule = {
  input: postCreateSchema,
  defaults: { tags: [], status: "draft" },
  references: { userId: "users" },
  unique: [],
  check(values, context) {
    const v = values as Pick<Post, "status">;
    // comments may only sit on published or archived posts
    return context.existing &&
      v.status === "draft" &&
      hasChildren(context.rows("comments"), "postId", context.id)
      ? [issue("status", "has_comments", "cannot return to draft while the post has comments")]
      : [];
  },
  build(values, context) {
    const v = values as Pick<Post, "userId" | "title" | "body" | "tags" | "status"> & {
      excerpt?: string;
    };
    const existing = context.existing as Post | undefined;
    return {
      id: context.id,
      userId: v.userId,
      title: v.title,
      slug: `${slugify(v.title) || "post"}-${context.id}`,
      excerpt: v.excerpt ?? excerptFrom(v.body, v.title),
      body: v.body,
      cover: existing
        ? { ...existing.cover, alt: v.title }
        : image(`/img/1200x630?seed=post-${context.id}`, 1200, 630, v.title),
      tags: v.tags,
      readingTimeMinutes: readingMinutes(v.body),
      status: v.status,
      // set when a post leaves draft, cleared when it returns to draft
      publishedAt: v.status === "draft" ? null : (existing?.publishedAt ?? context.at),
      ...stamps(context),
    };
  },
};

const comments: WriteRule = {
  input: commentCreateSchema,
  defaults: { parentId: null },
  references: { postId: "posts", userId: "users", parentId: "comments" },
  unique: [],
  check(values, context) {
    const v = values as Pick<Comment, "postId" | "parentId">;
    const issues: FieldIssue[] = [];
    const post = context.rows("posts").find((row) => row.id === v.postId);
    if (post && post.status === "draft") {
      issues.push(issue("postId", "not_published", "must refer to a published or archived post"));
    }
    const replies = context.existing
      ? hasChildren(context.rows("comments"), "parentId", context.id)
      : false;
    if (replies && context.existing?.postId !== v.postId) {
      issues.push(issue("postId", "has_replies", "cannot change while the comment has replies"));
    }
    if (v.parentId !== null) {
      const parent = context.rows("comments").find((row) => row.id === v.parentId);
      if (parent?.id === context.id) {
        issues.push(issue("parentId", "self_reference", "cannot refer to the comment itself"));
      } else if (parent && parent.parentId !== null) {
        issues.push(issue("parentId", "nested_reply", "must refer to a top-level comment"));
      } else if (parent && parent.postId !== v.postId) {
        issues.push(issue("parentId", "other_post", "must refer to a comment on the same post"));
      }
      if (replies) {
        issues.push(
          issue("parentId", "has_replies", "must stay null while the comment has replies"),
        );
      }
    }
    return issues;
  },
  build(values, context) {
    const v = values as Pick<Comment, "postId" | "userId" | "parentId" | "body">;
    const existing = context.existing as Comment | undefined;
    return {
      id: context.id,
      postId: v.postId,
      userId: v.userId,
      parentId: v.parentId,
      body: v.body,
      likes: existing?.likes ?? 0,
      ...stamps(context),
    };
  },
};

const categories: WriteRule = {
  input: categoryCreateSchema,
  defaults: { parentId: null },
  references: { parentId: "categories" },
  unique: [],
  check(values, context) {
    const v = values as Pick<Category, "parentId">;
    const issues: FieldIssue[] = [];
    const children = hasChildren(context.rows("categories"), "parentId", context.id);
    const products = hasChildren(context.rows("products"), "categoryId", context.id);
    if (v.parentId === null) {
      if (context.existing && products) {
        issues.push(
          issue("parentId", "has_products", "must stay set while the category has products"),
        );
      }
      return issues;
    }
    const parent = context.rows("categories").find((row) => row.id === v.parentId);
    if (parent?.id === context.id) {
      issues.push(issue("parentId", "self_reference", "cannot refer to the category itself"));
    } else if (parent && parent.parentId !== null) {
      // a top-level parent never has products: they live only in subcategories
      issues.push(issue("parentId", "nested_category", "must refer to a top-level category"));
    }
    if (context.existing && children) {
      issues.push(
        issue("parentId", "has_children", "must stay null while the category has subcategories"),
      );
    }
    return issues;
  },
  build(values, context) {
    const v = values as Pick<Category, "name" | "parentId">;
    const existing = context.existing as Category | undefined;
    const used = new Set(
      context
        .rows("categories")
        .filter((row) => row.id !== context.id)
        .map((row) => row.slug),
    );
    // an unchanged name keeps its slug; each pass lengthens a new one, so the loop ends
    let slug = existing?.name === v.name ? existing.slug : slugify(v.name) || "category";
    while (used.has(slug)) slug = `${slug}-${context.id}`;
    return {
      id: context.id,
      parentId: v.parentId,
      name: v.name,
      slug,
      image: existing
        ? { ...existing.image, alt: v.name }
        : image(`/img/600x400?seed=category-${context.id}`, 600, 400, v.name),
      ...stamps(context),
    };
  },
};

const products: WriteRule = {
  input: productCreateSchema,
  defaults: { currency: "USD", stock: 0, status: "draft" },
  references: { categoryId: "categories" },
  unique: [],
  check(values, context) {
    const v = values as Pick<Product, "categoryId">;
    const category = context.rows("categories").find((row) => row.id === v.categoryId);
    return category && category.parentId === null
      ? [issue("categoryId", "not_subcategory", "must refer to a subcategory")]
      : [];
  },
  build(values, context) {
    const v = values as Omit<
      Product,
      "id" | "slug" | "rating" | "ratingCount" | "images" | "createdAt" | "updatedAt"
    >;
    const existing = context.existing as Product | undefined;
    return {
      id: context.id,
      categoryId: v.categoryId,
      title: v.title,
      slug: `${slugify(v.title) || "product"}-${context.id}`,
      description: v.description,
      priceMinor: v.priceMinor,
      currency: v.currency,
      rating: existing?.rating ?? 0,
      ratingCount: existing?.ratingCount ?? 0,
      stock: v.stock,
      brand: v.brand,
      images: existing
        ? existing.images.map((photo, i) => ({ ...photo, alt: `${v.title}, photo ${i + 1}` }))
        : [image(`/img/800x800?seed=product-${context.id}-1`, 800, 800, `${v.title}, photo 1`)],
      status: v.status,
      ...stamps(context),
    };
  },
};

const todos: WriteRule = {
  input: todoCreateSchema,
  defaults: { completed: false, dueDate: null, priority: "normal" },
  references: { userId: "users" },
  unique: [],
  build(values, context) {
    const v = values as Omit<Todo, "id" | "createdAt" | "updatedAt">;
    return {
      id: context.id,
      userId: v.userId,
      title: v.title,
      completed: v.completed,
      dueDate: v.dueDate,
      priority: v.priority,
      ...stamps(context),
    };
  },
};

export const writeRules: Readonly<Record<ResourceName, WriteRule>> = {
  users,
  posts,
  comments,
  categories,
  products,
  todos,
};
