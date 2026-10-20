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

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wasEmpty = false;
    setItems(null);
    setError(null);
    setArrived(false);
    const fetchFirst = () =>
      load()
        .then((page) => {
          if (cancelled) return;
          setItems(page.items);
          setNextCursor(page.nextCursor);
          if (wasEmpty && page.items.length > 0) setArrived(true);
          wasEmpty = page.items.length === 0;
          if (pollMs && wasEmpty) timer = setTimeout(fetchFirst, pollMs);
        })
        .catch((err: HeatError) => !cancelled && setError(err));
    void fetchFirst();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [load, pollMs]);

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

  return { items, error, arrived, hasMore: Boolean(nextCursor), loadingMore, more };
};
