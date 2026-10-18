// Builds the edge@1 fixture pack by hand: boundary values a front end must render.
// Deterministic: no Faker, no Math.random, no wall clock.
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
import { colorFor, readingMinutes, slugify } from "../src/text.ts";
import { checksum } from "./fixtures.ts";

export const edgePackId = "edge@1";
const referenceTime = "2026-01-01T00:00:00.000Z";
const epoch = "1970-01-01T00:00:00.000Z";

// ASCII text of an exact length, ending in a letter so nothing trims it
function sized(length: number, words: string): string {
  return `${words.repeat(Math.ceil(length / words.length)).slice(0, length - 1)}z`;
}

const image = (url: string, width: number, height: number, alt: string): Image => ({
  url,
  width,
  height,
  alt,
  color: colorFor(alt),
});

function user(id: number, fields: Omit<User, "id" | "email" | "avatar">): User {
  return {
    id,
    name: fields.name,
    username: fields.username,
    email: `${fields.username}@example.com`,
    avatar: image(`/img/avatar/${fields.username}?size=96`, 96, 96, fields.name),
    role: fields.role,
    status: fields.status,
    address: fields.address,
    company: fields.company,
    locale: fields.locale,
    timezone: fields.timezone,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

function post(
  id: number,
  fields: Omit<Post, "id" | "slug" | "cover" | "readingTimeMinutes">,
): Post {
  return {
    id,
    userId: fields.userId,
    title: fields.title,
    slug: `${slugify(fields.title) || "post"}-${id}`,
    excerpt: fields.excerpt,
    body: fields.body,
    cover: image(`/img/1200x630?seed=post-${id}`, 1200, 630, fields.title),
    tags: fields.tags,
    readingTimeMinutes: readingMinutes(fields.body),
    status: fields.status,
    publishedAt: fields.publishedAt,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

function category(id: number, fields: Omit<Category, "id" | "image">): Category {
  return {
    id,
    parentId: fields.parentId,
    name: fields.name,
    slug: fields.slug,
    image: image(`/img/600x400?seed=category-${id}`, 600, 400, fields.name),
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

function product(
  id: number,
  photos: number,
  fields: Omit<Product, "id" | "slug" | "images" | "currency">,
): Product {
  return {
    id,
    categoryId: fields.categoryId,
    title: fields.title,
    slug: `${slugify(fields.title) || "product"}-${id}`,
    description: fields.description,
    priceMinor: fields.priceMinor,
    currency: "USD",
    rating: fields.rating,
    ratingCount: fields.ratingCount,
    stock: fields.stock,
    brand: fields.brand,
    images: Array.from({ length: photos }, (_, i) =>
      image(
        `/img/800x800?seed=product-${id}-${i + 1}`,
        800,
        800,
        `${fields.title}, photo ${i + 1}`,
      ),
    ),
    status: fields.status,
    createdAt: fields.createdAt,
    updatedAt: fields.updatedAt,
  };
}

const longBody = `## A very long article\n\n${sized(19_970, "Long form text for layout and scrolling tests. ")}`;

function makeUsers(): User[] {
  return [
    user(1, {
      name: "Zoë Ångström-Núñez",
      username: "zoe.angstrom",
      role: "admin",
      status: "active",
      address: {
        street: "Drottninggatan 1",
        city: "Stockholm",
        postalCode: "111 51",
        country: "SE",
      },
      company: null,
      locale: "sv-SE",
      timezone: "Europe/Stockholm",
      createdAt: epoch,
      updatedAt: "2025-03-30T01:00:00.000Z",
    }),
    user(2, {
      name: "محمد العلي",
      username: "mohammed.alali",
      role: "editor",
      status: "active",
      address: { street: "طريق الملك فهد 1", city: "الرياض", postalCode: "12211", country: "SA" },
      company: "شركة المثال",
      locale: "ar-SA",
      timezone: "Asia/Riyadh",
      createdAt: "1999-12-31T23:59:59.999Z",
      updatedAt: "2000-01-01T00:00:00.000Z",
    }),
    user(3, {
      name: "יעל כהן",
      username: "yael.cohen",
      role: "viewer",
      status: "active",
      address: null,
      company: null,
      locale: "he-IL",
      timezone: "Asia/Jerusalem",
      createdAt: "2024-02-29T23:59:59.999Z",
      updatedAt: "2024-03-01T00:00:00.000Z",
    }),
    user(4, {
      name: "李小龍",
      username: "li.xiaolong",
      role: "viewer",
      status: "active",
      address: { street: "中山路 100号", city: "上海", postalCode: "200000", country: "CN" },
      company: "示例公司",
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      createdAt: "2010-06-15T08:30:00.000Z",
      updatedAt: "2010-06-15T08:30:00.000Z",
    }),
    user(5, {
      name: "Alex Kim",
      username: "alex.kim",
      role: "editor",
      status: "active",
      address: null,
      company: "Kim & Kim",
      locale: "en-US",
      timezone: "America/Los_Angeles",
      createdAt: "2025-11-02T06:00:00.000Z",
      updatedAt: "2025-11-02T06:00:00.000Z",
    }),
    user(6, {
      name: "Alex Kim",
      username: "alex.kim.2",
      role: "viewer",
      status: "active",
      address: null,
      company: null,
      locale: "ko-KR",
      timezone: "Asia/Seoul",
      createdAt: "2025-11-02T06:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    }),
    user(7, {
      name: sized(100, "Maximilian Alexander von Habsburg-Lothringen "),
      username: sized(50, "maximilian.alexander.von.habsburg.lothringen."),
      role: "viewer",
      status: "active",
      address: {
        street: sized(200, "Long Street Name Avenue "),
        city: sized(100, "Llanfairpwllgwyngyll "),
        postalCode: sized(20, "AB12CD34EF"),
        country: "GB",
      },
      company: sized(100, "Very Long Company Name International Holdings "),
      locale: "en-GB",
      timezone: "Europe/London",
      createdAt: "2020-01-01T00:00:00.000Z",
      updatedAt: referenceTime,
    }),
    user(8, {
      name: "😀 Emoji Ünicode 👩‍👩‍👧‍👦",
      username: "emoji.person",
      role: "admin",
      status: "disabled",
      address: null,
      company: null,
      locale: "en-US",
      timezone: "UTC",
      createdAt: "2023-07-01T12:00:00.000Z",
      updatedAt: "2023-07-01T12:00:00.000Z",
    }),
    user(9, {
      name: "Q",
      username: "q",
      role: "viewer",
      status: "invited",
      address: null,
      company: null,
      locale: "fr-CA",
      timezone: "America/Toronto",
      createdAt: "2025-12-31T23:59:59.999Z",
      updatedAt: "2025-12-31T23:59:59.999Z",
    }),
  ];
}

function makePosts(): Post[] {
  return [
    post(1, {
      userId: 7,
      title: sized(200, "An extremely long headline that must wrap or truncate "),
      excerpt: sized(500, "A long excerpt for card layouts. "),
      body: longBody,
      tags: Array.from({ length: 10 }, (_, i) => sized(30, `long-tag-${i}-`)),
      status: "published",
      publishedAt: "2021-01-02T00:00:00.000Z",
      createdAt: "2021-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
    }),
    post(2, {
      userId: 2,
      title: "مرحبا بالعالم: دليل البداية",
      excerpt: "مقدمة قصيرة باللغة العربية.",
      body: "## مقدمة\n\nهذا نص تجريبي باللغة العربية لاختبار الاتجاه من اليمين إلى اليسار.",
      tags: [],
      status: "published",
      publishedAt: "2000-01-02T00:00:00.000Z",
      createdAt: "2000-01-02T00:00:00.000Z",
      updatedAt: "2000-01-03T00:00:00.000Z",
    }),
    post(3, {
      userId: 8,
      title: "🚀🚀🚀 Launch 🚀🚀🚀",
      excerpt: "🎉 Emoji everywhere.",
      body: "🎉🎉🎉 Emoji in the body too: 👩‍💻 👨🏽‍🚀 🏳️‍🌈",
      tags: ["emoji"],
      status: "archived",
      publishedAt: "2023-08-01T00:00:00.000Z",
      createdAt: "2023-08-01T00:00:00.000Z",
      updatedAt: "2024-08-01T00:00:00.000Z",
    }),
    post(4, {
      userId: 3,
      title: "React ו-TypeScript: מדריך",
      excerpt: "טיוטה שעדיין לא פורסמה.",
      body: "טיוטה עם React ו-TypeScript בתוך טקסט עברי.",
      tags: ["react", "typescript"],
      status: "draft",
      publishedAt: null,
      createdAt: "2024-03-01T00:00:00.000Z",
      updatedAt: "2024-03-01T00:00:00.000Z",
    }),
    post(5, {
      userId: 5,
      title: "Duplicate title",
      excerpt: "Two posts share this title.",
      body: "The first post with this title, and nobody has commented.",
      tags: ["duplicates"],
      status: "published",
      publishedAt: "2025-11-03T00:00:00.000Z",
      createdAt: "2025-11-03T00:00:00.000Z",
      updatedAt: "2025-11-03T00:00:00.000Z",
    }),
    post(6, {
      userId: 6,
      title: "Duplicate title",
      excerpt: "Two posts share this title.",
      body: "The second post with this title.",
      tags: ["duplicates"],
      status: "published",
      publishedAt: "2025-11-04T00:00:00.000Z",
      createdAt: "2025-11-04T00:00:00.000Z",
      updatedAt: "2025-11-04T00:00:00.000Z",
    }),
    post(7, {
      userId: 4,
      title: "前端测试入门",
      excerpt: "一篇关于前端测试的文章。",
      body: "前端测试很重要。这是一个用中文写的帖子。",
      tags: ["测试"],
      status: "published",
      publishedAt: "2011-01-01T00:00:00.000Z",
      createdAt: "2011-01-01T00:00:00.000Z",
      updatedAt: "2011-01-01T00:00:00.000Z",
    }),
    post(8, {
      userId: 1,
      title: "Ça marche ! « Guillemets » — tirets",
      excerpt: "Word.",
      body: "Word.",
      tags: ["français"],
      status: "published",
      publishedAt: epoch,
      createdAt: epoch,
      updatedAt: epoch,
    }),
  ];
}

function makeComments(): Comment[] {
  const comment = (fields: Omit<Comment, "id">, id: number): Comment => ({ id, ...fields });
  return [
    comment(
      {
        postId: 1,
        userId: 1,
        parentId: null,
        body: sized(2_000, "A comment at the maximum length. "),
        likes: 0,
        createdAt: "2021-01-03T00:00:00.000Z",
        updatedAt: "2021-01-03T00:00:00.000Z",
      },
      1,
    ),
    comment(
      {
        postId: 1,
        userId: 2,
        parentId: 1,
        body: "شكرا جزيلا!",
        likes: 1,
        createdAt: "2021-01-04T00:00:00.000Z",
        updatedAt: "2021-01-04T00:00:00.000Z",
      },
      2,
    ),
    comment(
      {
        postId: 1,
        userId: 8,
        parentId: 1,
        body: "👍👍👍",
        likes: 999_999,
        createdAt: "2023-07-02T00:00:00.000Z",
        updatedAt: "2023-07-02T00:00:00.000Z",
      },
      3,
    ),
    comment(
      {
        postId: 2,
        userId: 3,
        parentId: null,
        body: "תגובה בעברית על פוסט בערבית.",
        likes: 2,
        createdAt: "2024-03-02T00:00:00.000Z",
        updatedAt: "2024-03-02T00:00:00.000Z",
      },
      4,
    ),
    comment(
      {
        postId: 2,
        userId: 2,
        parentId: 4,
        body: "رد على التعليق.",
        likes: 0,
        createdAt: "2024-03-03T00:00:00.000Z",
        updatedAt: "2024-03-04T00:00:00.000Z",
      },
      5,
    ),
    comment(
      {
        postId: 3,
        userId: 4,
        parentId: null,
        body: "很好！",
        likes: 5,
        createdAt: "2023-08-02T00:00:00.000Z",
        updatedAt: "2023-08-02T00:00:00.000Z",
      },
      6,
    ),
    comment(
      {
        postId: 6,
        userId: 5,
        parentId: null,
        body: "Same name, different person.",
        likes: 0,
        createdAt: "2025-11-05T00:00:00.000Z",
        updatedAt: "2025-11-05T00:00:00.000Z",
      },
      7,
    ),
    comment(
      {
        postId: 6,
        userId: 6,
        parentId: 7,
        body: "Indeed, I am the other Alex Kim.",
        likes: 0,
        createdAt: "2025-11-06T00:00:00.000Z",
        updatedAt: "2025-11-06T00:00:00.000Z",
      },
      8,
    ),
    comment(
      {
        postId: 8,
        userId: 1,
        parentId: null,
        body: "First!",
        likes: 0,
        createdAt: epoch,
        updatedAt: epoch,
      },
      9,
    ),
    comment(
      {
        postId: 7,
        userId: 7,
        parentId: null,
        body: "x",
        likes: 0,
        createdAt: "2020-06-01T00:00:00.000Z",
        updatedAt: "2020-06-01T00:00:00.000Z",
      },
      10,
    ),
  ];
}

function makeCategories(): Category[] {
  const at = { createdAt: "2019-01-01T00:00:00.000Z", updatedAt: "2019-01-01T00:00:00.000Z" };
  const longName = sized(60, "Department With A Long Name ");
  return [
    category(1, { parentId: null, name: "Home & Garden", slug: slugify("Home & Garden"), ...at }),
    category(2, { parentId: 1, name: "Küche", slug: slugify("Küche"), ...at }),
    // a name with no Latin letters leaves nothing to slug
    category(3, { parentId: 1, name: "厨房用品", slug: slugify("厨房用品") || "category", ...at }),
    category(4, {
      parentId: null,
      name: "Empty Department",
      slug: slugify("Empty Department"),
      ...at,
    }),
    category(5, {
      parentId: null,
      name: "Ünïcödé Gadgets ✨",
      slug: slugify("Ünïcödé Gadgets ✨"),
      ...at,
    }),
    category(6, { parentId: 5, name: longName, slug: slugify(longName), ...at }),
    category(7, { parentId: 5, name: "Accessories", slug: slugify("Accessories"), ...at }),
  ];
}

function makeProducts(): Product[] {
  const at = (day: string) => ({
    createdAt: `${day}T00:00:00.000Z`,
    updatedAt: `${day}T00:00:00.000Z`,
  });
  return [
    product(1, 1, {
      categoryId: 2,
      title: "Free sample",
      description: "Costs nothing and is out of stock.",
      priceMinor: 0,
      rating: 0,
      ratingCount: 0,
      stock: 0,
      brand: "Acme",
      status: "draft",
      ...at("2019-02-01"),
    }),
    product(2, 5, {
      categoryId: 2,
      title: "Most expensive item ever made",
      description: "The highest price and stock the contract allows.",
      priceMinor: 100_000_000,
      rating: 5,
      ratingCount: 1_000_000,
      stock: 1_000_000,
      brand: "Luxe",
      status: "active",
      ...at("2019-02-02"),
    }),
    product(3, 1, {
      categoryId: 3,
      title: sized(200, "A product title long enough to break a card layout "),
      description: sized(2_000, "A product description at the maximum length. "),
      priceMinor: 1,
      rating: 1,
      ratingCount: 1,
      stock: 1,
      brand: sized(100, "Brand With A Very Long Name "),
      status: "active",
      ...at("2019-02-03"),
    }),
    product(4, 2, {
      categoryId: 3,
      title: "Café Crème ☕",
      description: "Accents and a symbol in the title.",
      priceMinor: 450,
      rating: 4.5,
      ratingCount: 2,
      stock: 12,
      brand: "Ø Design",
      status: "discontinued",
      ...at("2019-02-04"),
    }),
    product(5, 1, {
      categoryId: 7,
      title: "😀😀😀",
      description: "A title of emoji only.",
      priceMinor: 999,
      rating: 3.3,
      ratingCount: 3,
      stock: 3,
      brand: "Emoji Co",
      status: "active",
      ...at("2019-02-05"),
    }),
    product(6, 1, {
      categoryId: 7,
      title: "Same Name Product",
      description: "Two products share this title.",
      priceMinor: 1_000,
      rating: 0,
      ratingCount: 0,
      stock: 5,
      brand: "Twin",
      status: "active",
      ...at("2019-02-06"),
    }),
    product(7, 1, {
      categoryId: 7,
      title: "Same Name Product",
      description: "Two products share this title.",
      priceMinor: 1_000,
      rating: 2,
      ratingCount: 1,
      stock: 5,
      brand: "Twin",
      status: "active",
      ...at("2019-02-07"),
    }),
  ];
}

function makeTodos(): Todo[] {
  const todo = (id: number, fields: Omit<Todo, "id">): Todo => ({ id, ...fields });
  return [
    todo(1, {
      userId: 1,
      title: "Epoch todo",
      completed: true,
      dueDate: "1970-01-01",
      priority: "low",
      createdAt: epoch,
      updatedAt: epoch,
    }),
    todo(2, {
      userId: 2,
      title: "مهمة بدون موعد",
      completed: false,
      dueDate: null,
      priority: "normal",
      createdAt: "2000-01-05T00:00:00.000Z",
      updatedAt: "2000-01-05T00:00:00.000Z",
    }),
    todo(3, {
      userId: 3,
      title: "Leap day deadline",
      completed: false,
      dueDate: "2024-02-29",
      priority: "high",
      createdAt: "2024-03-01T00:00:00.000Z",
      updatedAt: "2024-03-01T00:00:00.000Z",
    }),
    todo(4, {
      userId: 7,
      title: sized(200, "A todo title long enough to need truncation "),
      completed: false,
      dueDate: "2099-12-31",
      priority: "high",
      createdAt: "2020-01-02T00:00:00.000Z",
      updatedAt: "2020-01-02T00:00:00.000Z",
    }),
    todo(5, {
      userId: 8,
      title: "🎉",
      completed: false,
      dueDate: "2026-01-01",
      priority: "normal",
      createdAt: "2023-07-03T00:00:00.000Z",
      updatedAt: "2023-07-03T00:00:00.000Z",
    }),
    todo(6, {
      userId: 5,
      title: "Same title",
      completed: false,
      dueDate: null,
      priority: "low",
      createdAt: "2025-11-02T06:00:00.000Z",
      updatedAt: "2025-11-02T06:00:00.000Z",
    }),
    todo(7, {
      userId: 6,
      title: "Same title",
      completed: true,
      dueDate: null,
      priority: "low",
      createdAt: "2025-11-02T06:00:00.000Z",
      updatedAt: "2025-11-02T06:00:00.000Z",
    }),
  ];
}

export function generateEdgePack(): { manifest: FixtureManifest; data: PackData } {
  const data: PackData = {
    users: makeUsers(),
    posts: makePosts(),
    comments: makeComments(),
    categories: makeCategories(),
    products: makeProducts(),
    todos: makeTodos(),
  };
  const manifest: FixtureManifest = {
    id: edgePackId,
    generator: "packages/core/scripts/edge-fixtures.ts",
    faker: null,
    seed: null,
    referenceTime,
    locale: "mul",
    counts: {
      users: data.users.length,
      posts: data.posts.length,
      comments: data.comments.length,
      categories: data.categories.length,
      products: data.products.length,
      todos: data.todos.length,
    },
    checksum: checksum(data),
  };
  return { manifest, data };
}
