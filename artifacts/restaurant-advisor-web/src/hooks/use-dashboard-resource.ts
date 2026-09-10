import { useCallback, useEffect, useState } from 'react';
import type { DashboardRequestOptions } from '@/lib/dashboard-api';

export function useDashboardResource<T>(
  load: (options?: DashboardRequestOptions) => Promise<{ data: T }>,
  validate: (value: unknown) => value is T,
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void load({ signal: controller.signal }).then(({ data: result }) => {
      if (!validate(result)) throw new Error('The dashboard returned an unexpected response.');
      if (active) setData(result);
    }).catch((failure: unknown) => {
      if (active) {
        setData(null);
        setError(failure instanceof Error ? failure.message : 'The dashboard request failed.');
      }
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; controller.abort(); };
  }, [load, validate, revision]);
  return { data, loading, error, refresh };
}