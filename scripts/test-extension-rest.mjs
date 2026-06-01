import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../curatd-extension/firebase-rest.js", import.meta.url), "utf8");

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

async function runSave({ userResponse, queryDocuments }) {
  const commits = [];
  const fetchCalls = [];
  const context = {
    console,
    FIREBASE_CONFIG: { apiKey: "api-key", projectId: "demo-project" },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "id-token",
          refreshToken: "refresh-token",
          uid: "uid123",
          email: "owner@example.com",
          expiresAt: Date.now() + 600_000,
        };
      },
      async saveSession() {},
    },
    crypto: {
      randomUUID() {
        return "moment-1";
      },
    },
    async fetch(url, options = {}) {
      fetchCalls.push({ url, options });
      if (url.includes("/documents/users/uid123")) {
        return userResponse;
      }
      if (url.endsWith("/documents:runQuery")) {
        return jsonResponse((queryDocuments || []).map((document) => ({ document })));
      }
      if (url.endsWith("/documents:commit")) {
        const body = JSON.parse(String(options.body || "{}"));
        commits.push(body);
        return jsonResponse({ writeResults: [{}] });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "firebase-rest.js" });

  const result = await context.CuratdFirebaseRest.saveClip({
    videoId: "abc123",
    videoTitle: "A video",
    channelName: "A channel",
    startTime: 12,
    endTime: 34,
  });

  return { result, commits, fetchCalls };
}

{
  const existingDocument = {
    name: "projects/demo-project/databases/(default)/documents/clips/existingClip",
    fields: {
      moments: {
        arrayValue: {
          values: [
            {
              mapValue: {
                fields: {
                  id: { stringValue: "old-moment" },
                },
              },
            },
          ],
        },
      },
    },
  };
  const { result, commits } = await runSave({
    userResponse: jsonResponse({
      fields: {
        username: { stringValue: "Alice" },
      },
    }),
    queryDocuments: [existingDocument],
  });

  assert.equal(result.clipId, "existingClip");
  assert.equal(result.merged, true);
  assert.equal(commits.length, 1);
  const write = commits[0].writes[0];
  assert.equal(write.update.name.endsWith("/clips/existingClip"), true);
  assert.equal("moments" in write.update.fields, false, "must not overwrite moments array");
  assert.equal("curatorEmail" in write.update.fields, false, "must not write curator email");
  assert.equal(write.updateMask.fieldPaths.includes("curatorEmail"), true, "must scrub legacy email");
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
  assert.equal(
    write.updateTransforms[0].appendMissingElements.values[0].mapValue.fields.id.stringValue,
    "moment-1",
  );
}

{
  const { result, commits } = await runSave({
    userResponse: jsonResponse(
      { error: { message: "Document not found." } },
      { ok: false, status: 404 },
    ),
    queryDocuments: [],
  });

  assert.equal(result.clipId, "uid123_abc123_video");
  assert.equal(result.merged, false);
  assert.equal(commits.length, 1);
  const write = commits[0].writes[0];
  assert.equal(write.update.name.endsWith("/clips/uid123_abc123_video"), true);
  assert.equal(write.update.fields.displayName.stringValue, "Anonymous");
  assert.deepEqual(write.update.fields.username, { nullValue: null });
  assert.equal("curatorEmail" in write.update.fields, false, "must not write curator email");
  assert.equal(write.updateTransforms[0].fieldPath, "moments");
}

console.log("extension REST regression tests passed");
