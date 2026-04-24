"use client";

import { useAuth } from "./auth-context";

export function SignInCuratorModal({
  open,
  onClose,
  title = "Sign in to start curating",
  subtitle = "Create your own collection of YouTube's best moments.",
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}) {
  const { signIn } = useAuth();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => onClose()}
    >
      <div
        className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="text-zinc-500 text-sm mt-2 leading-relaxed">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={() => onClose()}
            className="text-zinc-500 hover:text-white text-2xl leading-none transition-colors shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <button
          type="button"
          onClick={() => void signIn()}
          className="w-full font-bold py-4 rounded-xl transition-all text-sm bg-white text-black hover:bg-zinc-200"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
