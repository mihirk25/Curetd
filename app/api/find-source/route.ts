import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getAdminAuth, getAdminDb } from "@/lib/firebase-admin";

type FindSourceResponse = {
  transcript: string;
  found: boolean;
  exact: { url: string; title: string; timestamp: number } | null;
  recommendations: Array<{ url: string; title: string }>;
  verificationFailed?: boolean;
};

function buildPrompt(shortUrl: string) {
  return `You are helping find the original long-form source of a YouTube Short.

Given this YouTube Short URL: ${shortUrl}

Do the following in order:

1. Transcribe the exact words spoken in this Short, word for word.

2. Using that exact transcript, search for the specific YouTube video where these exact words appear. Return:
- The exact source video URL with timestamp (e.g. youtube.com/watch?v=xxx&t=123)
- The video title
- Set found: true

3. If you cannot find the exact source video, instead return 2-3 long-form YouTube videos from the same creator on the same topic.
For each return the URL and title. Set found: false.

Return your response as JSON only in this format:
{
  \"transcript\": \"...\",
  \"found\": true/false,
  \"exact\": {
    \"url\": \"...\",
    \"title\": \"...\",
    \"timestamp\": 123
  },
  \"recommendations\": [
    { \"url\": \"...\", \"title\": \"...\" }
  ]
}
`;
}

function extractJson(text: string): unknown {
  const t = String(text || "").trim();
  const noFences = t.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const first = noFences.indexOf("{");
  const last = noFences.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("Gemini did not return JSON");
  }
  const jsonText = noFences.slice(first, last + 1);
  return JSON.parse(jsonText) as unknown;
}

function coerceResponse(raw: unknown): FindSourceResponse {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const transcript = typeof obj.transcript === "string" ? obj.transcript : "";
  const found = Boolean(obj.found);

  const exactRaw = obj.exact;
  const exactObj =
    exactRaw && typeof exactRaw === "object" ? (exactRaw as Record<string, unknown>) : null;
  const exact =
    exactObj && typeof exactObj.url === "string" && typeof exactObj.title === "string"
      ? {
          url: exactObj.url,
          title: exactObj.title,
          timestamp: Number(exactObj.timestamp) || 0,
        }
      : null;

  const recsRaw = Array.isArray(obj.recommendations) ? obj.recommendations : [];
  const recommendations = recsRaw
    .map((r) => {
      const row = r && typeof r === "object" ? (r as Record<string, unknown>) : {};
      return {
        url: typeof row.url === "string" ? row.url : "",
        title: typeof row.title === "string" ? row.title : "",
      };
    })
    .filter((r: { url: string; title: string }) => r.url && r.title)
    .slice(0, 5);

  return { transcript, found, exact, recommendations };
}

function getBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { shortUrl?: unknown; clipId?: unknown }
      | null;

    const shortUrl = typeof body?.shortUrl === "string" ? body.shortUrl.trim() : "";
    const clipId = typeof body?.clipId === "string" ? body.clipId.trim() : "";

    if (!shortUrl) {
      return NextResponse.json({ error: "shortUrl is required" }, { status: 400 });
    }
    if (!clipId) {
      return NextResponse.json({ error: "clipId is required" }, { status: 400 });
    }

    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const decoded = await getAdminAuth().verifyIdToken(token).catch(() => null);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Invalid authentication token" }, { status: 401 });
    }

    const adminDb = getAdminDb();
    const clipRef = adminDb.collection("clips").doc(clipId);
    const clipSnap = await clipRef.get();
    if (!clipSnap.exists) {
      return NextResponse.json({ error: "Clip not found" }, { status: 404 });
    }

    const clip = clipSnap.data() || {};
    const ownerId =
      typeof clip.userId === "string"
        ? clip.userId
        : typeof clip.curatorId === "string"
          ? clip.curatorId
          : "";
    if (ownerId !== decoded.uid) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

    const result = await model.generateContent(buildPrompt(shortUrl));
    const text = result.response.text();
    const parsed = extractJson(text);
    let sourceData: FindSourceResponse = coerceResponse(parsed);

    // Verify Gemini's exact match still exists (deleted videos return non-200).
    if (sourceData.found === true && sourceData.exact?.url) {
      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
          sourceData.exact.url,
        )}&format=json`;
        const resp = await fetch(oembedUrl, { method: "GET" });
        if (!resp.ok) {
          sourceData = {
            ...sourceData,
            found: false,
            exact: null,
            verificationFailed: true,
          };
        }
      } catch {
        sourceData = {
          ...sourceData,
          found: false,
          exact: null,
          verificationFailed: true,
        };
      }
    }

    // Persist to Firestore using Admin SDK (only after auth + ownership checks).
    await clipRef.set({ sourceData }, { merge: true });

    return NextResponse.json(sourceData);
  } catch (e: unknown) {
    const message =
      e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
