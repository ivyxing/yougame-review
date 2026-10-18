import type { VercelRequest, VercelResponse } from "@vercel/node";
import { validateDecision } from "../src/model.js";
import { getSession, sessionViewer } from "../server/auth.js";
import { knownItems } from "../server/findings.js";
import { writeDecision } from "../server/github.js";
import { HttpError, privateHeaders, sendError } from "../server/http.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  privateHeaders(res);
  try {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
    // Same-origin JSON only: a cross-site form can't set this content type.
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) throw new HttpError(415, "Send JSON.");
    const viewer = sessionViewer(await getSession(req, res));
    if (!viewer.canWrite) throw new HttpError(403, "Your GitHub account can view the review but can't save changes to it.");
    let input;
    try {
      input = validateDecision(req.body, await knownItems());
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : "Invalid decision.");
    }
    const decisions = await writeDecision(viewer.token, viewer.login, input);
    res.status(200).json({ decisions });
  } catch (error) {
    sendError(res, error);
  }
}
