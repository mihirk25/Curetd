import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

// Mirror src/lib/clip-merge.ts for unit coverage without a TS loader.
function clipMatchesAudioOnlyMode(data, audioOnly) {
  const isAudioOnly = data?.audioOnly === true;
  return isAudioOnly === Boolean(audioOnly);
}

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const mergeHelperSource = readFileSync(new URL("../src/lib/clip-merge.ts", import.meta.url), "utf8");
const homePageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const collectionModalSource = readFileSync(
  new URL("../app/components/collection-add-clips-modal.tsx", import.meta.url),
  "utf8",
);
const messagesSource = readFileSync(
  new URL("../app/messages/messages-client.tsx", import.meta.url),
  "utf8",
);
const extensionRestSource = readFileSync(
  new URL("../curatd-extension/firebase-rest.js", import.meta.url),
  "utf8",
);
const indexesSource = readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8");

describe("critical regressions — username registry orphan delete", () => {
  test("usernames delete requires users.username to no longer claim the handle", () => {
    assert.match(rulesSource, /function userPath\(userId\)/);
    assert.match(rulesSource, /existsAfter\(userPath\(request\.auth\.uid\)\)/);
    assert.match(rulesSource, /getAfter\(userPath\(request\.auth\.uid\)\)\.data\.username != uname/);
    // Must not allow bare owner delete (orphans registry → reclaim hijack).
    assert.doesNotMatch(
      rulesSource,
      /match \/usernames\/\{uname\}[\s\S]*?allow delete: if request\.auth != null\s*&& request\.auth\.uid == resource\.data\.uid;/,
    );
  });
});

describe("critical regressions — legacy audioOnly merge discovery", () => {
  test("clipMatchesAudioOnlyMode treats missing audioOnly as video/false", () => {
    assert.equal(clipMatchesAudioOnlyMode({}, false), true);
    assert.equal(clipMatchesAudioOnlyMode({ audioOnly: false }, false), true);
    assert.equal(clipMatchesAudioOnlyMode({ audioOnly: true }, false), false);
    assert.equal(clipMatchesAudioOnlyMode({}, true), false);
    assert.equal(clipMatchesAudioOnlyMode({ audioOnly: true }, true), true);
    assert.equal(clipMatchesAudioOnlyMode(null, false), true);
  });

  test("merge helper is exported and wired into homepage + collection save paths", () => {
    assert.match(mergeHelperSource, /export function clipMatchesAudioOnlyMode/);
    assert.match(homePageSource, /clipMatchesAudioOnlyMode/);
    assert.match(collectionModalSource, /clipMatchesAudioOnlyMode/);
    // Must not equality-filter audioOnly in the existing-clip query (misses absent field).
    assert.doesNotMatch(
      homePageSource,
      /where\("audioOnly", "==", audioOnly\)/,
    );
    assert.doesNotMatch(
      collectionModalSource,
      /where\("audioOnly", "==", false\)/,
    );
  });

  test("extension findExistingClip matches missing audioOnly as false", () => {
    assert.match(extensionRestSource, /function clipMatchesAudioOnlyMode/);
    assert.match(extensionRestSource, /clipMatchesAudioOnlyMode\(data, false\)/);
    assert.doesNotMatch(
      extensionRestSource,
      /fieldPath: "audioOnly"[\s\S]*?booleanValue:\s*false/,
    );
  });

  test("DM Curate writes audioOnly false so equality-based clients can find it", () => {
    const curateIdx = messagesSource.indexOf("Curate");
    assert.ok(curateIdx > 0);
    // The addDoc near Curate must include audioOnly: false.
    assert.match(messagesSource, /audioOnly:\s*false/);
    const addDocIdx = messagesSource.indexOf("await addDoc(collection(db, \"clips\")");
    assert.ok(addDocIdx > 0);
    const slice = messagesSource.slice(addDocIdx, addDocIdx + 450);
    assert.match(slice, /audioOnly:\s*false/);
  });

  test("firestore indexes include videoId+userId for merge lookup", () => {
    const indexes = JSON.parse(indexesSource);
    const found = (indexes.indexes || []).some((idx) => {
      if (idx.collectionGroup !== "clips") return false;
      const paths = (idx.fields || []).map((f) => f.fieldPath);
      return paths.includes("videoId") && paths.includes("userId");
    });
    assert.ok(found, "clips videoId+userId composite index required");
  });
});
