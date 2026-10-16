import { z } from "zod";

const id = z.int().positive();
const foreignKey = z.int().positive();
const timestamp = z.iso.datetime();
const timestamps = { createdAt: timestamp, updatedAt: timestamp };
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const imageSchema = z.strictObject({
  // root-relative in fixtures, absolute in API responses
  url: z.string().min(1),
  width: z.int().positive(),
  height: z.int().positive(),
  alt: z.string(),
  color: z.string().regex(/^#[0-9a-f]{6}$/),
});

export const addressSchema = z.strictObject({
  street: z.string().min(1).max(200),
  city: z.string().min(1).max(100),
  postalCode: z.string().min(1).max(20),
  country: z.string().regex(/^[A-Z]{2}$/),
});

// field rules shared by each stored record and its writable input
const user = {
  name: z.string().min(1).max(100),
  username: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-z0-9][a-z0-9._-]*$/),
  email: z.email().max(254),
  role: z.enum(["admin", "editor", "viewer"]),
  status: z.enum(["active", "invited", "disabled"]),
  address: addressSchema.nullable(),
  company: z.string().min(1).max(100).nullable(),
  locale: z.string().min(2).max(35),
  timezone: z.string().min(1).max(64),
};

const post = {
  userId: foreignKey,
  title: z.string().min(1).max(200),
  excerpt: z.string().min(1).max(500),
  body: z.string().min(1).max(20_000),
  tags: z.array(z.string().min(1).max(30)).max(10),
  status: z.enum(["draft", "published", "archived"]),
};

const comment = {
  postId: foreignKey,
  userId: foreignKey,
  parentId: foreignKey.nullable(),
  body: z.string().min(1).max(2_000),
};

const category = {
  parentId: foreignKey.nullable(),
  name: z.string().min(1).max(60),
};

const product = {
  categoryId: foreignKey,
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  priceMinor: z.int().nonnegative().max(100_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
  stock: z.int().nonnegative().max(1_000_000),
  brand: z.string().min(1).max(100),
  status: z.enum(["active", "draft", "discontinued"]),
};

const todo = {
  userId: foreignKey,
  title: z.string().min(1).max(200),
  completed: z.boolean(),
  dueDate: z.iso.date().nullable(),
  priority: z.enum(["low", "normal", "high"]),
};

export const userSchema = z.strictObject({
  id,
  name: user.name,
  username: user.username,
  email: user.email,
  avatar: imageSchema,
  role: user.role,
  status: user.status,
  address: user.address,
  company: user.company,
  locale: user.locale,
  timezone: user.timezone,
  ...timestamps,
});

export const userCreateSchema = z.strictObject({
  name: user.name,
  username: user.username,
  email: user.email,
  role: user.role.optional(),
  status: user.status.optional(),
  address: user.address.optional(),
  company: user.company.optional(),
  locale: user.locale.optional(),
  timezone: user.timezone.optional(),
});

export const postSchema = z.strictObject({
  id,
  userId: post.userId,
  title: post.title,
  slug,
  excerpt: post.excerpt,
  body: post.body,
  cover: imageSchema,
  tags: post.tags,
  readingTimeMinutes: z.int().positive(),
  status: post.status,
  publishedAt: timestamp.nullable(),
  ...timestamps,
});

export const postCreateSchema = z.strictObject({
  userId: post.userId,
  title: post.title,
  body: post.body,
  excerpt: post.excerpt.optional(),
  tags: post.tags.optional(),
  status: post.status.optional(),
});

export const commentSchema = z.strictObject({
  id,
  postId: comment.postId,
  userId: comment.userId,
  parentId: comment.parentId,
  body: comment.body,
  likes: z.int().nonnegative(),
  ...timestamps,
});

export const commentCreateSchema = z.strictObject({
  postId: comment.postId,
  userId: comment.userId,
  body: comment.body,
  parentId: comment.parentId.optional(),
});

export const categorySchema = z.strictObject({
  id,
  parentId: category.parentId,
  name: category.name,
  slug,
  image: imageSchema,
  ...timestamps,
});

export const categoryCreateSchema = z.strictObject({
  name: category.name,
  parentId: category.parentId.optional(),
});

export const productSchema = z.strictObject({
  id,
  categoryId: product.categoryId,
  title: product.title,
  slug,
  description: product.description,
  priceMinor: product.priceMinor,
  currency: product.currency,
  rating: z.number().min(0).max(5),
  ratingCount: z.int().nonnegative(),
  stock: product.stock,
  brand: product.brand,
  images: z.array(imageSchema).min(1),
  status: product.status,
  ...timestamps,
});

export const productCreateSchema = z.strictObject({
  categoryId: product.categoryId,
  title: product.title,
  description: product.description,
  priceMinor: product.priceMinor,
  brand: product.brand,
  currency: product.currency.optional(),
  stock: product.stock.optional(),
  status: product.status.optional(),
});

export const todoSchema = z.strictObject({
  id,
  userId: todo.userId,
  title: todo.title,
  completed: todo.completed,
  dueDate: todo.dueDate,
  priority: todo.priority,
  ...timestamps,
});

export const todoCreateSchema = z.strictObject({
  userId: todo.userId,
  title: todo.title,
  completed: todo.completed.optional(),
  dueDate: todo.dueDate.optional(),
  priority: todo.priority.optional(),
});

export type Image = z.infer<typeof imageSchema>;
export type UserCreate = z.infer<typeof userCreateSchema>;
export type User = z.infer<typeof userSchema>;
export type Post = z.infer<typeof postSchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Category = z.infer<typeof categorySchema>;
export type Product = z.infer<typeof productSchema>;
export type Todo = z.infer<typeof todoSchema>;
export type PostCreate = z.infer<typeof postCreateSchema>;
export type CommentCreate = z.infer<typeof commentCreateSchema>;
export type CategoryCreate = z.infer<typeof categoryCreateSchema>;
export type ProductCreate = z.infer<typeof productCreateSchema>;
export type TodoCreate = z.infer<typeof todoCreateSchema>;

export interface PackData {
  users: User[];
  posts: Post[];
  comments: Comment[];
  categories: Category[];
  products: Product[];
  todos: Todo[];
}

export interface FixtureManifest {
  id: string;
  generator: string;
  faker: string;
  seed: number;
  referenceTime: string;
  locale: string;
  counts: Record<keyof PackData, number>;
  checksum: string;
}
