import type { VercelRequest, VercelResponse } from "@vercel/node";
import { completeLogin, config, getSession } from "../../server/auth.js";
import { HttpError, privateHeaders } from "../../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  privateHeaders(res);
  let base = "/";
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const settings = config();
    base = settings.baseUrl;
    const session = await getSession(req, res);
    await completeLogin(session, new URL(req.url ?? "/api/auth/callback", settings.baseUrl), settings);
    res.redirect(303, base);
  } catch (error) {
    // Send people back to the page with a readable reason instead of a JSON error.
    const message = error instanceof HttpError ? error.message : "Sign-in failed. Try again.";
    res.redirect(303, `${base.replace(/\/$/, "")}/?signin_error=${encodeURIComponent(message)}`);
  }
}
