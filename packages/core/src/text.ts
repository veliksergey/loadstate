// text rules shared by the fixture generator and the write path

export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function readingMinutes(body: string): number {
  const words = body.split(/\s+/).filter((word) => word !== "").length;
  return Math.max(1, Math.ceil(words / 200));
}

// plain text from the start of a Markdown body, at most 160 characters
export function excerptFrom(body: string, fallback: string): string {
  const plain = body
    // spaces and tabs only: \s would scan across lines and go quadratic
    .replace(/^[ \t]*[-*][ \t]+/gm, "")
    .replace(/[#>*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain === "") return fallback;
  if (plain.length <= 160) return plain;
  // step back off a high surrogate so the cut never splits a character
  const cut = plain.slice(0, /[\uD800-\uDBFF]/.test(plain.charAt(159)) ? 159 : 160);
  const space = cut.lastIndexOf(" ");
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}

// a stable color from text: 24 bits of an FNV-1a hash
export function colorFor(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `#${((hash >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
}
