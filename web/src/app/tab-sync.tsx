"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/// Sign-in lives in cookies, which every tab of a browser shares, so a tab opened after
/// someone signs in is already signed in. A tab that was open before is not told: its page was
/// drawn once and stays as drawn, so a lock screen goes on being a lock screen after another
/// tab has opened the console, and the console goes on showing after another tab locked it.
///
/// So when a tab comes back into view its page is asked for again. The server decides what
/// that page is — the pages redirect to and from /unlock by the session's state — and what the
/// person has typed into a form stays where it is.
const MIN_GAP_MS = 5_000;

export function TabSync() {
  const router = useRouter();

  useEffect(() => {
    let last = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - last < MIN_GAP_MS) return;
      last = now;
      router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  return null;
}
