/// The largest upload Ask accepts. Matches `bodySizeLimit` in next.config.ts: anything
/// larger never reaches the Server Action, so a bigger number here would only be a promise
/// the platform breaks. Shared so the browser can refuse a file the moment it is chosen,
/// rather than after it has been sent.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
