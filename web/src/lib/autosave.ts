import { useEffect, useRef, useState } from 'react';

/**
 * A field that saves itself (from BOQ Maker): local state while typing, commit after `delay` ms idle or on flush (blur).
 * Server updates replace the value only while the user is not mid-edit. `delay` 0 = commit on flush only.
 */
export function useCommittedInput<T extends string>(serverValue: T, commit: (v: T) => void, delay = 600) {
  const [value, setValue] = useState<T>(serverValue);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  latest.current = value;
  useEffect(() => {
    if (!dirty.current) setValue(serverValue);
  }, [serverValue]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flush = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) {
      dirty.current = false;
      commit(latest.current);
    }
  };
  const onChange = (v: T) => {
    dirty.current = true;
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    if (delay > 0) {
      timer.current = setTimeout(() => {
        timer.current = null;
        if (dirty.current) {
          dirty.current = false;
          commit(v);
        }
      }, delay);
    }
  };
  /** Drop local edits and show the server value again (Esc). */
  const reset = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    dirty.current = false;
    setValue(serverValue);
  };
  return { value, onChange, flush, reset, dirty: () => dirty.current };
}
