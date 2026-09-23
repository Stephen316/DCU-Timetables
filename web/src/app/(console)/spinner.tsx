/// The console's one loading indicator. Decorative to a screen reader: whatever is loading
/// says so in words next to it.
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
