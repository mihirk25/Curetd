import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

// Mirror src/lib/clip-moments.ts for unit coverage without a TS loader.
function asFiniteNumber(value, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function hasEmptyMoments(data) {
  return !Array.isArray(data?.moments) || data.moments.length === 0;
}

function legacyMomentFromTopLevel(data) {
  if (!data) return null;
  const startTime = asFiniteNumber(data.startTime, NaN);
  const endTime = asFiniteNumber(data.endTime, NaN);
  if (!Number.isFinite(startTime) && !Number.isFinite(endTime)) return null;
  const st = Number.isFinite(startTime) ? startTime : 0;
  const et = Number.isFinite(endTime) ? endTime : st;
  return {
    id: data.id ? `${data.id}_legacy` : "legacy",
    startTime: st,
    endTime: et,
    note: typeof data.note === "string" ? data.note : "",
    topic: typeof data.topic === "string" ? data.topic : "",
    addedAt: data.createdAt ?? null,
  };
}

function momentsBeforeAppend(data) {
  if (Array.isArray(data?.moments) && data.moments.length > 0) {
    return data.moments;
  }
  const legacy = legacyMomentFromTopLevel(data);
  return legacy ? [legacy] : [];
}

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

const helperSource = read("src/lib/clip-moments.ts");
const homePageSource = read("app/page.tsx");
const collectionModalSource = read("app/components/collection-add-clips-modal.tsx");
const extensionRestSource = read("curatd-extension/firebase-rest.js");

describe("critical regressions — legacy moment materialization on merge", () => {
  test("momentsBeforeAppend preserves top-level range when moments is empty", () => {
    assert.equal(hasEmptyMoments({ moments: [] }), true);
    assert.equal(hasEmptyMoments({}), true);
    assert.equal(hasEmptyMoments({ moments: [{ id: "m1" }] }), false);

    const legacy = momentsBeforeAppend({
      id: "clip1",
      startTime: 10,
      endTime: 40,
      note: "keep me",
      topic: "General",
      moments: [],
    });
    assert.equal(legacy.length, 1);
    assert.equal(legacy[0].id, "clip1_legacy");
    assert.equal(legacy[0].startTime, 10);
    assert.equal(legacy[0].endTime, 40);
    assert.equal(legacy[0].note, "keep me");

    const kept = momentsBeforeAppend({
      moments: [{ id: "m1", startTime: 1, endTime: 2 }],
      startTime: 99,
      endTime: 100,
    });
    assert.equal(kept.length, 1);
    assert.equal(kept[0].id, "m1");

    assert.deepEqual(momentsBeforeAppend({ moments: [] }), []);
    assert.deepEqual(momentsBeforeAppend(null), []);
  });

  test("shared helper is exported and wired into homepage + collection merge paths", () => {
    assert.match(helperSource, /export function momentsBeforeAppend/);
    assert.match(helperSource, /export function hasEmptyMoments/);
    assert.match(helperSource, /export function legacyMomentFromTopLevel/);
    assert.match(homePageSource, /momentsBeforeAppend/);
    assert.match(homePageSource, /hasEmptyMoments/);
    assert.match(collectionModalSource, /momentsBeforeAppend/);
    assert.match(collectionModalSource, /hasEmptyMoments/);
  });

  test("homepage Add Moment materializes legacy top-level ranges before writing moments", () => {
    const start = homePageSource.indexOf("const submitInlineMoment = async");
    const end = homePageSource.indexOf("const deleteMoment = async");
    assert.ok(start > 0 && end > start);
    const block = homePageSource.slice(start, end);
    assert.match(block, /existingMoments\.length === 0/);
    assert.match(block, /momentsBeforeAppend/);
    assert.match(block, /arrayUnion\(moment\)/);
  });

  test("homepage Save Clip merge materializes empty moments before append", () => {
    const start = homePageSource.indexOf("const handleSave = async");
    const end = homePageSource.indexOf("const handleEdit = ");
    assert.ok(start > 0 && end > start);
    const block = homePageSource.slice(start, end);
    assert.match(block, /momentsBeforeAppend/);
    assert.match(block, /hasEmptyMoments\(existingData\)/);
  });

  test("deleteMoment refuses emptying moments to avoid phantom legacy wipe", () => {
    const start = homePageSource.indexOf("const deleteMoment = async");
    const end = homePageSource.indexOf("const filtered = useMemo");
    assert.ok(start > 0 && end > start);
    const block = homePageSource.slice(start, end);
    assert.match(block, /next\.length === 0/);
    assert.match(block, /Delete the whole clip instead/);
    assert.doesNotMatch(
      block,
      /await updateDoc\(doc\(db, "clips", clip\.id\), \{ moments: next \}\);[\s\S]*next\.length === 0/,
    );
  });

  test("extension merge materializes legacy top-level range before push", () => {
    assert.match(extensionRestSource, /function momentsBeforeAppend/);
    assert.match(extensionRestSource, /function legacyMomentFromTopLevel/);
    const start = extensionRestSource.indexOf("async function saveClip");
    assert.ok(start > 0);
    const block = extensionRestSource.slice(start, start + 2200);
    assert.match(block, /momentsBeforeAppend\(existing\.data, existing\.id\)/);
    assert.doesNotMatch(
      block,
      /const moments = Array\.isArray\(existing\.data\.moments\) \? \[\.\.\.existing\.data\.moments\] : \[\];\s*moments\.push\(moment\)/,
    );
  });

  test("collection New clip merge materializes empty moments before append", () => {
    assert.match(collectionModalSource, /momentsBeforeAppend\(existingData\)/);
    assert.match(collectionModalSource, /hasEmptyMoments\(existingData\)/);
  });
});
