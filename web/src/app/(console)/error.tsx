"use client";

/// What you see when a check fails rather than when you are signed out.
///
/// The distinction is the point. This used to be a redirect to /login, which is a confident
/// claim — "you are not signed in" — made on the basis of a request that merely did not
/// come back. Retrying costs one round-trip; the redirect cost a password.
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
          You are most likely still signed in — this is the console failing to confirm it,
          not the session ending.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="primary" onClick={reset}>Try again</button>
          <a className="btn" href="/login">Sign in again</a>
        </div>
      </div>
    </>
  );
}
