"use client";

import { useEffect, useRef, useState } from "react";
import { formatBytes } from "@/lib/upload";

/// Shown in the browser only: nothing here is sent anywhere. A PDF or photo is displayed by
/// the browser itself, text-like files are read and shown as they are, and a Word or Excel
/// file — a zip of XML the browser can't draw — is described instead, because rendering it
/// would take a library for a preview of something the server reads anyway.
type View =
  | { kind: "pdf" | "image"; url: string }
  | { kind: "text"; text: string; cut: boolean }
  | { kind: "none"; why: string }
  | { kind: "loading" };

/// Enough to see the headings and the first rows; a class list of 200 is a few tens of KB.
const TEXT_LIMIT = 200_000;

const extOf = (name: string) => name.slice(name.lastIndexOf(".")).toLowerCase();

export function FilePreview({ file, onClose }: { file: File; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>({ kind: "loading" });

  // Opened as a modal, so Escape and focus handling come from the browser.
  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const ext = extOf(file.name);
    let url: string | null = null;
    let cancelled = false;

    if (ext === ".pdf" || [".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
      url = URL.createObjectURL(file);
      setView({ kind: ext === ".pdf" ? "pdf" : "image", url });
    } else if ([".csv", ".tsv", ".txt", ".md"].includes(ext)) {
      file.slice(0, TEXT_LIMIT).text().then((text) => {
        if (!cancelled) setView({ kind: "text", text, cut: file.size > TEXT_LIMIT });
      }).catch(() => {
        if (!cancelled) setView({ kind: "none", why: "This file couldn't be read in the browser." });
      });
    } else {
      setView({
        kind: "none",
        why: ext === ".xlsx" || ext === ".docx"
          ? "Word and Excel files can't be shown here. They are read when you send them, and the proposal that comes back shows what was read."
          : "No preview for this kind of file.",
      });
    }

    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);

  return (
    <dialog
      ref={dialog}
      className="preview"
      aria-label={`Preview of ${file.name}`}
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself, not on anything inside.
      onClick={(e) => { if (e.target === dialog.current) dialog.current?.close(); }}
    >
      <div className="preview-head">
        <span className="mono preview-name">{file.name}</span>
        <span className="dim">{formatBytes(file.size)}</span>
        <button type="button" onClick={() => dialog.current?.close()}>Close</button>
      </div>
      <div className="preview-body">
        {view.kind === "loading" && <p className="dim">Loading…</p>}
        {view.kind === "pdf" && <iframe src={view.url} title={`Preview of ${file.name}`} />}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {view.kind === "image" && <img src={view.url} alt={`Preview of ${file.name}`} />}
        {view.kind === "text" && (
          <>
            <pre className="mono">{view.text}</pre>
            {view.cut && <p className="dim">Showing the first {formatBytes(TEXT_LIMIT)} of the file.</p>}
          </>
        )}
        {view.kind === "none" && <p className="dim">{view.why}</p>}
      </div>
    </dialog>
  );
}
