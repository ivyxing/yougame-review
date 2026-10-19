import type { VercelRequest, VercelResponse } from "@vercel/node";
import { beginLogin, config, getSession } from "../../server/auth.js";
import { HttpError, privateHeaders, sendError } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  privateHeaders(res);
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const session = await getSession(req, res);
    res.redirect(302, await beginLogin(session, config()));
  } catch (error) {
    sendError(res, error);
  }
}
