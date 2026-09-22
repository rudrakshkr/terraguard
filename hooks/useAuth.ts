"use client";

import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  display_name: string;
  initials: string;
  avatar_url?: string;
  onboarded: boolean;
  has_location: boolean;
  is_operator: boolean;
}

const TOKEN_KEY = "hillsense-auth-token";
const USER_KEY = "hillsense-auth-user";

function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function readCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthUser>;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.display_name !== "string") return null;
    return {
      id: parsed.id,
      display_name: parsed.display_name,
      initials: typeof parsed.initials === "string" ? parsed.initials : "H",
      ...(typeof parsed.avatar_url === "string" ? { avatar_url: parsed.avatar_url } : {}),
      onboarded: parsed.onboarded === true,
      has_location: parsed.has_location === true,
      is_operator: parsed.is_operator === true,
    };
  } catch {
    return null;
  }
}

/** Shared session store with a simple subscription so all components stay in sync. */
let cachedUser: AuthUser | null = null;
let cachedToken: string | null = null;
let loaded = false;

// Hydrate from localStorage immediately when possible. This is what allows an
// already-authenticated user to keep using the offline queue after a full page
// refresh. The server still remains the source of truth whenever connectivity
// returns.
cachedToken = readToken();
cachedUser = cachedToken ? readCachedUser() : null;
loaded = Boolean(cachedUser);
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function setSession(user: AuthUser | null, token: string | null) {
  cachedUser = user;
  cachedToken = token;
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* private mode */
  }
  loaded = true;
  notify();
}

async function refreshFromServer(): Promise<void> {
  const token = readToken();
  if (!token) {
    cachedUser = null;
    loaded = true;
    notify();
    return;
  }
  try {
    const res = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const data = (await res.json()) as { user: AuthUser };
      cachedUser = data.user;
      cachedToken = token;
      try {
        localStorage.setItem(USER_KEY, JSON.stringify(data.user));
      } catch {
        /* private mode */
      }
    } else {
      setSession(null, null);
      loaded = true;
      return;
    }
  } catch {
    // Offline/network failure is not the same as a signed-out session. Keep
    // the locally cached session so offline reports/comments/confirmations can
    // still be created and queued. A later successful refresh validates it.
    cachedToken = token;
  }
  loaded = true;
  notify();
}

/**
 * Authentication state for client components.
 * `authed` is tri-state: null = still resolving, true/false = resolved.
 */
export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(cachedUser);
  const [state, setState] = useState<"loading" | "authed" | "guest">(
    loaded && cachedUser ? "authed" : loaded ? "guest" : "loading",
  );

  useEffect(() => {
    const listener = () => {
      setUser(cachedUser);
      setState(cachedUser ? "authed" : "guest");
    };
    listeners.add(listener);
    listener();
    if (!loaded) void refreshFromServer();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const signIn = useCallback((user: AuthUser, token: string) => {
    setSession(user, token);
    setState("authed");
    setUser(user);
  }, []);

  const signOut = useCallback(async () => {
    const token = readToken();
    if (token) {
      try {
        await fetch("/api/auth/me", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* best-effort */
      }
    }
    setSession(null, null);
    setState("guest");
    setUser(null);
  }, []);

  const updateProfile = useCallback((user: AuthUser) => {
    setSession(user, cachedToken ?? readToken());
    setUser(user);
    setState("authed");
  }, []);

  return { user, state, authed: state === "authed", loading: state === "loading", signIn, signOut, updateProfile };
}

export function getAuthToken(): string | null {
  // After a full page refresh the module-level cache is empty until the first
  // hook mounts — read localStorage directly so early interactions (confirm,
  // comment) never act as a signed-out user. Cached value wins afterwards.
  if (cachedToken) return cachedToken;
  const fromStorage = readToken();
  if (fromStorage) cachedToken = fromStorage;
  return fromStorage;
}

/** Convenience helper for fetches that require auth. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  // Session was revoked server-side (expired, rotated, or the demo store was
  // reset). Surface a clean auth state instead of leaving stale user data.
  if (res.status === 401 && token) {
    setSession(null, null);
  }
  return res;
}