import type { Decision, DecisionInput, Decisions } from "../src/model.js";
import { HttpError } from "./http.js";

export const OWNER = "ivyxing";
export const REPO = "yougame-review";
export const DECISIONS_PATH = "feedback/decisions.json";
const API = "https://api.github.com";

type Transport = typeof fetch;

async function request<T>(token: string, path: string, init: RequestInit = {}, transport: Transport = fetch): Promise<{ status: number; body: T }> {
  const response = await transport(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yougame-review",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 401) throw new HttpError(401, "Your GitHub sign-in expired. Sign in again.");
  const body = response.status === 204 ? (undefined as T) : ((await response.json().catch(() => undefined)) as T);
  return { status: response.status, body };
}

export async function githubUser(token: string, transport?: Transport): Promise<{ login: string }> {
  const { status, body } = await request<{ login?: string }>(token, "/user", {}, transport);
  if (status !== 200 || !body?.login) throw new HttpError(503, "GitHub is temporarily unavailable.");
  return { login: body.login };
}

/** Only people who can read the review repository may use the site. */
export async function checkRepoAccess(token: string, transport?: Transport): Promise<{ canWrite: boolean }> {
  const { status, body } = await request<{ full_name?: string; permissions?: { pull?: boolean; push?: boolean } }>(
    token,
    `/repos/${OWNER}/${REPO}`,
    {},
    transport,
  );
  if (status !== 200 && status !== 403 && status !== 404) throw new HttpError(503, "GitHub is temporarily unavailable.");
  if (status !== 200 || body?.full_name?.toLowerCase() !== `${OWNER}/${REPO}` || body.permissions?.pull === false) {
    throw new HttpError(403, `Your GitHub account doesn't have access to ${OWNER}/${REPO}. Ask Ivy to add you.`);
  }
  return { canWrite: body.permissions?.push === true };
}

interface ContentFile {
  content?: string;
  sha?: string;
}

export async function readDecisions(token: string, transport?: Transport): Promise<{ decisions: Decisions; sha?: string }> {
  const { status, body } = await request<ContentFile>(token, `/repos/${OWNER}/${REPO}/contents/${DECISIONS_PATH}`, {}, transport);
  if (status === 404) return { decisions: {} };
  if (status !== 200 || typeof body?.content !== "string") throw new HttpError(503, "Couldn't read saved decisions from GitHub.");
  try {
    const parsed = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as { decisions?: Decisions };
    return { decisions: parsed.decisions ?? {}, sha: body.sha };
  } catch {
    throw new HttpError(503, "The saved decisions file isn't valid JSON. Fix it in the repository.");
  }
}

export function serializeDecisions(decisions: Decisions): string {
  const sorted = Object.fromEntries(Object.keys(decisions).sort().map((id) => [id, decisions[id]]));
  return JSON.stringify({ schema: 1, decisions: sorted }, null, 2) + "\n";
}

export function commitMessage(d: Decision): string {
  const what = d.status === "dismissed" ? `dismissed (${d.reason})` : d.status;
  return `Feedback: ${d.id} ${what}`;
}

/** Saves one decision as a commit by the signed-in person, retrying once if someone saved at the same moment. */
export async function writeDecision(token: string, login: string, input: DecisionInput, transport?: Transport, now = new Date()): Promise<Decisions> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { decisions, sha } = await readDecisions(token, transport);
    const decision: Decision = { ...input, by: login, at: now.toISOString() };
    const next = { ...decisions, [input.id]: decision };
    const { status } = await request(
      token,
      `/repos/${OWNER}/${REPO}/contents/${DECISIONS_PATH}`,
      {
        method: "PUT",
        body: JSON.stringify({
          message: commitMessage(decision),
          content: Buffer.from(serializeDecisions(next)).toString("base64"),
          ...(sha ? { sha } : {}),
        }),
      },
      transport,
    );
    if (status === 200 || status === 201) return next;
    if (status === 409 || status === 422) continue;
    if (status === 403 || status === 404) throw new HttpError(403, "Your GitHub account can view the review but can't save changes to it.");
    throw new HttpError(503, "Couldn't save to GitHub. Try again.");
  }
  throw new HttpError(409, "Someone else saved at the same moment. Try again.");
}
