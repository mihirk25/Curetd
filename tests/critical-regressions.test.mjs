import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

// Pure helper logic mirrored from app/lib/author-username.ts for unit coverage
// without a TS loader; source-shape assertions lock the wired call sites.

function normalizeAuthorUsername(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function resolveAuthorHandle(entity, liveByUid) {
  const uid = typeof entity.userId === "string" && entity.userId ? entity.userId : null;
  if (uid && liveByUid && Object.prototype.hasOwnProperty.call(liveByUid, uid)) {
    const entry = liveByUid[uid];
    if (typeof entry === "string" || entry == null) {
      return normalizeAuthorUsername(entry);
    }
    return normalizeAuthorUsername(entry.username);
  }
  return normalizeAuthorUsername(entity.username);
}

const firestoreSource = readFileSync(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const homePageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const authorHelperSource = readFileSync(new URL("../app/lib/author-username.ts", import.meta.url), "utf8");
const indexesSource = readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8");

describe("critical regressions — comment authorship after username rename", () => {
  test("resolveAuthorHandle prefers live users/{uid}.username over denormalized comment.username", () => {
    const comment = { userId: "alice-uid", username: "old_handle" };
    assert.equal(
      resolveAuthorHandle(comment, { "alice-uid": "new_handle" }),
      "new_handle",
      "live string entry must win (prevents reclaim hijack)",
    );
    assert.equal(
      resolveAuthorHandle(comment, { "alice-uid": { username: "new_handle" } }),
      "new_handle",
    );
    assert.equal(
      resolveAuthorHandle(comment, { "alice-uid": null }),
      null,
      "explicit null live entry must not fall back to stale denormalized handle",
    );
    assert.equal(
      resolveAuthorHandle(comment, {}),
      "old_handle",
      "missing live lookup may fall back until fetch completes",
    );
    assert.equal(resolveAuthorHandle({ username: "solo" }, null), "solo");
  });

  test("author-username helper exports resolveAuthorHandle with live-prefer semantics", () => {
    assert.match(authorHelperSource, /export function resolveAuthorHandle/);
    assert.match(authorHelperSource, /Object\.prototype\.hasOwnProperty\.call\(liveByUid, uid\)/);
    assert.match(authorHelperSource, /normalizeAuthorUsername\(entry\.username\)/);
  });

  test("homepage comment UI resolves handles via resolveAuthorHandle + live curator map", () => {
    assert.match(homePageSource, /import \{ resolveAuthorHandle \} from "\.\/lib\/author-username"/);
    assert.match(homePageSource, /resolveAuthorHandle\(c, curatorByUid\)/);
    // Must fetch profiles for comment authors, not only clip curators.
    assert.match(homePageSource, /commentsByClipId/);
    const effectStart = homePageSource.indexOf("for (const list of Object.values(commentsByClipId))");
    assert.ok(effectStart > 0, "curator fetch must scan comment author userIds");
  });

  test("changeUsername rewrites denormalized comment usernames after rename", () => {
    assert.match(
      firestoreSource,
      /rewriteOwnedCommentUsernames/,
      "changeUsername must rewrite denormalized usernames on owned comments",
    );
    assert.match(firestoreSource, /collectionGroup\(db, "comments"\)/);
    assert.match(
      firestoreSource,
      /await rewriteOwnedCommentUsernames\(uid, normalized\)/,
    );
    // displayName is also denormalized on comments
    assert.match(firestoreSource, /displayName:\s*username/);
  });

  test("firestore indexes enable collection-group comment userId rewrite queries", () => {
    const indexes = JSON.parse(indexesSource);
    const override = (indexes.fieldOverrides || []).find(
      (o) => o.collectionGroup === "comments" && o.fieldPath === "userId",
    );
    assert.ok(override, "comments.userId field override required");
    const groupAsc = (override.indexes || []).some(
      (i) => i.queryScope === "COLLECTION_GROUP" && i.order === "ASCENDING",
    );
    assert.ok(groupAsc, "COLLECTION_GROUP ASCENDING index required for rewrite query");
  });
});
