import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { extractVideoId } from "../app/lib/extract-video-id.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const VIDEO = "jfKfPfyJRdk";

describe("extractVideoId", () => {
  it("parses canonical watch, share, shorts, embed, and youtu.be URLs", () => {
    assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/watch?v=${VIDEO}&si=abc&t=12s`), VIDEO);
    assert.equal(extractVideoId(`https://youtu.be/${VIDEO}?si=abc`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/shorts/${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/embed/${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`www.youtube.com/watch?v=${VIDEO}`), VIDEO);
  });

  it("parses live URLs and watch query params that are not immediately after ?", () => {
    assert.equal(extractVideoId(`https://www.youtube.com/live/${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://youtube.com/live/${VIDEO}?si=abc`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/watch?app=desktop&v=${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/watch?si=abc&v=${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://www.youtube.com/watch?feature=share&v=${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://m.youtube.com/watch?v=${VIDEO}`), VIDEO);
    assert.equal(extractVideoId(`https://music.youtube.com/watch?v=${VIDEO}`), VIDEO);
  });

  it("returns null for non-YouTube or unreadable URLs instead of a fake id", () => {
    assert.equal(extractVideoId(""), null);
    assert.equal(extractVideoId("https://example.com/watch?v=notyoutube"), null);
    assert.equal(extractVideoId("https://www.youtube.com/clip/UgkxNotAVideoId"), null);
    assert.equal(extractVideoId("not a url"), null);
  });
});

describe("homepage save does not persist null videoId", () => {
  it("rejects URLs that cannot be parsed before querying clips", () => {
    const source = readFileSync(join(root, "app/page.tsx"), "utf8");
    assert.match(source, /const videoId = extractVideoId\(url\);/);
    assert.match(
      source,
      /if \(!videoId\) return alert\("Could not read a YouTube video ID from that URL\."\);/,
    );
    const videoIdIdx = source.indexOf("const videoId = extractVideoId(url);");
    const rejectIdx = source.indexOf('if (!videoId) return alert("Could not read a YouTube video ID from that URL.");');
    const queryIdx = source.indexOf('where("videoId", "==", videoId)');
    assert.ok(videoIdIdx !== -1 && rejectIdx !== -1 && queryIdx !== -1);
    assert.ok(rejectIdx > videoIdIdx, "null guard must run after extractVideoId");
    assert.ok(queryIdx > rejectIdx, "videoId grouping query must not run when videoId is missing");
  });
});
