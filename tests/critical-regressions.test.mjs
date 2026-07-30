import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

function read(rel) {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

describe("critical regressions — curate legacy moments + reserved usernames", () => {
  test("DM Curate writes moments[] + audioOnly so Add Moment cannot orphan the range", () => {
    const src = read("app/messages/messages-client.tsx");
    const curateIdx = src.indexOf("✨");
    assert.ok(curateIdx > 0, "Curate button present");
    // Include moment construction immediately above addDoc
    const momentIdx = src.lastIndexOf("const moment = {", curateIdx);
    assert.ok(momentIdx > 0, "Curate builds a moment object");
    const block = src.slice(momentIdx, curateIdx);
    assert.match(block, /addedAt:\s*Timestamp\.now\(\)/);
    assert.match(block, /moments:\s*\[moment\]/);
    assert.match(block, /audioOnly:\s*false/);
    assert.match(block, /videoUrl:/);
    assert.match(block, /channelName:/);
  });

  test("homepage Add Moment materializes legacy top-level ranges before writing moments", () => {
    const src = read("app/page.tsx");
    const start = src.indexOf("const submitInlineMoment = async");
    const end = src.indexOf("const deleteMoment = async");
    assert.ok(start > 0 && end > start);
    const block = src.slice(start, end);
    assert.match(block, /existingMoments\.length === 0/);
    assert.match(block, /moments:\s*\[legacy,\s*moment\]/);
    assert.match(block, /arrayUnion\(moment\)/);
    assert.match(
      block,
      /Legacy Curate\/DM clips store the range only on top-level fields/,
    );
  });

  test("reserved usernames that shadow App Router routes are rejected", () => {
    const src = read("src/lib/firestore.ts");
    assert.match(src, /export const USERNAME_RESERVED/);
    assert.match(src, /export const RESERVED_USERNAMES/);
    assert.match(src, /"settings"/);
    assert.match(src, /"messages"/);
    assert.match(src, /"explore"/);
    assert.match(src, /"discover"/);
    assert.match(src, /"privacy"/);
    assert.match(src, /isReservedUsername\(username\)/);
    assert.match(src, /throw new Error\(USERNAME_RESERVED\)/);

    // ensureGoogleUserHasUsername must skip reserved email-local candidates
    const ensureStart = src.indexOf("export async function ensureGoogleUserHasUsername");
    const ensureEnd = src.indexOf("export async function registerInitialUsername");
    const ensureBlock = src.slice(ensureStart, ensureEnd);
    assert.match(ensureBlock, /isReservedUsername\(candidate\)/);

    const setup = read("app/username-setup.tsx");
    assert.match(setup, /isReservedUsername/);
    assert.match(setup, /USERNAME_RESERVED/);

    const edit = read("app/edit-username-control.tsx");
    assert.match(edit, /USERNAME_RESERVED/);
    assert.match(edit, /That username is reserved/);
  });

  test("RESERVED_USERNAMES covers static app routes that exist on disk", () => {
    // Lightweight runtime check without compiling TS: parse the Set literals.
    const src = read("src/lib/firestore.ts");
    const m = src.match(/export const RESERVED_USERNAMES = new Set\(\[([\s\S]*?)\]\)/);
    assert.ok(m, "RESERVED_USERNAMES set present");
    const names = [...m[1].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]);
    for (const route of ["settings", "messages", "explore", "discover", "privacy"]) {
      assert.ok(names.includes(route), `missing reserved route: ${route}`);
    }
  });
});
