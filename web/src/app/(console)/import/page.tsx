import { ImportForm } from "./form";

export default function ImportPage() {
  const configured = Boolean(process.env.GEMINI_API_KEY);

  return (
    <>
      <div className="head">
        <h1>Import</h1>
        <p>
          A rotation table becomes rows you can check. Extraction happens server-side; nothing
          is written to the database yet.
        </p>
      </div>

      {configured ? (
        <ImportForm />
      ) : (
        <div className="empty">
          <p style={{ color: "var(--off)" }}>GEMINI_API_KEY is not set.</p>
          <p>
            Add it to <span className="mono">web/.env.local</span> and restart the dev server.
            No <span className="mono">NEXT_PUBLIC_</span> prefix — that would put the key in
            the browser bundle.
          </p>
        </div>
      )}
    </>
  );
}
