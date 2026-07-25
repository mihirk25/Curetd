import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadTsModule(relPath) {
  const abs = path.join(root, relPath);
  const source = readFileSync(abs, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: abs,
  });
  const mod = { exports: {} };
  const dirname = path.dirname(abs);
  const localRequire = (id) => {
    if (id.startsWith("@/")) {
      return loadTsModule(id.slice(2));
    }
    if (id.startsWith(".")) {
      const resolved = require.resolve(id, { paths: [dirname] });
      if (resolved.endsWith(".ts") || resolved.endsWith(".tsx")) {
        return loadTsModule(path.relative(root, resolved));
      }
      return require(resolved);
    }
    return require(id);
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function("exports", "require", "module", "__filename", "__dirname", outputText);
  fn(mod.exports, localRequire, mod, abs, dirname);
  return mod.exports;
}

function read(relPath) {
  return readFileSync(path.join(root, relPath), "utf8");
}

test("find-source route requires bearer auth and clip ownership before Admin writes", () => {
  const src = read("app/api/find-source/route.ts");
  assert.match(src, /getAdminAuth/);
  assert.match(src, /verifyIdToken/);
  assert.match(src, /Authentication required/);
  assert.match(src, /Forbidden/);
  assert.match(src, /ownerId !== decoded\.uid/);
  const authIdx = src.indexOf("verifyIdToken");
  const writeIdx = src.indexOf('set({ sourceData }');
  assert.ok(authIdx > -1 && writeIdx > authIdx, "auth checks must precede Admin write");
});

test("firebase-admin exports getAdminAuth", () => {
  const src = read("lib/firebase-admin.ts");
  assert.match(src, /export function getAdminAuth/);
  assert.match(src, /getAuth\(getAdminApp\(\)\)/);
});

test("firestore rules bind users.username to owned usernames handle", () => {
  const rules = read("firestore.rules");
  assert.match(rules, /usernameConsistent/);
  assert.match(rules, /existsAfter\(usernamePath/);
  assert.match(rules, /allow create, update: if isOwner\(userId\) && usernameConsistent\(\)/);
  assert.match(rules, /match \/collections\/\{id\}/);
  assert.match(rules, /match \/reposts\/\{id\}/);
  assert.match(rules, /match \/topics\/\{id\}/);
  assert.match(rules, /onlyUpdatesRepostCount/);
});

test("settings auth modal is derived from auth state", () => {
  const src = read("app/settings/page.tsx");
  assert.match(src, /SignInCuratorModal open=\{!user\}/);
  assert.doesNotMatch(src, /showAuthModal/);
});

test("web moment edit\/delete use transactions over fresh moments", () => {
  const src = read("app/page.tsx");
  assert.match(src, /runTransaction/);
  assert.match(src, /const submitInlineMoment = async/);
  assert.match(src, /const deleteMoment = async/);
  const editBlock = src.slice(src.indexOf("const submitInlineMoment"), src.indexOf("const deleteMoment"));
  assert.match(editBlock, /runTransaction/);
  assert.match(editBlock, /tx\.get\(clipRef\)/);
  const deleteBlock = src.slice(src.indexOf("const deleteMoment"), src.indexOf("const filtered"));
  assert.match(deleteBlock, /runTransaction/);
  assert.match(deleteBlock, /tx\.get\(clipRef\)/);
});

test("collection saveSelection preserves concurrent additions via baseline", () => {
  const src = read("app/components/collection-add-clips-modal.tsx");
  assert.match(src, /baselineIdsRef/);
  assert.match(src, /concurrent add/);
  assert.match(src, /getDoc\(colRef\)/);
});

test("collection reorder moves by clip id inside a transaction", () => {
  const src = read("app/[username]/collections/[slug]/page.tsx");
  assert.match(src, /runTransaction/);
  assert.match(src, /ids\.indexOf\(movingId\)/);
});
