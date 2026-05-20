import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const SOURCE = await readFile(new URL("../curatd-extension/curatd-bridge.js", import.meta.url), "utf8");
const AUTH_KEY = "firebase:authUser:correct-api-key:[DEFAULT]";

function authRow(key, uid) {
  return {
    fbase_key: key,
    value: JSON.stringify({
      uid,
      email: `${uid}@example.com`,
      stsTokenManager: {
        accessToken: `token-${uid}`,
        refreshToken: `refresh-${uid}`,
        expirationTime: Date.now() + 60 * 60 * 1000,
      },
    }),
  };
}

function requestWithResult(result) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

async function runBridge({ direct = undefined, rows = [] } = {}) {
  const messages = [];
  const db = {
    transaction() {
      return {
        objectStore() {
          return {
            get(key) {
              return requestWithResult(key === AUTH_KEY ? direct : undefined);
            },
            getAll() {
              return requestWithResult(rows);
            },
          };
        },
      };
    },
    close() {},
  };

  const context = {
    FIREBASE_CONFIG: { apiKey: "correct-api-key" },
    indexedDB: {
      open() {
        return requestWithResult(db);
      },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messages.push(message);
          callback?.();
        },
      },
    },
    document: {
      addEventListener() {},
      visibilityState: "visible",
    },
    window: {
      addEventListener() {},
    },
    setInterval() {
      return 1;
    },
  };

  vm.runInNewContext(SOURCE, context, { filename: "curatd-bridge.js" });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return messages;
}

test("syncs the exact Firebase auth row", async () => {
  const messages = await runBridge({ direct: authRow(AUTH_KEY, "expected-user") });

  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "CURATD_AUTH_SESSION");
  assert.equal(messages[0].session.uid, "expected-user");
});

test("does not fall back to another Firebase auth row", async () => {
  const messages = await runBridge({
    rows: [authRow("firebase:authUser:other-api-key:[DEFAULT]", "wrong-user")],
  });

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { type: "CURATD_AUTH_SESSION", session: null });
});

test("sends an initial clear when no Firebase auth row exists", async () => {
  const messages = await runBridge();

  assert.equal(messages.length, 1);
  assert.deepEqual(messages[0], { type: "CURATD_AUTH_SESSION", session: null });
});
