"use client";

import { useCallback, useEffect, useState } from "react";

export interface AuthUser {
  id: string;
  display_name: string;
  initials: string;
  avatar_url?: string;
  onboarded: boolean;
  has_location: boolean;
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

/** Shared session store with a simple subscription so all components stay in sync. */
let cachedUser: AuthUser | null = null;
let cachedToken: string | null = null;
let loaded = false;
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
    } else {
      setSession(null, null);
      loaded = true;
      return;
    }
  } catch {
    cachedUser = null; // network problem — treat as signed out but keep token
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
  if (cachedToken) return cachedToken;
  return readToken();
}

/** Convenience helper for fetches that require auth. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init.headers ?? {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
