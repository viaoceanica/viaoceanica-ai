/**
 * useApi — lightweight data-fetching hooks that mirror tRPC's useQuery / useMutation
 * interface but call the platform-core REST API through the gateway.
 *
 * Gateway routing:
 *   /api/auth/*      → platform-core /api/auth/*
 *   /api/platform/*  → platform-core /api/v1/*
 *
 * Every request includes `credentials: "include"` so the session cookie is sent.
 */

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Helpers ────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
    ...init,
  });
  if (!res.ok) {
    let msg = "Erro inesperado";
    try {
      const json = await res.json();
      msg = json?.error?.message || json?.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const json = await res.json();
  if (json.success === false) {
    throw new Error(json?.error?.message || "Erro inesperado");
  }
  // platform-core wraps data in { success: true, data: ... }
  return json.data !== undefined ? json.data : json;
}

// ─── useQuery ───────────────────────────────────────────────────────

interface UseQueryOptions {
  enabled?: boolean;
}

interface UseQueryResult<T> {
  data: T | undefined;
  isLoading: boolean;
  error: Error | null;
  refetch: () => Promise<{ data: T | undefined }>;
}

export function useQuery<T>(path: string | null, opts?: UseQueryOptions): UseQueryResult<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const enabled = opts?.enabled !== false && path !== null;
  const pathRef = useRef(path);
  pathRef.current = path;

  const fetchData = useCallback(async () => {
    if (!pathRef.current) return { data: undefined };
    setIsLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(pathRef.current);
      setData(result);
      return { data: result };
    } catch (e: any) {
      setError(e);
      return { data: undefined };
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      fetchData();
    } else {
      setIsLoading(false);
    }
  }, [enabled, path]);

  return { data, isLoading, error, refetch: fetchData };
}

// ─── useMutation ────────────────────────────────────────────────────

interface UseMutationOptions<TData> {
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
}

interface UseMutationResult<TInput, TData> {
  mutateAsync: (input: TInput) => Promise<TData>;
  isPending: boolean;
  error: Error | null;
}

export function useMutation<TInput = any, TData = any>(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "POST",
  opts?: UseMutationOptions<TData>
): UseMutationResult<TInput, TData> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(
    async (input: TInput): Promise<TData> => {
      setIsPending(true);
      setError(null);
      try {
        const result = await apiFetch<TData>(path, {
          method,
          body: JSON.stringify(input),
        });
        opts?.onSuccess?.(result);
        return result;
      } catch (e: any) {
        setError(e);
        opts?.onError?.(e);
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [path, method]
  );

  return { mutateAsync, isPending, error };
}

/**
 * useDynamicMutation — like useMutation but the path is determined at call time.
 * Useful when the URL contains a dynamic parameter (e.g. moduleKey, userId).
 */
export function useDynamicMutation<TData = any>(
  method: "POST" | "PUT" | "PATCH" | "DELETE" = "PUT",
  opts?: UseMutationOptions<TData>
): { mutateAsync: (path: string, input?: any) => Promise<TData>; isPending: boolean; error: Error | null } {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const mutateAsync = useCallback(
    async (path: string, input?: any): Promise<TData> => {
      setIsPending(true);
      setError(null);
      try {
        const result = await apiFetch<TData>(path, {
          method,
          body: input !== undefined ? JSON.stringify(input) : undefined,
        });
        opts?.onSuccess?.(result);
        return result;
      } catch (e: any) {
        setError(e);
        opts?.onError?.(e);
        throw e;
      } finally {
        setIsPending(false);
      }
    },
    [method]
  );

  return { mutateAsync, isPending, error };
}

// ─── Convenience: raw fetch for one-off calls ───────────────────────

export { apiFetch };
