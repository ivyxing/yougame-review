import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireViewer } from "../server/auth.js";
import { readImage } from "../server/findings.js";
import { HttpError, sendError } from "../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    await requireViewer(req, res);
    const path = String(req.query.path ?? "");
    const image = await readImage(path);
    if (!image) {
      console.warn("yougame-review: image-not-found", path.slice(0, 200));
      throw new HttpError(404, "Image not found.");
    }
    res.setHeader("Content-Type", image.type);
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.setHeader("Vary", "Cookie");
    res.status(200).send(image.bytes);
  } catch (error) {
    sendError(res, error);
  }
}
