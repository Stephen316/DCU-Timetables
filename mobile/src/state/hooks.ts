import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AppEvent } from '../data/session';
import { Services } from '../data/services';

export const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices outside ServicesContext');
  return services;
}

/** A saved string that re-renders the view when anything changes it — `@AppStorage`. */
export function usePref(key: string): [string | null, (value: string | null) => void] {
  const { prefs } = useServices();
  const subscribe = useCallback((fn: () => void) => prefs.subscribe(key, fn), [prefs, key]);
  const value = useSyncExternalStore(subscribe, () => prefs.get(key), () => prefs.get(key));
  const set = useCallback((next: string | null) => prefs.set(key, next), [prefs, key]);
  return [value, set];
}

/** A saved JSON value. Re-parsed only when the stored text changes. */
export function usePrefJSON<T>(key: string, fallback: T): [T, (value: T | null) => void] {
  const [raw, setRaw] = usePref(key);
  // Keyed on the text alone, so a new fallback literal each render doesn't re-parse.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => parse(raw, fallback), [raw]);
  const set = useCallback((next: T | null) => setRaw(next === null ? null : JSON.stringify(next)), [setRaw]);
  return [value, set];
}

function parse<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function usePrefBool(key: string): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = usePref(key);
  return [raw === 'true', useCallback((v: boolean) => setRaw(v ? 'true' : null), [setRaw])];
}

/**
 * A view model the screen re-renders from — what `ObservableObject` did. Models call
 * `changed()` after mutating; `useModel` re-renders on each change.
 */
export class Observable {
  private readonly listeners = new Set<() => void>();
  private version = 0;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getVersion = (): number => this.version;

  protected changed(): void {
    this.version++;
    this.listeners.forEach((l) => l());
  }
}

export function useModel<T extends Observable>(model: T): T {
  useSyncExternalStore(model.subscribe, model.getVersion, model.getVersion);
  return model;
}

/** Runs `handler` whenever the app broadcasts `name`. */
export function useAppEvent(name: AppEvent, handler: () => void): void {
  const { events } = useServices();
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => events.on(name, () => latest.current()), [events, name]);
}

/** The current time, ticking once a minute — so "Starts in 20 min" moves on by itself. */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
