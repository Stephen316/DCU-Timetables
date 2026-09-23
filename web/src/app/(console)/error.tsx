"use client";

/// What you see when a check fails rather than when you are signed out.
///
/// The distinction is the point. This used to be a redirect to the sign-in page, which is a
/// confident claim — "you are not signed in" — made on the basis of a request that merely
/// did not come back. Retrying costs one round-trip; the redirect cost a code entry, and
/// with a per-network limit on codes, a wasted one.
export default function ConsoleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <div className="head"><h1>Something went wrong</h1></div>
      <div className="empty">
        <p style={{ color: "var(--off)" }}>{error.message}</p>
        <p>
          The console is most likely still open — this is it failing to confirm that, not
          the session ending.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" onClick={reset}>Try again</button>
          <a className="btn" href="/unlock">Enter the code again</a>
        </div>
      </div>
    </>
  );
}
