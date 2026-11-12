import { useCallback, useEffect, useState } from 'react';
import type { ApiFailure, ApiResult } from '@/lib/api';

interface Settled<T> {
  fetcher: unknown;
  reloads: number;
  data: T | null;
  failure: ApiFailure | null;
}

/**
 * Runs `fetcher` whenever its identity changes (so wrap it in `useCallback` over the inputs) or
 * `reload()` is called, and cancels the request it replaces. A failed request keeps the last good
 * data so a refresh blip does not blank the page. A 401 means the key was revoked since sign-in,
 * so the visitor is signed out instead of shown an error.
 */
export function useApiResource<T>(
  fetcher: (signal: AbortSignal) => Promise<ApiResult<T>>,
  onSignOut: () => void,
) {
  const [reloads, setReloads] = useState(0);
  const [settled, setSettled] = useState<Settled<T>>({
    fetcher: null,
    reloads: -1,
    data: null,
    failure: null,
  });

  useEffect(() => {
    const controller = new AbortController();
    void fetcher(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (!result.ok && result.reason === 'unauthorized') {
        onSignOut();
        return;
      }
      setSettled((previous) => ({
        fetcher,
        reloads,
        data: result.ok ? result.data : previous.data,
        failure: result.ok ? null : result.reason,
      }));
    });
    return () => controller.abort();
  }, [fetcher, reloads, onSignOut]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);
  // Derived, not stored: loading whenever the answer on screen is for an older request.
  const loading = settled.fetcher !== fetcher || settled.reloads !== reloads;
  return { data: settled.data, failure: settled.failure, loading, reload };
}
