import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const firestoreSource = readFileSync(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");
const helperSource = readFileSync(
  new URL("../app/lib/curator-username.ts", import.meta.url),
  "utf8",
);
const clipMetadataSource = readFileSync(
  new URL("../app/lib/clip-metadata.ts", import.meta.url),
  "utf8",
);
const clipPageSource = readFileSync(
  new URL("../app/clip/[id]/clip-page-client.js", import.meta.url),
  "utf8",
);
const homePageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const explorePageSource = readFileSync(new URL("../app/explore/page.tsx", import.meta.url), "utf8");
const profilePageSource = readFileSync(
  new URL("../app/[username]/page.tsx", import.meta.url),
  "utf8",
);

/** Mirror of app/lib/curator-username.ts — keep in sync via source assertions below. */
function normalizeCuratorUsername(value) {
  return typeof value === "string" && value.trim() ? value.trim().toLowerCase() : null;
}

function resolveCuratorHandle(entity, liveByUid) {
  const uid = typeof entity.userId === "string" && entity.userId ? entity.userId : null;
  if (uid && liveByUid && Object.prototype.hasOwnProperty.call(liveByUid, uid)) {
    const entry = liveByUid[uid];
    if (typeof entry === "string" || entry == null) {
      return normalizeCuratorUsername(entry);
    }
    return normalizeCuratorUsername(entry.username);
  }
  return normalizeCuratorUsername(entity.username);
}

function testResolveCuratorHandlePrefersLiveUsername() {
  assert.match(helperSource, /Object\.prototype\.hasOwnProperty\.call\(liveByUid, uid\)/);
  assert.match(helperSource, /Prefer the live `users\/\{userId\}\.username`/);

  const clip = { userId: "alice-uid", username: "old_handle" };
  assert.equal(
    resolveCuratorHandle(clip, { "alice-uid": "new_handle" }),
    "new_handle",
    "live users/{uid}.username must win over denormalized clip.username",
  );
  assert.equal(
    resolveCuratorHandle(clip, { "alice-uid": { username: "new_handle" } }),
    "new_handle",
  );
  assert.equal(
    resolveCuratorHandle(clip, { "alice-uid": null }),
    null,
    "successful live lookup with no username must not fall back to stale denormalized handle",
  );
  assert.equal(
    resolveCuratorHandle(clip, {}),
    "old_handle",
    "denormalized username is ok only before live lookup lands",
  );
  assert.equal(resolveCuratorHandle({ username: "solo" }, null), "solo");

  // Hijack scenario: old handle recycled after rename.
  assert.equal(
    resolveCuratorHandle(
      { userId: "alice-uid", username: "alice" },
      { "alice-uid": "alice2" },
    ),
    "alice2",
  );
}

function testChangeUsernameRewritesDenormalizedOwnedDocs() {
  assert.match(
    firestoreSource,
    /rewriteOwnedDenormalizedUsernames/,
    "changeUsername must rewrite denormalized usernames on owned docs",
  );
  assert.match(firestoreSource, /writeBatch/);
  assert.match(firestoreSource, /"clips"/);
  assert.match(firestoreSource, /"collections"/);
  assert.match(
    firestoreSource,
    /await rewriteOwnedDenormalizedUsernames\(uid, normalized\)/,
  );
}

function testClipReadsPreferLiveUsername() {
  assert.match(clipMetadataSource, /return await fetchUser\(data\.userId\)/);
  assert.doesNotMatch(
    clipMetadataSource,
    /if \(username \|\| typeof data\.userId/,
    "must not short-circuit on stale denormalized username",
  );

  assert.match(clipPageSource, /Prefer live profile username/);
  assert.match(clipPageSource, /getDoc\(doc\(db, "users", clip\.userId\)\)/);

  assert.match(homePageSource, /resolveCuratorHandle\(clip, curatorByUid\)/);
  assert.doesNotMatch(
    homePageSource,
    /const handleFromClip\s*=/,
    "homepage must not prefer denormalized clip.username over curatorByUid",
  );

  assert.match(explorePageSource, /resolveCuratorHandle\(clip, curatorUsernameByUid\)/);
  assert.match(profilePageSource, /liveUsername = normalizeCuratorUsername/);
  assert.match(profilePageSource, /getDoc\(doc\(db, "users", originalUid\)\)/);
}

async function main() {
  testResolveCuratorHandlePrefersLiveUsername();
  testChangeUsernameRewritesDenormalizedOwnedDocs();
  testClipReadsPreferLiveUsername();
  console.log("critical-regressions: ok");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
