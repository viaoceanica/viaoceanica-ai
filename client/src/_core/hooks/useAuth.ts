import { useCallback, useEffect, useMemo, useState } from "react";

interface AuthUser {
  id: number;
  name: string;
  email: string;
  platformRole: string;
  companyRole: string;
  companyId?: number;
  companyName?: string;
  createdAt?: string;
  lastSignedIn?: string;
  role?: string; // alias for platformRole for backward compat
  company?: { name: string }; // backward compat
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
      });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const data = await res.json();
      if (data.success && data.data) {
        const u = data.data;
        // Normalize for backward compat with pages that use user.role or user.company.name
        u.role = u.platformRole;
        setUser(u);
      } else {
        setUser(null);
      }
    } catch (err) {
      setUser(null);
      setError(err instanceof Error ? err : new Error("Failed to fetch user"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } finally {
      setUser(null);
    }
  }, []);

  const state = useMemo(() => ({
    user,
    loading,
    error,
    isAuthenticated: Boolean(user),
  }), [user, loading, error]);

  return {
    ...state,
    refresh: fetchMe,
    logout,
  };
}
