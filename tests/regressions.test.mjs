import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const root = new URL("../", import.meta.url);

async function readText(path) {
  return readFile(new URL(path, root), "utf8");
}

test("legal names are stored outside public user documents", async () => {
  const firestore = await readText("src/lib/firestore.ts");
  const rules = await readText("firestore.rules");

  assert.match(firestore, /doc\(db, "privateUsers", uid\)/);
  assert.match(firestore, /hasLegalName: true/);
  assert.match(firestore, /firstName: deleteField\(\)/);
  assert.match(firestore, /lastName: deleteField\(\)/);
  assert.doesNotMatch(
    firestore,
    /doc\(db, "users", uid\),\s*\{\s*firstName,\s*lastName/s,
  );

  assert.match(rules, /match \/privateUsers\/\{userId\}/);
  assert.match(rules, /allow read: if isOwner\(userId\)/);
  assert.match(rules, /allow read: if isOwner\(userId\) \|\| hasNoPublicLegalName\(resource\.data\)/);
  assert.match(rules, /allow create, update: if isOwner\(userId\) && hasNoPublicLegalName\(request\.resource\.data\)/);
});

test("saved clips are scoped to the current user", async () => {
  const page = await readText("app/page.tsx");
  const rules = await readText("firestore.rules");

  assert.match(page, /where\("userId", "==", user\.uid\)/);
  assert.match(page, /savedClipDocId\(user\.uid, clip\.id\)/);
  assert.doesNotMatch(page, /doc\(db, "savedClips", clip\.id\)/);

  assert.match(rules, /match \/savedClips\/\{id\}/);
  assert.match(rules, /resource\.data\.userId == request\.auth\.uid/);
  assert.match(rules, /request\.resource\.data\.userId == request\.auth\.uid/);
});

test("conversation rules require membership", async () => {
  const rules = await readText("firestore.rules");

  assert.match(rules, /function isConversationParticipant\(data\)/);
  assert.match(rules, /request\.auth\.uid in data\.participants/);
  assert.match(rules, /allow read: if isConversationParticipant\(resource\.data\)/);
  assert.match(rules, /allow create: if canAccessConversation\(id\)\s*&& request\.resource\.data\.senderId == request\.auth\.uid/s);
  assert.doesNotMatch(rules, /match \/conversations\/\{id\} \{\s*allow read, write: if request\.auth != null;/s);
});

test("extension save uses atomic moment append and never writes email", async () => {
  const source = await readText("curatd-extension/firebase-rest.js");
  assert.doesNotMatch(source, /curatorEmail:\s*session\.email/);

  const requests = [];
  const sandbox = {
    FIREBASE_CONFIG: { projectId: "demo-project", apiKey: "demo-key" },
    CuratdAuth: {
      async getStoredSession() {
        return {
          idToken: "token",
          refreshToken: "refresh",
          uid: "user_1",
          email: "private@example.com",
          expiresAt: Date.now() + 120_000,
        };
      },
      async saveSession() {},
    },
    crypto: { randomUUID: () => "moment-1" },
    fetch: async (url, options = {}) => {
      requests.push({ url: String(url), options });
      if (String(url).endsWith("/users/user_1")) {
        return jsonResponse({
          fields: {
            username: { stringValue: "curator" },
          },
        });
      }
      if (String(url).endsWith("/documents:runQuery")) {
        return jsonResponse([]);
      }
      if (String(url).endsWith("/documents:commit")) {
        return jsonResponse({ writeResults: [{}] });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;

  vm.runInNewContext(source, sandbox, { filename: "firebase-rest.js" });

  const result = await sandbox.CuratdFirebaseRest.saveClip({
    videoId: "abc123",
    videoTitle: "A clip",
    channelName: "Channel",
    startTime: 12,
    endTime: 34,
  });

  assert.equal(result.clipId, "ext_user_1_abc123");
  const commit = requests.find((request) => request.url.endsWith("/documents:commit"));
  assert.ok(commit, "expected Firestore commit request");
  const body = JSON.parse(commit.options.body);
  const write = body.writes[0];

  assert.equal(
    write.update.name,
    "projects/demo-project/databases/(default)/documents/clips/ext_user_1_abc123",
  );
  assert.ok(write.updateTransforms?.some((transform) => transform.fieldPath === "moments"));
  assert.ok(
    write.updateTransforms?.some((transform) => transform.appendMissingElements?.values?.length === 1),
  );
  assert.ok(write.updateMask.fieldPaths.includes("curatorEmail"));
  assert.equal(write.update.fields.curatorEmail, undefined);
  assert.equal(JSON.stringify(body).includes("private@example.com"), false);
});

function jsonResponse(data) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(data);
    },
    async json() {
      return data;
    },
  };
}
