"use client";

export function CuratorRequiredModal({
  open,
  onClose,
  message = "Post your first clip to start messaging other curators.",
}: {
  open: boolean;
  onClose: () => void;
  message?: string;
}) {
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
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-bold text-white">Messaging is for curators</h2>
            <p className="text-zinc-500 text-sm mt-2 leading-relaxed">{message}</p>
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
          onClick={() => onClose()}
          className="w-full font-bold py-4 rounded-xl transition-all text-sm bg-white text-black hover:bg-zinc-200"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

