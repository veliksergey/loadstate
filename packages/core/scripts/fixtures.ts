// Builds the core@1 fixture pack. Deterministic: one seeded Faker, a fixed
// reference time, and no Math.random or wall clock.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { faker } from "@faker-js/faker";
import type {
  Category,
  Comment,
  FixtureManifest,
  Image,
  PackData,
  Post,
  Product,
  Todo,
  User,
} from "../src/contracts.ts";
import { readingMinutes, slugify } from "../src/text.ts";

export const packId = "core@1";
const seed = 20260101;
const referenceTime = "2026-01-01T00:00:00.000Z";
const reference = Date.parse(referenceTime);
const day = 86_400_000;

const counts = { users: 30, posts: 120, comments: 360, categories: 12, products: 96, todos: 150 };

const locales = [
  ["en-US", "America/New_York"],
  ["en-GB", "Europe/London"],
  ["de-DE", "Europe/Berlin"],
  ["fr-FR", "Europe/Paris"],
  ["es-MX", "America/Mexico_City"],
  ["ja-JP", "Asia/Tokyo"],
  ["pt-BR", "America/Sao_Paulo"],
  ["hi-IN", "Asia/Kolkata"],
] as const;

const categoryTree = [
  ["Home", ["Kitchen", "Lighting"]],
  ["Office", ["Desks", "Stationery"]],
  ["Outdoors", ["Camping", "Garden"]],
  ["Electronics", ["Audio", "Accessories"]],
] as const;

const postTags = [
  "accessibility",
  "api",
  "career",
  "css",
  "design",
  "frontend",
  "performance",
  "react",
  "testing",
  "tooling",
];

export function fakerVersion(): string {
  const manifest = new URL("../node_modules/@faker-js/faker/package.json", import.meta.url);
  return JSON.parse(readFileSync(manifest, "utf8")).version;
}

export function checksum(data: PackData): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
}

export function generateCorePack(): { manifest: FixtureManifest; data: PackData } {
  faker.seed(seed);
  faker.setDefaultRefDate(referenceTime);

  const users = makeUsers(counts.users);
  const categories = makeCategories();
  const products = makeProducts(counts.products, categories);
  const posts = makePosts(counts.posts, users);
  const comments = makeComments(counts.comments, posts, users);
  const todos = makeTodos(counts.todos, users);

  const data: PackData = { users, posts, comments, categories, products, todos };
  const manifest: FixtureManifest = {
    id: packId,
    generator: "packages/core/scripts/fixtures.ts",
    faker: fakerVersion(),
    seed,
    referenceTime,
    locale: "en",
    counts: {
      users: users.length,
      posts: posts.length,
      comments: comments.length,
      categories: categories.length,
      products: products.length,
      todos: todos.length,
    },
    checksum: checksum(data),
  };
  return { manifest, data };
}

function range<T>(count: number, make: (id: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(i + 1));
}

// a random instant in [from, to], never after the reference time
function between(from: number, to: number): string {
  return faker.date.between({ from, to: Math.min(to, reference) }).toISOString();
}

function after(from: string, maxDays: number): string {
  const start = Date.parse(from);
  return between(start, start + maxDays * day);
}

function latest(...isos: string[]): number {
  return Math.max(...isos.map((iso) => Date.parse(iso)));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function image(url: string, width: number, height: number, alt: string): Image {
  return { url, width, height, alt, color: faker.color.rgb() };
}

function makeUsers(count: number): User[] {
  const taken = new Set<string>();
  return range(count, (id) => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const name = `${firstName} ${lastName}`;
    const base = slugify(name).replaceAll("-", ".");
    const username = taken.has(base) ? `${base}${id}` : base;
    taken.add(username);
    const createdAt = between(
      Date.parse("2024-01-01T00:00:00.000Z"),
      Date.parse("2025-06-30T00:00:00.000Z"),
    );
    const [locale, timezone] = faker.helpers.arrayElement(locales);
    return {
      id,
      name,
      username,
      email: `${username}@example.com`,
      avatar: image(`/img/avatar/${username}?size=96`, 96, 96, name),
      role: faker.helpers.weightedArrayElement([
        { weight: 1, value: "admin" as const },
        { weight: 3, value: "editor" as const },
        { weight: 8, value: "viewer" as const },
      ]),
      status: faker.helpers.weightedArrayElement([
        { weight: 8, value: "active" as const },
        { weight: 1, value: "invited" as const },
        { weight: 1, value: "disabled" as const },
      ]),
      address: faker.datatype.boolean({ probability: 0.85 })
        ? {
            street: faker.location.streetAddress(),
            city: faker.location.city(),
            postalCode: faker.location.zipCode(),
            country: faker.location.countryCode(),
          }
        : null,
      company: faker.datatype.boolean({ probability: 0.7 }) ? faker.company.name() : null,
      locale,
      timezone,
      createdAt,
      updatedAt: after(createdAt, 120),
    };
  });
}

function makeCategories(): Category[] {
  const categories: Category[] = [];
  const add = (name: string, parentId: number | null) => {
    const id = categories.length + 1;
    const createdAt = between(
      Date.parse("2024-01-01T00:00:00.000Z"),
      Date.parse("2024-02-01T00:00:00.000Z"),
    );
    categories.push({
      id,
      parentId,
      name,
      slug: slugify(name),
      image: image(`/img/600x400?seed=category-${id}`, 600, 400, name),
      createdAt,
      updatedAt: after(createdAt, 300),
    });
    return id;
  };
  for (const [parent, children] of categoryTree) {
    const parentId = add(parent, null);
    for (const child of children) add(child, parentId);
  }
  return categories;
}

function makeProducts(count: number, categories: Category[]): Product[] {
  const leaves = categories.filter((category) => category.parentId !== null);
  return range(count, (id) => {
    const category = faker.helpers.arrayElement(leaves);
    const title = faker.commerce.productName();
    const ratingCount = faker.datatype.boolean({ probability: 0.1 })
      ? 0
      : faker.number.int({ min: 1, max: 500 });
    const createdAt = between(
      Date.parse(category.createdAt),
      Date.parse("2025-11-30T00:00:00.000Z"),
    );
    return {
      id,
      categoryId: category.id,
      title,
      slug: `${slugify(title)}-${id}`,
      description: faker.commerce.productDescription(),
      priceMinor: faker.number.int({ min: 1, max: 499 }) * 100 + 99,
      currency: "USD",
      rating: ratingCount === 0 ? 0 : faker.number.float({ min: 1, max: 5, fractionDigits: 1 }),
      ratingCount,
      stock: faker.datatype.boolean({ probability: 0.1 })
        ? 0
        : faker.number.int({ min: 1, max: 250 }),
      brand: faker.company.name(),
      images: range(faker.number.int({ min: 1, max: 3 }), (n) =>
        image(`/img/800x800?seed=product-${id}-${n}`, 800, 800, `${title}, photo ${n}`),
      ),
      status: faker.helpers.weightedArrayElement([
        { weight: 8, value: "active" as const },
        { weight: 1, value: "draft" as const },
        { weight: 1, value: "discontinued" as const },
      ]),
      createdAt,
      updatedAt: after(createdAt, 30),
    };
  });
}

function makePosts(count: number, users: User[]): Post[] {
  return range(count, (id) => {
    const author = faker.helpers.arrayElement(users);
    const title = capitalize(faker.lorem.words({ min: 3, max: 7 }));
    const paragraphs = range(faker.number.int({ min: 3, max: 6 }), () =>
      faker.lorem.paragraph({ min: 3, max: 7 }),
    );
    const list = range(faker.number.int({ min: 2, max: 4 }), () => `- ${faker.lorem.sentence()}`);
    const body = [
      `## ${capitalize(faker.lorem.words(3))}`,
      paragraphs[0],
      list.join("\n"),
      ...paragraphs.slice(1),
    ].join("\n\n");
    const status = faker.helpers.weightedArrayElement([
      { weight: 7, value: "published" as const },
      { weight: 2, value: "draft" as const },
      { weight: 1, value: "archived" as const },
    ]);
    const createdAt = between(Date.parse(author.createdAt), Date.parse("2025-12-15T00:00:00.000Z"));
    const publishedAt = status === "draft" ? null : after(createdAt, 10);
    return {
      id,
      userId: author.id,
      title,
      slug: `${slugify(title)}-${id}`,
      excerpt: faker.lorem.sentences({ min: 1, max: 2 }),
      body,
      cover: image(`/img/1200x630?seed=post-${id}`, 1200, 630, title),
      tags: faker.helpers.arrayElements(postTags, { min: 1, max: 3 }).sort(),
      readingTimeMinutes: readingMinutes(body),
      status,
      publishedAt,
      createdAt,
      updatedAt: after(publishedAt ?? createdAt, 20),
    };
  });
}

function makeComments(count: number, posts: Post[], users: User[]): Comment[] {
  const published = posts.filter((post) => post.publishedAt !== null);
  const comments: Comment[] = [];
  for (let id = 1; id <= count; id++) {
    const post = faker.helpers.arrayElement(published);
    const author = faker.helpers.arrayElement(users);
    const parents = comments.filter((c) => c.postId === post.id && c.parentId === null);
    const parent =
      parents.length > 0 && faker.datatype.boolean({ probability: 0.3 })
        ? faker.helpers.arrayElement(parents)
        : null;
    // not before the post was published, the author joined, or the parent was written
    const bounds = [post.publishedAt ?? post.createdAt, author.createdAt];
    if (parent) bounds.push(parent.createdAt);
    const createdAt = between(latest(...bounds), reference - day);
    comments.push({
      id,
      postId: post.id,
      userId: author.id,
      parentId: parent?.id ?? null,
      body: faker.lorem.sentences({ min: 1, max: 3 }),
      likes: faker.number.int({ min: 0, max: 120 }),
      createdAt,
      updatedAt: after(createdAt, 5),
    });
  }
  return comments;
}

function makeTodos(count: number, users: User[]): Todo[] {
  return range(count, (id) => {
    const owner = faker.helpers.arrayElement(users);
    const createdAt = between(
      latest(owner.createdAt, "2025-01-01T00:00:00.000Z"),
      Date.parse("2025-12-31T00:00:00.000Z"),
    );
    return {
      id,
      userId: owner.id,
      title: capitalize(faker.hacker.phrase()),
      completed: faker.datatype.boolean({ probability: 0.4 }),
      // due dates may fall after the reference time
      dueDate: faker.datatype.boolean({ probability: 0.7 })
        ? faker.date
            .between({ from: "2025-10-01T00:00:00.000Z", to: "2026-03-31T00:00:00.000Z" })
            .toISOString()
            .slice(0, 10)
        : null,
      priority: faker.helpers.weightedArrayElement([
        { weight: 2, value: "low" as const },
        { weight: 5, value: "normal" as const },
        { weight: 2, value: "high" as const },
      ]),
      createdAt,
      updatedAt: after(createdAt, 30),
    };
  });
}
