import { Suspense } from "react";
import { MessagesClient } from "./messages-client";

export default function MessagesPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black text-white font-sans flex items-center justify-center">
          <div className="text-sm text-zinc-500">Loading…</div>
        </div>
      }
    >
      <MessagesClient />
    </Suspense>
  );
}

