import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const extensionSource = readFileSync(
  new URL("../curatd-extension/firebase-rest.js", import.meta.url),
  "utf8",
);
const subscribeSource = readFileSync(new URL("../app/lib/firestore.ts", import.meta.url), "utf8");

function response({ ok = true, status = 200, body = null } = {}) {
  const text = body == null ? "" : JSON.stringify(body);
  return {
    ok,
    status,
    text: async () => text,
    json: async () => (body == null ? null : body),
  };
}

function loadExtension({ fetchImpl, getStoredSession, saveSession }) {
  const context = {
    console,
    crypto: { randomUUID: () => "moment-test-id" },
    FIREBASE_CONFIG: { apiKey: "test-key", projectId: "test-project" },
    CuratdAuth: {
      getStoredSession,
      saveSession,
    },
    fetch: fetchImpl,
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(extensionSource, context, { filename: "firebase-rest.js" });
  return context.CuratdFirebaseRest;
}

async function testGetValidSessionKeepsLiveTokenOnRefreshFailure() {
  const nearExpirySession = {
    idToken: "still-valid-id-token",
    refreshToken: "refresh-token",
    uid: "user-1",
    email: "user@example.com",
    expiresAt: Date.now() + 30_000,
  };
  let stored = { ...nearExpirySession };
  const api = loadExtension({
    getStoredSession: async () => stored,
    saveSession: async (session) => {
      stored = session;
    },
    fetchImpl: async (url) => {
      if (String(url).includes("securetoken.googleapis.com")) {
        return response({
          ok: false,
          status: 503,
          body: { error: { message: "SERVICE_UNAVAILABLE" } },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  const session = await api.getValidSession();
  assert.equal(session?.idToken, "still-valid-id-token");
  assert.equal(session?.uid, "user-1");
}

async function testGetValidSessionSingleFlightRefresh() {
  let refreshCalls = 0;
  let stored = {
    idToken: "old-token",
    refreshToken: "refresh-token",
    uid: "user-1",
    email: "user@example.com",
    expiresAt: Date.now() + 15_000,
  };
  const api = loadExtension({
    getStoredSession: async () => stored,
    saveSession: async (session) => {
      stored = session;
    },
    fetchImpl: async (url) => {
      if (String(url).includes("securetoken.googleapis.com")) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 40));
        return response({
          body: {
            id_token: "new-token",
            refresh_token: "new-refresh",
            user_id: "user-1",
            expires_in: "3600",
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  const [a, b] = await Promise.all([api.getValidSession(), api.getValidSession()]);
  assert.equal(refreshCalls, 1);
  assert.equal(a?.idToken, "new-token");
  assert.equal(b?.idToken, "new-token");
}

async function testGetValidSessionRereadsStorageAfterRefreshRace() {
  let stored = {
    idToken: "old-token",
    refreshToken: "stale-refresh",
    uid: "user-1",
    email: "user@example.com",
    expiresAt: Date.now() + 20_000,
  };
  const api = loadExtension({
    getStoredSession: async () => stored,
    saveSession: async (session) => {
      stored = session;
    },
    fetchImpl: async (url) => {
      if (String(url).includes("securetoken.googleapis.com")) {
        // Simulate another tab/call already rotating the refresh token.
        stored = {
          idToken: "winner-token",
          refreshToken: "winner-refresh",
          uid: "user-1",
          email: "user@example.com",
          expiresAt: Date.now() + 3_600_000,
        };
        return response({
          ok: false,
          status: 400,
          body: { error: { message: "invalid_grant" } },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  const session = await api.getValidSession();
  assert.equal(session?.idToken, "winner-token");
}

function testSubscribeToMessagesGuardsAsyncCleanup() {
  assert.match(subscribeSource, /let cancelled = false/);
  assert.match(subscribeSource, /if \(cancelled\) return;/);
  assert.match(
    subscribeSource,
    /if \(cancelled\) \{\s*try \{\s*unsub\?\.\(\);/s,
  );
  assert.match(subscribeSource, /cancelled = true;/);
}

async function main() {
  testSubscribeToMessagesGuardsAsyncCleanup();
  await testGetValidSessionKeepsLiveTokenOnRefreshFailure();
  await testGetValidSessionSingleFlightRefresh();
  await testGetValidSessionRereadsStorageAfterRefreshRace();
  console.log("critical-regressions: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
