import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSession } from "../../server/auth.js";
import { HttpError, privateHeaders, sendError } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  privateHeaders(res);
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    (await getSession(req, res)).destroy();
    res.status(204).end();
  } catch (error) {
    sendError(res, error);
  }
}
