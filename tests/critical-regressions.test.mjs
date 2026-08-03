import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

const rulesSource = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
const profilePageSource = readFileSync(new URL("../app/[username]/page.tsx", import.meta.url), "utf8");
const usernameLibSource = readFileSync(new URL("../src/lib/firestore.ts", import.meta.url), "utf8");

describe("critical regressions — username registry create requires profile claim", () => {
  test("usernames create requires users.username to claim the handle after write", () => {
    assert.match(rulesSource, /function userPath\(userId\)/);
    assert.match(
      rulesSource,
      /allow create: if request\.auth != null[\s\S]*?existsAfter\(userPath\(request\.auth\.uid\)\)[\s\S]*?getAfter\(userPath\(request\.auth\.uid\)\)\.data\.username == uname/,
    );
    // Must not allow bare uid-matched create (handle squat → profile URL hijack).
    assert.doesNotMatch(
      rulesSource,
      /match \/usernames\/\{uname\}[\s\S]*?allow create: if request\.auth != null\s*&& request\.resource\.data\.keys\(\)\.hasOnly\(\['uid'\]\)\s*&& request\.auth\.uid == request\.resource\.data\.uid;/,
    );
  });

  test("profile routing resolves identity via usernames registry (blast radius of unbound create)", () => {
    assert.match(profilePageSource, /getDoc\(doc\(db, "usernames", username\.toLowerCase\(\)\)\)/);
    assert.match(profilePageSource, /uid = String\(\(handleSnap\.data\(\) as any\)\?\.uid/);
  });

  test("app claim/rename paths still write handle + users.username together", () => {
    assert.match(usernameLibSource, /tx\.set\(hRef, \{ uid \}\)[\s\S]*?username: candidate/);
    assert.match(usernameLibSource, /tx\.set\(handleRef, \{ uid \}\)[\s\S]*?username: normalized/);
    assert.match(usernameLibSource, /tx\.set\(newRef, \{ uid \}\)[\s\S]*?tx\.update\(userRef, \{ username: normalized \}\)/);
  });
});
