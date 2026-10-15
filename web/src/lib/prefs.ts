/** Per-browser view preferences (zoom, filters, collapsed rows). Never data that matters: always has a default. */
export function readPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`kc.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePref(key: string, value: unknown): void {
  try {
    localStorage.setItem(`kc.${key}`, JSON.stringify(value));
  } catch {
    /* private window: ignore */
  }
}
