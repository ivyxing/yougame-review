import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getIronSession, type IronSession } from "iron-session";
import * as oauth from "oauth4webapi";
import { checkRepoAccess, githubUser } from "./github.js";
import { HttpError } from "./http.js";

export const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_SECONDS = 10 * 60;
const github: oauth.AuthorizationServer = {
  issuer: "https://github.com/login/oauth",
  authorization_endpoint: "https://github.com/login/oauth/authorize",
  token_endpoint: "https://github.com/login/oauth/access_token",
};

export interface Viewer {
  token: string;
  login: string;
  canWrite: boolean;
  expiresAt: number;
}
export interface SessionData {
  viewer?: Viewer;
  login?: { state: string; verifier: string; createdAt: number };
}
interface AuthConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  password: string;
}

export function config(): AuthConfig {
  const { BASE_URL, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SESSION_SECRET } = process.env;
  if (!BASE_URL || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new HttpError(503, "GitHub sign-in is not set up yet.");
  }
  let base: URL;
  try {
    base = new URL(BASE_URL);
  } catch {
    throw new HttpError(503, "GitHub sign-in is set up incorrectly.");
  }
  const local = ["localhost", "127.0.0.1"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(local && base.protocol === "http:")) || base.pathname !== "/" || base.search || base.hash) {
    throw new HttpError(503, "GitHub sign-in is set up incorrectly.");
  }
  return { baseUrl: base.origin, clientId: GITHUB_CLIENT_ID, clientSecret: GITHUB_CLIENT_SECRET, password: SESSION_SECRET };
}

export async function getSession(req: VercelRequest, res: VercelResponse): Promise<IronSession<SessionData>> {
  const settings = config();
  const secure = settings.baseUrl.startsWith("https:");
  return getIronSession<SessionData>(req, res, {
    password: settings.password,
    cookieName: secure ? "__Host-yougame-review" : "yougame-review-local",
    ttl: SESSION_SECONDS,
    cookieOptions: { secure, httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS },
  });
}

export function sessionViewer(session: IronSession<SessionData>, now = Date.now()): Viewer {
  const viewer = session.viewer;
  if (!viewer?.token || !viewer.login || !Number.isFinite(viewer.expiresAt) || viewer.expiresAt <= now) {
    session.destroy();
    throw new HttpError(401, "Sign in with GitHub to see the review.");
  }
  return viewer;
}

export async function requireViewer(req: VercelRequest, res: VercelResponse): Promise<Viewer> {
  return sessionViewer(await getSession(req, res));
}

export async function beginLogin(session: IronSession<SessionData>, settings: AuthConfig, now = Date.now()): Promise<string> {
  const state = oauth.generateRandomState();
  const verifier = oauth.generateRandomCodeVerifier();
  delete session.viewer;
  session.login = { state, verifier, createdAt: now };
  await session.save();
  const url = new URL(github.authorization_endpoint!);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: `${settings.baseUrl}/api/auth/callback`,
    state,
    code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
    code_challenge_method: "S256",
    allow_signup: "false",
  }).toString();
  return url.href;
}

export async function completeLogin(session: IronSession<SessionData>, callback: URL, settings: AuthConfig, now = Date.now()): Promise<void> {
  const attempt = session.login;
  if (!attempt) throw new HttpError(400, "Sign-in expired. Start again.");
  delete session.login;
  delete session.viewer;
  await session.save();
  if (now < attempt.createdAt || now - attempt.createdAt >= LOGIN_SECONDS * 1000) {
    throw new HttpError(400, "Sign-in expired. Start again.");
  }
  const client: oauth.Client = { client_id: settings.clientId };
  let parameters: URLSearchParams;
  try {
    parameters = oauth.validateAuthResponse(github, client, callback, attempt.state);
  } catch {
    throw new HttpError(400, "Sign-in was cancelled or could not be verified. Start again.");
  }
  const response = await oauth.authorizationCodeGrantRequest(
    github,
    client,
    oauth.ClientSecretPost(settings.clientSecret),
    parameters,
    `${settings.baseUrl}/api/auth/callback`,
    attempt.verifier,
    { signal: AbortSignal.timeout(12_000), headers: { Accept: "application/json" } },
  );
  if (response.status >= 500 || response.status === 429) throw new HttpError(503, "GitHub sign-in is temporarily unavailable.");
  // GitHub reports OAuth errors with HTTP 200.
  const body = (await response.clone().json()) as { error?: string };
  if (body.error) throw new HttpError(401, "GitHub rejected this sign-in. Start again.");
  let result: oauth.TokenEndpointResponse;
  try {
    result = await oauth.processAuthorizationCodeResponse(github, client, response);
  } catch {
    throw new HttpError(503, "GitHub sign-in is temporarily unavailable.");
  }
  const token = result.access_token;
  const user = await githubUser(token);
  const access = await checkRepoAccess(token);
  const lifetime = Math.min(SESSION_SECONDS, typeof result.expires_in === "number" ? result.expires_in : SESSION_SECONDS);
  session.viewer = { token, login: user.login, canWrite: access.canWrite, expiresAt: now + lifetime * 1000 };
  await session.save();
}
