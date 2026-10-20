import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getIronSession, type IronSession } from "iron-session";
import * as oauth from "oauth4webapi";
import { checkRepoAccess, githubUser } from "./github.js";
import { HttpError } from "./http.js";

/** GitHub App user tokens last 8 hours; the refresh token that renews them lasts about 6 months. */
export const SESSION_SECONDS = 184 * 24 * 60 * 60;
const TOKEN_SECONDS = 8 * 60 * 60;
const REFRESH_EARLY_MS = 60_000;
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
  refreshToken?: string;
  refreshExpiresAt?: number;
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

function canRefresh(viewer: Viewer | undefined, now: number): boolean {
  return Boolean(viewer?.refreshToken && Number.isFinite(viewer.refreshExpiresAt) && viewer.refreshExpiresAt! > now);
}

/**
 * The signed-in viewer while their GitHub token is still valid. An expired token that can be refreshed
 * is left in place for activeViewer to renew; anything else ends the session.
 */
export function sessionViewer(session: IronSession<SessionData>, now = Date.now()): Viewer {
  const viewer = session.viewer;
  if (!viewer?.token || !viewer.login || !Number.isFinite(viewer.expiresAt) || viewer.expiresAt <= now) {
    if (!canRefresh(viewer, now)) session.destroy();
    throw new HttpError(401, "Sign in with GitHub to see the review.");
  }
  return viewer;
}

/** Like sessionViewer, but quietly swaps an expiring GitHub token for a new one using the refresh token. */
export async function activeViewer(session: IronSession<SessionData>, now = Date.now()): Promise<Viewer> {
  const viewer = session.viewer;
  if (viewer && viewer.expiresAt - REFRESH_EARLY_MS <= now && canRefresh(viewer, now)) {
    // Parallel requests can race to use the same single-use refresh token. A losing request answers 401
    // without touching the cookie, so it can't sign out the request that won.
    const tokens = await refreshTokens(viewer.refreshToken!, config());
    let access: { canWrite: boolean };
    try {
      access = await checkRepoAccess(tokens.token);
    } catch (error) {
      if (error instanceof HttpError && error.status === 403) session.destroy();
      throw error;
    }
    session.viewer = {
      token: tokens.token,
      refreshToken: tokens.refreshToken,
      login: viewer.login,
      canWrite: access.canWrite,
      ...lifetimes(tokens.expiresIn, tokens.refreshExpiresIn, now),
    };
    await session.save();
    return session.viewer;
  }
  return sessionViewer(session, now);
}

/** Images only need a signed-in viewer, not a GitHub call, so they never refresh (the page does that first). */
export async function requireViewer(req: VercelRequest, res: VercelResponse): Promise<Viewer> {
  return sessionViewer(await getSession(req, res));
}

function lifetimes(expiresIn: number | undefined, refreshExpiresIn: number | undefined, now: number) {
  return {
    expiresAt: now + Math.min(TOKEN_SECONDS, expiresIn ?? TOKEN_SECONDS) * 1000,
    refreshExpiresAt: refreshExpiresIn ? now + Math.min(SESSION_SECONDS, refreshExpiresIn) * 1000 : undefined,
  };
}

interface Tokens {
  token: string;
  refreshToken?: string;
  expiresIn?: number;
  refreshExpiresIn?: number;
}

function tokensFrom(result: oauth.TokenEndpointResponse): Tokens {
  const refreshExpiresIn = result.refresh_token_expires_in;
  return {
    token: result.access_token,
    refreshToken: result.refresh_token,
    expiresIn: typeof result.expires_in === "number" ? result.expires_in : undefined,
    refreshExpiresIn: typeof refreshExpiresIn === "number" ? refreshExpiresIn : undefined,
  };
}

async function refreshTokens(refreshToken: string, settings: AuthConfig): Promise<Tokens> {
  const client: oauth.Client = { client_id: settings.clientId };
  const response = await oauth.refreshTokenGrantRequest(github, client, oauth.ClientSecretPost(settings.clientSecret), refreshToken, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (response.status >= 500 || response.status === 429) throw new HttpError(503, "GitHub sign-in is temporarily unavailable.");
  // GitHub reports OAuth errors with HTTP 200, for example a refresh token that was already used or revoked.
  const body = (await response.clone().json().catch(() => ({}))) as { error?: string };
  if (body.error) throw new HttpError(401, "Your sign-in expired. Sign in again to keep reviewing.");
  try {
    return tokensFrom(await oauth.processRefreshTokenResponse(github, client, response));
  } catch {
    throw new HttpError(503, "GitHub sign-in is temporarily unavailable.");
  }
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
  const tokens = tokensFrom(result);
  const user = await githubUser(tokens.token);
  const access = await checkRepoAccess(tokens.token);
  session.viewer = {
    token: tokens.token,
    refreshToken: tokens.refreshToken,
    login: user.login,
    canWrite: access.canWrite,
    ...lifetimes(tokens.expiresIn, tokens.refreshExpiresIn, now),
  };
  await session.save();
}
