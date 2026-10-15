import { z } from "zod";
import type { OffsetQuery } from "./query.js";

export const pageMetaSchema = z.strictObject({
  limit: z.int().positive(),
  offset: z.int().nonnegative(),
  total: z.int().nonnegative(),
  hasMore: z.boolean(),
});

export type PageMeta = z.infer<typeof pageMetaSchema>;

export interface Page<T> {
  data: T[];
  meta: PageMeta;
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ data: z.array(item), meta: pageMetaSchema });
}

export function paginate<T>(items: readonly T[], { limit, offset }: OffsetQuery): Page<T> {
  const data = items.slice(offset, offset + limit);
  return {
    data,
    meta: { limit, offset, total: items.length, hasMore: offset + data.length < items.length },
  };
}
