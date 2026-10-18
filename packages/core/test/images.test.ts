import { describe, expect, it } from "vitest";
import {
  controlHeaders,
  corePack,
  createEngine,
  type EngineResponse,
  edgePack,
  type Image,
  maxImageSide,
  minImageSide,
} from "../src/index.js";

const engine = createEngine({ state: "stateless", random: () => 0.5 });
const get = (path: string, query = "", method = "GET"): EngineResponse =>
  engine.handle({ method, path, query: new URLSearchParams(query) });
const svgOf = (response: EngineResponse) => response.rawBody ?? "";
const attribute = (svg: string, name: string) => {
  const start = svg.indexOf(`${name}="`) + name.length + 2;
  return svg.slice(start, svg.indexOf('"', start));
};
// the text node's content, unescaped
const textOf = (svg: string) => {
  const open = svg.indexOf(">", svg.indexOf("<text")) + 1;
  return svg
    .slice(open, svg.indexOf("</text>"))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
};
type Issue = { field: string; code: string; message: string };
const issues = (response: EngineResponse) => (response.body as { errors: Issue[] }).errors;
const control = (code: number) => String.fromCharCode(code);

describe("placeholder images", () => {
  it("draws an SVG of the requested size with the size as text", () => {
    const response = get("/img/600x400");
    expect(response.status).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "image/svg+xml",
      "cache-control": "public, max-age=604800",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    const svg = svgOf(response);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"')).toBe(
      true,
    );
    expect(attribute(svg, "viewBox")).toBe("0 0 600 400");
    expect(textOf(svg)).toBe("600×400");
    expect(attribute(svg, "aria-label")).toBe("600×400");
  });

  it("draws a square from one side", () => {
    const svg = svgOf(get("/img/250"));
    expect([attribute(svg, "width"), attribute(svg, "height")]).toEqual(["250", "250"]);
    expect(textOf(svg)).toBe("250×250");
  });

  it.each([
    [`/img/${minImageSide}x${maxImageSide}`, 200],
    [`/img/${maxImageSide}`, 200],
    [`/img/${minImageSide - 1}x400`, 400],
    [`/img/600x${maxImageSide + 1}`, 400],
    ["/img/99999", 400],
  ])("answers %s with %i", (path, status) => {
    expect(get(path).status).toBe(status);
  });

  it("names the side that is out of range", () => {
    expect(issues(get("/img/9x2001"))).toEqual([
      {
        field: "width",
        code: "out_of_range",
        message: '"width" must be between 10 and 2000 pixels.',
      },
      {
        field: "height",
        code: "out_of_range",
        message: '"height" must be between 10 and 2000 pixels.',
      },
    ]);
    expect(get("/img/9").body).toMatchObject({ code: "invalid_image", status: 400 });
  });

  it.each([
    "/img/abc",
    "/img/600x",
    "/img/0600",
    "/img/600x400x2",
    "/img/600X400",
    "/img",
    "/img/",
  ])("answers %s with 404", (path) => {
    expect(get(path).status).toBe(404);
  });

  it("answers HEAD with the headers only and other methods with 405", () => {
    const head = get("/img/600x400", "", "HEAD");
    expect(head.status).toBe(200);
    expect(head.headers["content-type"]).toBe("image/svg+xml");
    expect(head.rawBody).toBeUndefined();
    const post = get("/img/600x400", "", "POST");
    expect(post.status).toBe(405);
    expect(post.headers.allow).toBe("GET, HEAD");
  });
});

describe("placeholder parameters", () => {
  it("shows custom text, escaped", () => {
    const text = `<script>alert("x") & 'y'</script>`;
    const svg = svgOf(get("/img/600x400", `text=${encodeURIComponent(text)}`));
    expect(svg.includes("<script")).toBe(false);
    expect(textOf(svg)).toBe(text);
    expect(attribute(svg, "aria-label")).toBe(
      "&lt;script&gt;alert(&quot;x&quot;) &amp; &apos;y&apos;&lt;/script&gt;",
    );
  });

  it("accepts up to 60 characters of Unicode text", () => {
    const emoji = "😀".repeat(60);
    expect(textOf(svgOf(get("/img/600x400", `text=${encodeURIComponent(emoji)}`)))).toBe(emoji);
    expect(get("/img/600x400", `text=${"x".repeat(61)}`).status).toBe(400);
  });

  it.each([
    ["an empty text", "text="],
    ["a line break", `text=${encodeURIComponent(`a${control(10)}b`)}`],
    ["a control character", `text=${encodeURIComponent(`a${control(7)}b`)}`],
    ["a C1 control character", `text=${encodeURIComponent(`a${control(0x85)}b`)}`],
  ])("refuses %s", (_name, query) => {
    expect(issues(get("/img/600x400", query))).toEqual([
      {
        field: "text",
        code: "invalid_value",
        message: '"text" must be one line of printable text.',
      },
    ]);
  });

  it("refuses a lone surrogate passed in-process", () => {
    const response = engine.handle({
      method: "GET",
      path: "/img/600x400",
      query: [["text", `a${control(0xd800)}`]],
    });
    expect(response.status).toBe(400);
  });

  it("takes 3 or 6 hex digits for colors", () => {
    const svg = svgOf(get("/img/600x400", "bg=0F172A&fg=abc"));
    expect(svg.includes('fill="#0f172a"')).toBe(true);
    expect(svg.includes('fill="#aabbcc"')).toBe(true);
    for (const value of ["#fff", "12", "ggg", "1234567", "fffff"]) {
      expect(issues(get("/img/600x400", `bg=${encodeURIComponent(value)}`))[0]?.field).toBe("bg");
    }
  });

  it("picks a readable text color for the background", () => {
    expect(svgOf(get("/img/100", "bg=ffffff")).includes('<text x="50" y="50" fill="#1e293b"')).toBe(
      true,
    );
    expect(svgOf(get("/img/100", "bg=000000")).includes('<text x="50" y="50" fill="#f8fafc"')).toBe(
      true,
    );
  });

  it("renders the same bytes for the same seed and different colors for different seeds", () => {
    const first = svgOf(get("/img/400x300", "seed=post-1&style=pattern"));
    expect(svgOf(get("/img/400x300", "seed=post-1&style=pattern"))).toBe(first);
    expect(svgOf(get("/img/400x300", "seed=post-2&style=pattern"))).not.toBe(first);
    expect(first.split("<circle").length - 1).toBe(12);
  });

  it("draws a gradient from an in-document fragment", () => {
    const svg = svgOf(get("/img/400x300", "style=gradient&seed=a"));
    expect(svg.includes('<linearGradient id="g"')).toBe(true);
    expect(svg.includes('fill="url(#g)"')).toBe(true);
  });

  it.each([
    ["seed=has space", "seed"],
    [`seed=${"s".repeat(65)}`, "seed"],
    ["style=noise", "style"],
    ["size=10", "size"],
    ["text=a&text=b", "text"],
  ])("refuses %s", (query, field) => {
    const response = get("/img/600x400", query);
    expect(response.status).toBe(400);
    expect(issues(response).map((issue) => issue.field)).toEqual([field]);
  });
});

describe("avatars", () => {
  it.each([
    ["jane-doe", "JD"],
    ["ines.duarte", "ID"],
    ["q", "Q"],
    ["a.b.c", "AC"],
    ["Mia_von_Holt", "MH"],
    ["7of9", "7"],
  ])("draws the initials of %s as %s", (name, initials) => {
    const svg = svgOf(get(`/img/avatar/${name}`));
    expect([attribute(svg, "width"), attribute(svg, "height")]).toEqual(["96", "96"]);
    expect(textOf(svg)).toBe(initials);
    expect(attribute(svg, "aria-label")).toBe(name);
  });

  it("takes a size and colors", () => {
    const svg = svgOf(get("/img/avatar/jane-doe", "size=40&bg=000&fg=fff"));
    expect(attribute(svg, "width")).toBe("40");
    expect(svg.includes('fill="#000000"')).toBe(true);
    expect(svg.includes('fill="#ffffff"')).toBe(true);
  });

  it("draws a mirrored identicon, the same every time", () => {
    const svg = svgOf(get("/img/avatar/jane-doe", "style=identicon&size=100"));
    expect(svgOf(get("/img/avatar/jane-doe", "style=identicon&size=100"))).toBe(svg);
    const cells = svg
      .split("<rect ")
      .slice(2)
      .map((part) => [
        Number(attribute(`<rect ${part}`, "x")),
        Number(attribute(`<rect ${part}`, "y")),
      ]);
    expect(cells.length).toBeGreaterThan(0);
    const key = (x: number, y: number) => `${x.toFixed(2)},${y.toFixed(2)}`;
    const keys = new Set(cells.map(([x = 0, y = 0]) => key(x, y)));
    for (const [x = 0, y = 0] of cells) expect(keys.has(key(80 - x, y))).toBe(true);
  });

  it.each([
    ["size=9", "size", "out_of_range"],
    ["size=2001", "size", "out_of_range"],
    ["size=big", "size", "invalid_integer"],
    ["style=pattern", "style", "invalid_value"],
    ["text=x", "text", "unknown_parameter"],
  ])("refuses %s", (query, field, code) => {
    const response = get("/img/avatar/jane-doe", query);
    expect(response.status).toBe(400);
    expect(issues(response).map((issue) => `${issue.field}:${issue.code}`)).toEqual([
      `${field}:${code}`,
    ]);
  });

  it.each([
    "/img/avatar/-jane",
    "/img/avatar/jane%20doe",
    `/img/avatar/${"a".repeat(65)}`,
    "/img/avatar/",
  ])("answers %s with 404", (path) => {
    expect(get(path).status).toBe(404);
  });
});

describe("SVG safety", () => {
  const inputs = [
    `/img/2000x2000?style=pattern&seed=x&text=${encodeURIComponent(`"'<>&`.repeat(12))}`,
    `/img/600x400?style=gradient&text=${encodeURIComponent("😀".repeat(60))}`,
    "/img/10x10",
    "/img/avatar/a.b?style=identicon&size=2000",
    `/img/avatar/${"x".repeat(64)}?size=2000`,
  ];

  it.each(inputs)("keeps %s free of active content and under 8 KiB", (url) => {
    const [path = "", query = ""] = url.split("?");
    const svg = svgOf(get(path, query));
    expect(svg.length).toBeGreaterThan(0);
    expect(new TextEncoder().encode(svg).length).toBeLessThan(8 * 1024);
    const lower = svg.toLowerCase();
    for (const banned of [
      "<script",
      "foreignobject",
      "href",
      "javascript:",
      "<!entity",
      "<?",
      "<iframe",
      "<image",
      "<use",
    ]) {
      expect(lower.includes(banned), banned).toBe(false);
    }
    for (const handler of [" onload=", " onclick=", " onerror=", " onmouseover=", " onfocus="]) {
      expect(lower.includes(handler), handler).toBe(false);
    }
    expect(lower.split("http").length - 1).toBe(1);
    expect(lower.includes('xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    const urls = lower
      .split("url(")
      .slice(1)
      .map((part) => part.slice(0, part.indexOf(")")));
    for (const ref of urls) expect(ref).toBe("#g");
  });
});

describe("fixture image URLs", () => {
  const images = (pack: typeof corePack): Image[] => [
    ...pack.data.users.map((user) => user.avatar),
    ...pack.data.posts.map((post) => post.cover),
    ...pack.data.categories.map((category) => category.image),
    ...pack.data.products.flatMap((product) => product.images),
  ];

  it.each([corePack, edgePack].map((pack) => [pack.manifest.id, pack] as const))(
    "resolve to SVGs of the stored size in %s",
    (_id, pack) => {
      for (const image of images(pack)) {
        const [path = "", query = ""] = image.url.split("?");
        const response = get(path, query);
        expect([image.url, response.status]).toEqual([image.url, 200]);
        const svg = svgOf(response);
        expect([attribute(svg, "width"), attribute(svg, "height")]).toEqual([
          String(image.width),
          String(image.height),
        ]);
      }
    },
  );
});

describe("controls on images", () => {
  it("simulates a broken image without caching it", () => {
    const response = get("/img/600x400", "_mock.status=404");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toBe("application/problem+json");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("delays an image and stops it from being cached", () => {
    const response = get("/img/avatar/jane-doe", "_mock.delay=1500");
    expect(response).toMatchObject({ status: 200, delayMs: 1500 });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-mock-applied"]).toBe("delay=1500");
    expect(response.rawBody?.startsWith("<svg")).toBe(true);
  });

  it("applies scenarios and body faults to the SVG", () => {
    expect(get("/img/600x400", "_mock.scenario=maintenance").status).toBe(503);
    const full = svgOf(get("/img/600x400"));
    const cut = get("/img/600x400", "_mock.body=malformed-json");
    expect(cut.rawBody).toBe(full.slice(0, Math.floor(full.length / 2)));
    const relabeled = get("/img/600x400", "_mock.body=wrong-content-type");
    expect(relabeled.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(relabeled.rawBody).toBe(full);
  });

  it("is unaffected by the empty scenario and the pack", () => {
    expect(get("/img/600x400", "_mock.scenario=empty").status).toBe(200);
    expect(svgOf(get("/img/600x400", "_mock.fixture=edge@1"))).toBe(svgOf(get("/img/600x400")));
  });
});

describe("round 1 review regressions", () => {
  it("varies a cacheable image by every control header", () => {
    const vary = (get("/img/100").headers.vary ?? "").split(", ");
    expect(vary.sort()).toEqual(Object.values(controlHeaders).sort());
    expect(get("/img/avatar/jane-doe").headers.vary).toBe(get("/img/100").headers.vary);
  });

  it.each(["/img/0", "/img/100000", "/img/100x0", "/img/0x0", `/img/1${"0".repeat(30)}`])(
    "answers the numeric size %s with 400",
    (path) => {
      const response = get(path);
      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({ code: "invalid_image" });
    },
  );

  it.each(["/img/00", "/img/0100", "/img/100x07"])("still answers %s with 404", (path) => {
    expect(get(path).status).toBe(404);
  });

  it.each(["0", "100000"])("refuses an avatar size of %s as out of range", (size) => {
    expect(issues(get("/img/avatar/jane-doe", `size=${size}`)).map((issue) => issue.code)).toEqual([
      "out_of_range",
    ]);
  });

  it.each([0x2028, 0x2029])("refuses the line separator U+%s in text", (code) => {
    const response = get("/img/100", `text=${encodeURIComponent(`a${control(code)}b`)}`);
    expect(issues(response).map((issue) => issue.field)).toEqual(["text"]);
  });
});

describe("round 2 review regressions", () => {
  it("never caches a route that has a configured sequence", () => {
    const run = createEngine({ state: "memory", sequences: { "GET /img/:size": [503] } });
    const ask = () => run.handle({ method: "GET", path: "/img/100" });
    const failed = ask();
    expect(failed.status).toBe(503);
    expect(failed.headers["cache-control"]).toBe("no-store");
    const passed = ask();
    expect(passed.status).toBe(200);
    expect(passed.headers["cache-control"]).toBe("no-store");
    run.reset();
    expect(ask().status).toBe(503);
  });

  it("marks a sequenced data route no-store too, and leaves other routes alone", () => {
    const run = createEngine({ state: "memory", sequences: { "GET /v1/users/:id": [500] } });
    run.handle({ method: "GET", path: "/v1/users/1" });
    expect(run.handle({ method: "GET", path: "/v1/users/1" }).headers["cache-control"]).toBe(
      "no-store",
    );
    expect(
      run.handle({ method: "GET", path: "/v1/users" }).headers["cache-control"],
    ).toBeUndefined();
    expect(run.handle({ method: "GET", path: "/img/100" }).headers["cache-control"]).toBe(
      "public, max-age=604800",
    );
  });
});
