import { useCallback, useEffect, useState } from "react";
import type { HeatError } from "@m-software-engineering/heat-errors";

type Page<T> = { items: T[]; nextCursor: string | null };

/**
 * Cursor-paged list state for the entry screens (#25). `load` fetches one page; `more` appends the next.
 * With `pollMs`, an empty list is re-fetched until data arrives (the "Waiting for your first event…" check).
 */
export const useListing = <T>(load: (cursor?: string | null) => Promise<Page<T>>, pollMs?: number) => {
  const [items, setItems] = useState<T[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<HeatError | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  // True once a poll finds data after the list was empty: the waiting check turns green.
  const [arrived, setArrived] = useState(false);
  // Bumped by Retry to fetch the first page again.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasEmpty = false;
    setItems(null);
    setError(null);
    setArrived(false);
    // Polling pauses while the tab is hidden and resumes when it is shown again (#29).
    const schedule = () => {
      clearTimeout(timer);
      if (!cancelled && pollMs && wasEmpty && !document.hidden) timer = setTimeout(fetchFirst, pollMs);
    };
    const onVisibility = () => (document.hidden ? clearTimeout(timer) : schedule());
    if (pollMs) document.addEventListener("visibilitychange", onVisibility);
    const fetchFirst = () =>
      load()
        .then((page) => {
          if (cancelled) return;
          setItems(page.items);
          setNextCursor(page.nextCursor);
          if (wasEmpty && page.items.length > 0) setArrived(true);
          wasEmpty = page.items.length === 0;
          schedule();
        })
        .catch((err: HeatError) => !cancelled && setError(err));
    void fetchFirst();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, pollMs, attempt]);

  const more = useCallback(() => {
    if (!nextCursor) return;
    setLoadingMore(true);
    load(nextCursor)
      .then((page) => {
        setItems((current) => [...(current ?? []), ...page.items]);
        setNextCursor(page.nextCursor);
      })
      .catch((err: HeatError) => setError(err))
      .finally(() => setLoadingMore(false));
  }, [load, nextCursor]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { items, error, arrived, retry, hasMore: Boolean(nextCursor), loadingMore, more };
};
