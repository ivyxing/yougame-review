import type { VercelRequest, VercelResponse } from "@vercel/node";
import { activeViewer, getSession } from "../server/auth.js";
import { loadFindings } from "../server/findings.js";
import { readDecisions } from "../server/github.js";
import { HttpError, privateHeaders, sendError } from "../server/http.js";

/** Everything the page shows: findings from this deployment, decisions live from GitHub. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  privateHeaders(res);
  try {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
    const session = await getSession(req, res);
    const viewer = await activeViewer(session);
    const [findings, { decisions }] = await Promise.all([loadFindings(), readDecisions(viewer.token)]);
    res.status(200).json({ viewer: { login: viewer.login, canWrite: viewer.canWrite }, ...findings, decisions });
  } catch (error) {
    sendError(res, error);
  }
}
