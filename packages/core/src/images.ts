import type { QueryIssue, QueryResult } from "./query.js";
import { colorFor, hashKey } from "./text.js";

export const minImageSide = 10;
export const maxImageSide = 2_000;
export const maxImageText = 60;
export const defaultAvatarSize = 96;
export const placeholderStyles = ["plain", "gradient", "pattern"] as const;
export const avatarStyles = ["initials", "identicon"] as const;
export type PlaceholderStyle = (typeof placeholderStyles)[number];
export type AvatarStyle = (typeof avatarStyles)[number];

export interface PlaceholderOptions {
  width: number;
  height: number;
  text?: string | undefined;
  bg?: string | undefined;
  fg?: string | undefined;
  seed?: string | undefined;
  style: PlaceholderStyle;
}

export interface AvatarOptions {
  name: string;
  size: number;
  bg?: string | undefined;
  fg?: string | undefined;
  style: AvatarStyle;
}

type Params = Iterable<readonly [string, string]>;

const hexColor = /^(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const seedText = /^[A-Za-z0-9._-]{1,64}$/;
// one line of XML-safe Unicode: no control characters, line separators or lone surrogates
const printable = /^[\u0020-\u007e\u00a0-\u2027\u202a-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]+$/u;

const issue = (field: string, code: QueryIssue["code"], message: string): QueryIssue => ({
  field,
  code,
  message,
});

function collect(params: Params, allowed: readonly string[], issues: QueryIssue[]) {
  const values = new Map<string, string>();
  const repeated = new Set<string>();
  for (const [name, value] of params) {
    if (!allowed.includes(name)) {
      if (!issues.some((known) => known.field === name)) {
        issues.push(issue(name, "unknown_parameter", `Unknown query parameter "${name}".`));
      }
    } else if (values.has(name)) repeated.add(name);
    else values.set(name, value);
  }
  for (const name of repeated) {
    issues.push(
      issue(name, "duplicate_parameter", `Query parameter "${name}" must appear at most once.`),
    );
  }
  return (name: string) => (repeated.has(name) ? undefined : values.get(name));
}

function readColor(name: string, raw: string | undefined, issues: QueryIssue[]) {
  if (raw === undefined) return undefined;
  if (hexColor.test(raw)) return normalizeHex(raw);
  issues.push(
    issue(
      name,
      "invalid_value",
      `"${name}" must be 3 or 6 hex digits without "#", such as 0f172a.`,
    ),
  );
  return undefined;
}

function readStyle<T extends string>(
  raw: string | undefined,
  styles: readonly T[],
  fallback: T,
  issues: QueryIssue[],
): T {
  if (raw === undefined) return fallback;
  if ((styles as readonly string[]).includes(raw)) return raw as T;
  issues.push(issue("style", "invalid_value", `"style" must be one of: ${styles.join(", ")}.`));
  return fallback;
}

export function checkSide(field: string, side: number, issues: QueryIssue[]) {
  if (side < minImageSide || side > maxImageSide) {
    issues.push(
      issue(
        field,
        "out_of_range",
        `"${field}" must be between ${minImageSide} and ${maxImageSide} pixels.`,
      ),
    );
  }
}

// `size` is the path segment: "600" or "600x400", already matched as digits
export function parsePlaceholder(size: string, params: Params): QueryResult<PlaceholderOptions> {
  const issues: QueryIssue[] = [];
  const [width = 0, height = width] = size.split("x").map(Number);
  checkSide("width", width, issues);
  if (size.includes("x")) checkSide("height", height, issues);
  const read = collect(params, ["text", "bg", "fg", "seed", "style"], issues);

  const text = read("text");
  if (text !== undefined) {
    if (!printable.test(text)) {
      issues.push(issue("text", "invalid_value", '"text" must be one line of printable text.'));
    } else if ([...text].length > maxImageText) {
      issues.push(
        issue("text", "invalid_value", `"text" must be at most ${maxImageText} characters.`),
      );
    }
  }
  const seed = read("seed");
  if (seed !== undefined && !seedText.test(seed)) {
    issues.push(
      issue("seed", "invalid_value", '"seed" must be 1 to 64 letters, digits, ".", "_" or "-".'),
    );
  }
  const bg = readColor("bg", read("bg"), issues);
  const fg = readColor("fg", read("fg"), issues);
  const style = readStyle(read("style"), placeholderStyles, "plain", issues);

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { width, height, text, bg, fg, seed, style } };
}

export function parseAvatar(name: string, params: Params): QueryResult<AvatarOptions> {
  const issues: QueryIssue[] = [];
  const read = collect(params, ["size", "style", "bg", "fg"], issues);
  let size = defaultAvatarSize;
  const rawSize = read("size");
  if (rawSize !== undefined) {
    if (!/^(?:0|[1-9]\d*)$/.test(rawSize)) {
      issues.push(
        issue("size", "invalid_integer", '"size" must be a whole number written with digits only.'),
      );
    } else {
      size = Number(rawSize);
      checkSide("size", size, issues);
    }
  }
  const bg = readColor("bg", read("bg"), issues);
  const fg = readColor("fg", read("fg"), issues);
  const style = readStyle(read("style"), avatarStyles, "initials", issues);
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { name, size, bg, fg, style } };
}

function normalizeHex(raw: string): string {
  const hex = raw.toLowerCase();
  return hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
}

// readable text on any background: dark on light, light on dark
function contrastFor(hex: string): string {
  const [r = 0, g = 0, b = 0] = [0, 2, 4].map(
    (i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "1e293b" : "f8fafc";
}

// a shade of the background for gradients
function shade(hex: string, amount: number): string {
  return [0, 2, 4]
    .map((i) => {
      const channel = Number.parseInt(hex.slice(i, i + 2), 16);
      const next = Math.max(0, Math.min(255, Math.round(channel + amount)));
      return next.toString(16).padStart(2, "0");
    })
    .join("");
}

// xorshift32 seeded from the text, so the same seed always draws the same pattern
function generator(seed: string) {
  let state = Number.parseInt(hashKey(seed), 36) % 0xffffffff || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const font = "system-ui, -apple-system, &quot;Segoe UI&quot;, Roboto, sans-serif";

function frame(width: number, height: number, label: string, inner: string): string {
  const name = escapeXml(label);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${name}"><title>${name}</title>${inner}</svg>`;
}

function label(text: string, x: number, y: number, size: number, fill: string, weight = 600) {
  return `<text x="${x}" y="${y}" fill="#${fill}" font-family="${font}" font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>`;
}

export function renderPlaceholder(options: PlaceholderOptions): string {
  const { width, height, style } = options;
  const text = options.text ?? `${width}×${height}`;
  const seed = options.seed ?? `${width}x${height}`;
  const bg = options.bg ?? (options.seed ? colorFor(options.seed).slice(1) : "e2e8f0");
  const fg = options.fg ?? contrastFor(bg);
  const shapes: string[] = [];

  if (style === "gradient") {
    shapes.push(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#${shade(bg, 40)}"/><stop offset="1" stop-color="#${shade(bg, -40)}"/></linearGradient></defs>`,
      `<rect width="${width}" height="${height}" fill="url(#g)"/>`,
    );
  } else {
    shapes.push(`<rect width="${width}" height="${height}" fill="#${bg}"/>`);
  }
  if (style === "pattern") {
    const next = generator(seed);
    const radius = Math.max(2, Math.round(Math.min(width, height) / 10));
    for (let i = 0; i < 12; i++) {
      const cx = Math.round(next() * width);
      const cy = Math.round(next() * height);
      const r = Math.max(1, Math.round(radius * (0.4 + next())));
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="#${fg}" fill-opacity="0.12"/>`);
    }
  }

  const characters = Math.max(4, [...text].length);
  const size = Math.max(6, Math.round(Math.min((width / characters) * 1.6, height / 2.5)));
  shapes.push(label(text, width / 2, height / 2, size, fg));
  return frame(width, height, text, shapes.join(""));
}

export function initialsOf(name: string): string {
  const parts = name.split(/[._-]+/).filter((part) => part !== "");
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : [parts[0] ?? name];
  return letters.map((part) => (part ?? "").charAt(0).toUpperCase()).join("");
}

export function renderAvatar(options: AvatarOptions): string {
  const { name, size, style } = options;
  const shapes: string[] = [];
  if (style === "identicon") {
    const bg = options.bg ?? "f1f5f9";
    const fg = options.fg ?? colorFor(name).slice(1);
    shapes.push(`<rect width="${size}" height="${size}" fill="#${bg}"/>`);
    const next = generator(name);
    const cell = size / 5;
    // five columns mirrored around the middle one, like the classic identicon
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 3; column++) {
        if (next() < 0.5) continue;
        for (const x of new Set([column, 4 - column])) {
          shapes.push(
            `<rect x="${(x * cell).toFixed(2)}" y="${(row * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="#${fg}"/>`,
          );
        }
      }
    }
  } else {
    const bg = options.bg ?? colorFor(name).slice(1);
    const fg = options.fg ?? contrastFor(bg);
    shapes.push(`<rect width="${size}" height="${size}" fill="#${bg}"/>`);
    shapes.push(
      label(initialsOf(name), size / 2, size / 2, Math.max(6, Math.round(size * 0.4)), fg, 700),
    );
  }
  return frame(size, size, name, shapes.join(""));
}
