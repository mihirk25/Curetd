import {
  buildClipShareMetadata,
  getClipForMetadata,
} from "../../lib/clip-metadata";
import {
  clipShareMetadata,
  defaultClipShareMetadata,
} from "../../lib/clip-share-metadata";
import ClipPageClient from "./clip-page-client";

type ClipPageProps = {
  params: Promise<{ id: string }>;
};

/** Always resolve OG tags at request time (needs live Admin credentials). */
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: ClipPageProps) {
  const { id } = await params;

  try {
    const clip = await getClipForMetadata(id);
    if (!clip) {
      return defaultClipShareMetadata(id);
    }

    const { title, description, image } = buildClipShareMetadata(clip);
    return clipShareMetadata({
      clipId: id,
      title,
      description,
      image,
    });
  } catch (err) {
    if (process.env.NODE_ENV === "development") {
      console.error("[generateMetadata] clip OG fallback:", err);
    }
    return defaultClipShareMetadata(id);
  }
}

export default function ClipPage() {
  return <ClipPageClient />;
}
