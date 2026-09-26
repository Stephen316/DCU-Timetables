/**
 * A random (version 4) UUID. `crypto.randomUUID` where the engine has it; otherwise built
 * from `Math.random`, which is enough for ids whose only job is to be distinct.
 */
export function uuid(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof native === 'function') return native.call((globalThis as { crypto?: object }).crypto);
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
