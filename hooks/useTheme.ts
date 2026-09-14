"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "hillsense-theme";

/** Light is the default for public users; preference persists in localStorage. */
export function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const t = setTimeout(() => {
      const stored = (localStorage.getItem(KEY) as "light" | "dark" | null) ?? "light";
      setTheme(stored);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === "light" ? "dark" : "light")), []);
  return { theme, toggle };
}
