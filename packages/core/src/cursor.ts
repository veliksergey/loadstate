import { z } from "zod";

export const maxCursorLength = 2048;

export type CursorValue = string | number | boolean | null;

const payloadSchema = z.strictObject({
  v: z.literal(1),
  // hash of the route, the fixture pack, the search, the filters and the sort
  h: z.string().regex(/^[0-9a-z]{1,16}$/),
  d: z.enum(["next", "prev"]),
  // the boundary row's sort values, `id` last
  t: z
    .array(z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]))
    .min(1)
    .max(5),
});

export type CursorPayload = z.infer<typeof payloadSchema>;

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

// core has no Buffer, btoa or TextEncoder types, so encodeURIComponent supplies the UTF-8
export function encodeCursor(payload: CursorPayload): string {
  // JSON.stringify escapes lone surrogates, so encodeURIComponent cannot throw here
  const bytes = percentToBytes(encodeURIComponent(JSON.stringify(payload)));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += alphabet[(n >> 18) & 63];
    out += alphabet[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += alphabet[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += alphabet[n & 63];
  }
  return out;
}

export function decodeCursor(text: string): CursorPayload | undefined {
  if (text.length === 0 || text.length > maxCursorLength) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return undefined;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 4) {
    const chunk = text.slice(i, i + 4);
    let n = 0;
    for (const [j, char] of [...chunk].entries()) n |= alphabet.indexOf(char) << (18 - 6 * j);
    bytes.push((n >> 16) & 255);
    if (chunk.length > 2) bytes.push((n >> 8) & 255);
    if (chunk.length > 3) bytes.push(n & 255);
  }
  try {
    // decodeURIComponent throws on bytes that are not valid UTF-8
    const json = decodeURIComponent(
      bytes.map((byte) => `%${byte.toString(16).padStart(2, "0")}`).join(""),
    );
    const parsed = payloadSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

// a %XX escape is one byte; every other character encodeURIComponent leaves is ASCII
function percentToBytes(percent: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < percent.length; i++) {
    if (percent[i] === "%") {
      bytes.push(Number.parseInt(percent.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(percent.charCodeAt(i));
    }
  }
  return bytes;
}
