const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
const firestoreHelpers = fs.readFileSync(path.join(root, "src", "lib", "firestore.ts"), "utf8");
const extensionRest = fs.readFileSync(path.join(root, "curatd-extension", "firebase-rest.js"), "utf8");

assert.match(rules, /match \/privateUsers\/\{userId\}/);
assert.match(rules, /allow read: if isOwner\(userId\);/);
assert.match(rules, /validPrivateUserData\(request\.resource\.data\)/);
assert.match(rules, /match \/users\/\{userId\} \{[\s\S]*hasNoPublicUserSecrets\(request\.resource\.data\)/);
assert.doesNotMatch(
  rules,
  /allow create, update: if request\.auth != null && request\.auth\.uid == userId;/,
);

assert.match(firestoreHelpers, /doc\(db, "privateUsers", uid\)/);
assert.match(firestoreHelpers, /firstName: deleteField\(\)/);
assert.match(firestoreHelpers, /lastName: deleteField\(\)/);
assert.doesNotMatch(
  firestoreHelpers,
  /doc\(db, "users", uid\),\s*\{\s*firstName,\s*lastName/s,
);

assert.doesNotMatch(extensionRest, /curatorEmail: session\.email/);
assert.match(extensionRest, /appendMissingElements/);

console.log("privacy rules regression tests passed");
