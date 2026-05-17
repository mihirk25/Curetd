import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — Curatd",
  description: "How Curatd collects, uses, and protects your data.",
};

const CONTACT_EMAIL = "mihirkuvadiya25@gmail.com";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-black font-sans text-white">
      <header className="border-b border-zinc-800 px-4 py-4">
        <Link
          href="/"
          className="text-sm font-bold tracking-tight text-white hover:text-zinc-200 transition-colors"
        >
          CURATD
        </Link>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-2xl font-bold text-white">Privacy Policy</h1>
        <p className="mt-2 text-sm text-zinc-500">Last updated: May 2026</p>

        <div className="mt-10 space-y-8 text-sm leading-relaxed text-zinc-300">
          <section>
            <h2 className="text-base font-semibold text-white">Overview</h2>
            <p className="mt-2">
              Curatd (&quot;we&quot;, &quot;our&quot;) helps you save and share curated clips from online
              video. This policy describes what information we collect and how we use it when you use
              curatd.live and related services.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">What we collect</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-zinc-300">
              <li>
                <strong className="font-medium text-zinc-200">Email address</strong> — when you sign
                in (for example via Google), we receive your email to identify your account.
              </li>
              <li>
                <strong className="font-medium text-zinc-200">Username</strong> — your public handle
                on Curatd (for example @username).
              </li>
              <li>
                <strong className="font-medium text-zinc-200">Profile information</strong> — such as
                a profile photo and topics you choose to display.
              </li>
              <li>
                <strong className="font-medium text-zinc-200">Saved clips</strong> — video URLs,
                timestamps, titles, notes, topics, and other metadata you add when curating.
              </li>
              <li>
                <strong className="font-medium text-zinc-200">Usage data</strong> — basic activity
                needed to run the service (for example follows, messages, and collections you create).
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">How we use your data</h2>
            <p className="mt-2">
              We use the information above solely to provide and improve the Curatd service — including
              authentication, storing your clips, showing your profile and feed, and enabling features
              such as following other curators and messaging.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">Sharing and selling</h2>
            <p className="mt-2">
              We do not sell your personal data. We do not share your data with third parties for
              their marketing purposes. Your clips and profile are visible to other users only as
              designed by the product (for example your public profile and shared clips).
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">Firebase</h2>
            <p className="mt-2">
              Curatd uses{" "}
              <a
                href="https://firebase.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
              >
                Google Firebase
              </a>{" "}
              for authentication and data storage. Account and app data are stored in Firebase
              services (Authentication, Cloud Firestore, and Cloud Storage) subject to Google&apos;s
              terms and privacy practices.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-white">Contact</h2>
            <p className="mt-2">
              Questions about this policy or your data? Email us at{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2"
              >
                {CONTACT_EMAIL}
              </a>
              .
            </p>
          </section>
        </div>

        <p className="mt-12 text-xs text-zinc-600">
          <Link href="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
            ← Back to Curatd
          </Link>
        </p>
      </main>
    </div>
  );
}
