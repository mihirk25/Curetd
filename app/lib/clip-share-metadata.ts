import type { Metadata } from "next";

const DEFAULT_OG_IMAGE = "/og-image.png";
const SITE_URL = "https://curatd.live";

/** Fallback OG tags when clip fetch fails or clip is missing. */
export function defaultClipShareMetadata(clipId?: string): Metadata {
  const url = clipId ? `${SITE_URL}/clip/${clipId}` : SITE_URL;
  const images = [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630 }];

  return {
    title: "Curatd",
    openGraph: {
      title: "Curatd",
      url,
      siteName: "Curatd",
      images,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: "Curatd",
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

export function clipShareMetadata(input: {
  clipId: string;
  title: string;
  description: string;
  image?: string;
}): Metadata {
  const { clipId, title, description } = input;
  const image = input.image ?? DEFAULT_OG_IMAGE;
  const url = `${SITE_URL}/clip/${clipId}`;
  const isYouTube = image.startsWith("https://img.youtube.com/");

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Curatd",
      type: "article",
      images: [
        isYouTube
          ? { url: image, width: 1280, height: 720 }
          : { url: image, width: 1200, height: 630 },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}
