import type { Context } from "hono";
import type { z } from "zod";
import type { AppEnv } from "./context";

export class HttpError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const unauthorized = (message = "ログインが必要です") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "この操作を行う権限がありません") =>
  new HttpError(403, "forbidden", message);
export const notFound = (message = "見つかりません") => new HttpError(404, "not_found", message);
export const conflict = (message: string, code = "conflict") => new HttpError(409, code, message);

export async function parseJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("JSON の形式が正しくありません", "invalid_json");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new HttpError(422, "validation_error", first?.message ?? "入力内容が正しくありません");
  }
  return result.data;
}

/** Splits an array into chunks (D1 allows at most 100 bound parameters per statement). */
export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function placeholders(n: number, offset = 1): string {
  return Array.from({ length: n }, (_, i) => `?${i + offset}`).join(",");
}
