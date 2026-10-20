// Auth gate state: `authed === null` while the session check is in flight,
// false → login screen, true → the app.
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import {
  LOGOUT_EVENT,
  getSession,
  login as apiLogin,
  logout as apiLogout,
} from "../api/client";
import { clearItemsStore, refreshItems } from "./useItems";

interface AuthState {
  authed: boolean | null;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  authed: null,
  login: async () => false,
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getSession().then((ok) => {
      if (!cancelled) setAuthed(ok);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any API 401 (expired cookie, logged out elsewhere) lands here.
  useEffect(() => {
    const onLogout = () => {
      clearItemsStore();
      setAuthed(false);
    };
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout);
  }, []);

  const login = useCallback(async (password: string) => {
    const ok = await apiLogin(password);
    if (ok) {
      setAuthed(true);
      // A new session starts from a fresh list, never the previous one.
      void refreshItems();
    }
    return ok;
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    clearItemsStore();
    setAuthed(false);
  }, []);

  return (
    <AuthContext.Provider value={{ authed, login, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
