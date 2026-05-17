import type { Metadata } from "next";
import { buildClipShareMetadata, getClipForMetadata } from "../../lib/clip-metadata";
import ClipPageClient from "./clip-page-client";

type ClipPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: ClipPageProps): Promise<Metadata> {
  const { id } = await params;
  const clip = await getClipForMetadata(id);

  if (!clip) {
    return {
      title: "Clip not found | Curatd",
      description: "This Curatd clip could not be found.",
    };
  }

  const { title, description, url, image } = buildClipShareMetadata(clip);

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: "Curatd",
      type: "article",
      images: image ? [{ url: image, width: 1280, height: 720 }] : undefined,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default function ClipPage() {
  return <ClipPageClient />;
}
