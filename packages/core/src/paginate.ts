import { z } from "zod";
import { maxCursorLength } from "./cursor.js";

export const offsetMetaSchema = z.strictObject({
  limit: z.int().positive(),
  offset: z.int().nonnegative(),
  total: z.int().nonnegative(),
  hasMore: z.boolean(),
});

export const pageNumberMetaSchema = z.strictObject({
  page: z.int().positive(),
  perPage: z.int().positive(),
  total: z.int().nonnegative(),
  totalPages: z.int().nonnegative(),
  hasMore: z.boolean(),
});

const cursorText = z.string().min(1).max(maxCursorLength);

export const cursorMetaSchema = z.strictObject({
  limit: z.int().positive(),
  nextCursor: cursorText.nullable(),
  prevCursor: cursorText.nullable(),
  hasMore: z.boolean(),
  // only with withTotal=true, because counting reads the whole list
  total: z.int().nonnegative().optional(),
});

export const listMetaSchema = z.union([offsetMetaSchema, pageNumberMetaSchema, cursorMetaSchema]);

export type OffsetMeta = z.infer<typeof offsetMetaSchema>;
export type PageNumberMeta = z.infer<typeof pageNumberMetaSchema>;
export type CursorMeta = z.infer<typeof cursorMetaSchema>;
export type ListMeta = z.infer<typeof listMetaSchema>;

export interface Page<T> {
  data: T[];
  meta: ListMeta;
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item), meta: listMetaSchema });
}

export function paginate<T>(
  items: readonly T[],
  { limit, offset }: { limit: number; offset: number },
): { data: T[]; meta: OffsetMeta } {
  const data = items.slice(offset, offset + limit);
  return {
    data,
    meta: { limit, offset, total: items.length, hasMore: offset + data.length < items.length },
  };
}
