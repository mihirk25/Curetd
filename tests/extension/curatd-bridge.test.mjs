import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../../curatd-extension/curatd-bridge.js", import.meta.url), "utf8");

function waitForBridge() {
  return new Promise((resolve) => setImmediate(resolve));
}

function requestWithSuccess(result) {
  const request = {};
  queueMicrotask(() => {
    request.result = result;
    request.onsuccess?.();
  });
  return request;
}

function loadBridge({ indexedDB }) {
  const messages = [];
  const context = {
    FIREBASE_CONFIG: {
      apiKey: "test-api-key",
    },
    indexedDB,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (message, callback) => {
          messages.push(message);
          callback?.();
        },
      },
    },
    window: {
      addEventListener: () => {},
    },
    document: {
      visibilityState: "visible",
      addEventListener: () => {},
    },
    console,
    Error,
    JSON,
    Number,
    Object,
    String,
    setInterval: () => 0,
    queueMicrotask,
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { messages };
}

test("bridge clears extension auth on an initial signed-out state", async () => {
  const { messages } = loadBridge({
    indexedDB: {
      open: () => {
        const request = {};
        queueMicrotask(() => {
          request.error = new Error("missing db");
          request.onerror?.();
        });
        return request;
      },
    },
  });

  await waitForBridge();
  await waitForBridge();

  assert.deepEqual(messages, [
    {
      type: "CURATD_AUTH_SESSION",
      session: null,
    },
  ]);
});

test("bridge does not sync auth rows for a different Firebase key", async () => {
  const wrongKeyRow = {
    fbase_key: "firebase:authUser:other-api-key:[DEFAULT]",
    value: JSON.stringify({
      uid: "wrong-user",
      email: "wrong@example.com",
      stsTokenManager: {
        accessToken: "wrong-token",
        refreshToken: "wrong-refresh",
        expirationTime: Date.now() + 3_600_000,
      },
    }),
  };

  const db = {
    transaction: () => ({
      objectStore: () => ({
        get: () => requestWithSuccess(undefined),
        getAll: () => requestWithSuccess([wrongKeyRow]),
      }),
    }),
    close: () => {},
  };

  const { messages } = loadBridge({
    indexedDB: {
      open: () => requestWithSuccess(db),
    },
  });

  await waitForBridge();
  await waitForBridge();

  assert.deepEqual(messages, [
    {
      type: "CURATD_AUTH_SESSION",
      session: null,
    },
  ]);
});
