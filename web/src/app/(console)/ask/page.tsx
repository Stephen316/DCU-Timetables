import { Ask } from "./chat";

/// The key is read per request, not at build: every console route sits under a layout that
/// reads cookies, so nothing here is prerendered. That means setting the variable and
/// redeploying is enough — there is no baked-in copy of this notice to invalidate.
export default function AskPage() {
  if (!process.env.MISTRAL_API_KEY) {
    return (
      <>
        <div className="head"><h1>Ask</h1></div>
        <div className="empty">
          <p style={{ color: "var(--off)" }}>MISTRAL_API_KEY is not set.</p>
          {/* Naming the right environment matters more than it looks. `.env.local` is
              gitignored, so the usual failure is a key that works locally and was never
              added to the host — and a notice that says "restart the dev server" sends you
              looking for a dev server that isn't the thing serving the page. */}
          {process.env.VERCEL ? (
            <p>
              This deployment has no key. Add{" "}
              <span className="mono">MISTRAL_API_KEY</span> to the Vercel project&rsquo;s
              environment variables and redeploy — a running deployment does not pick up new
              variables on its own. It is set in{" "}
              <span className="mono">web/.env.local</span> locally, which is gitignored and
              never reaches the host.
            </p>
          ) : (
            <p>
              Add it to <span className="mono">web/.env.local</span> and restart the dev
              server. No <span className="mono">NEXT_PUBLIC_</span> prefix — that would put
              the key in the browser bundle.
            </p>
          )}
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
