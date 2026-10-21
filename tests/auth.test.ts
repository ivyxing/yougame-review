import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { activeViewer, sessionViewer, type SessionData, type Viewer } from "../server/auth.ts";

const NOW = 1_800_000_000_000;
const realFetch = globalThis.fetch;

function fakeSession(viewer?: Viewer) {
  const session = { viewer, saved: 0, destroyed: 0, save: async () => { session.saved++; }, destroy: () => { session.destroyed++; } };
  return session as unknown as { viewer?: Viewer; saved: number; destroyed: number } & Parameters<typeof sessionViewer>[0];
}
const viewer = (over: Partial<Viewer> = {}): Viewer => ({ token: "old", login: "ivy", canWrite: true, expiresAt: NOW - 1000, refreshToken: "r1", refreshExpiresAt: NOW + 86_400_000, ...over });

function stubGitHub(token: Record<string, unknown>, permission = "write", repoStatus = 200) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (url.includes("/login/oauth/access_token")) return Response.json(token);
    if (url.endsWith("/user")) return Response.json({ login: "ivy-renamed" });
    if (url.endsWith("/repos/ivyxing/yougame-review") && repoStatus !== 200) return new Response("{}", { status: repoStatus });
    if (url.endsWith("/repos/ivyxing/yougame-review")) return Response.json({ full_name: "ivyxing/yougame-review", permissions: { push: permission !== "read", pull: true } });
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return calls;
}

beforeEach(() => {
  Object.assign(process.env, { BASE_URL: "https://review.test/", GITHUB_CLIENT_ID: "id", GITHUB_CLIENT_SECRET: "secret", SESSION_SECRET: "s".repeat(40) });
});
afterEach(() => { globalThis.fetch = realFetch; });

test("an expired token that can be refreshed keeps the session", () => {
  const session = fakeSession(viewer());
  assert.throws(() => sessionViewer(session, NOW), { status: 401 });
  assert.equal(session.destroyed, 0);
});

test("an expired token with no refresh token ends the session", () => {
  const session = fakeSession(viewer({ refreshToken: undefined }));
  assert.throws(() => sessionViewer(session, NOW), { status: 401 });
  assert.equal(session.destroyed, 1);
});

test("activeViewer swaps an expired token for a new one and keeps the new refresh token", async () => {
  stubGitHub({ access_token: "new", token_type: "bearer", expires_in: 28800, refresh_token: "r2", refresh_token_expires_in: 15_897_600 });
  const session = fakeSession(viewer());
  const v = await activeViewer(session, NOW);
  assert.equal(v.token, "new");
  assert.equal(v.refreshToken, "r2");
  assert.equal(v.login, "ivy-renamed");
  assert.equal(v.expiresAt, NOW + 28800 * 1000);
  assert.equal(v.refreshExpiresAt, NOW + 15_897_600 * 1000);
  assert.equal(session.saved, 1);
});

test("a rejected refresh asks to sign in again without clearing the cookie", async () => {
  stubGitHub({ error: "bad_refresh_token" });
  const session = fakeSession(viewer());
  await assert.rejects(activeViewer(session, NOW), { status: 401 });
  assert.equal(session.destroyed, 0);
  assert.equal(session.saved, 0);
});

test("a valid token is used as is", async () => {
  const calls = stubGitHub({});
  const v = await activeViewer(fakeSession(viewer({ expiresAt: NOW + 3_600_000 })), NOW);
  assert.equal(v.token, "old");
  assert.equal(calls.length, 0);
});

test("rotated tokens are kept even when the access check fails for a moment", async () => {
  stubGitHub({ access_token: "new", token_type: "bearer", expires_in: 28800, refresh_token: "r2", refresh_token_expires_in: 15_897_600 }, "write", 502);
  const session = fakeSession(viewer());
  await assert.rejects(activeViewer(session, NOW), { status: 503 });
  assert.equal(session.viewer?.refreshToken, "r2");
  assert.equal(session.saved, 1);
  assert.equal(session.destroyed, 0);
});

test("losing access during a refresh ends the session", async () => {
  stubGitHub({ access_token: "new", token_type: "bearer", expires_in: 28800, refresh_token: "r2", refresh_token_expires_in: 15_897_600 }, "write", 404);
  const session = fakeSession(viewer());
  await assert.rejects(activeViewer(session, NOW), { status: 403 });
  assert.equal(session.destroyed, 1);
});
