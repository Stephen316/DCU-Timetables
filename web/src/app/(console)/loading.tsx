import { Spinner } from "./spinner";

/// Shown the moment a sidebar link is clicked. Every console page is rendered on the server
/// per request, and without this the click did nothing visible until the whole next page
/// arrived — which read as a dead link.
export default function Loading() {
  return <div className="page-loading"><Spinner /> Loading…</div>;
}
