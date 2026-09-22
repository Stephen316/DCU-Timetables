import { Ask } from "./chat";

export default function AskPage() {
  if (!process.env.GEMINI_API_KEY) {
    return (
      <>
        <div className="head"><h1>Ask</h1></div>
        <div className="empty">
          <p style={{ color: "var(--off)" }}>GEMINI_API_KEY is not set.</p>
          <p>
            Add it to <span className="mono">web/.env.local</span> and restart the dev server.
            No <span className="mono">NEXT_PUBLIC_</span> prefix — that would put the key in
            the browser bundle.
          </p>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="head">
        <h1>Ask</h1>
        <p>
          Describe a split, or attach a rotation document. Nothing is saved until you accept
          it.
        </p>
      </div>
      <Ask />
    </>
  );
}
