import type { VercelResponse } from "@vercel/node";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function privateHeaders(res: VercelResponse): void {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Vary", "Cookie");
  res.setHeader("Referrer-Policy", "no-referrer");
}

export function sendError(res: VercelResponse, error: unknown): void {
  privateHeaders(res);
  const known = error instanceof HttpError;
  if (!known) console.warn("yougame-review: unexpected-error", error instanceof Error ? error.name : "unknown");
  res.status(known ? error.status : 503).json({ error: known ? error.message : "Something went wrong. Try again shortly." });
}
