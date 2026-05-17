"use client";

import { useEffect, useState } from "react";
import { supportsChromeExtensionBrowser } from "../lib/browser";

/** Client-only; false until mounted, then reflects `navigator.userAgent`. */
export function useSupportsChromeExtension(): boolean {
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setSupported(supportsChromeExtensionBrowser());
  }, []);

  return supported;
}
