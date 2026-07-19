import { useSyncExternalStore } from "react";

export interface AuthUser {
  id: string;
  email: string;
  role: "ADMIN" | "VIEWER";
}

interface AuthState {
  accessToken: string | null;
  user: AuthUser | null;
}

let state: AuthState = { accessToken: null, user: null };
const listeners = new Set<() => void>();

function setState(next: Partial<AuthState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSession(token: string | null, user: AuthUser | null) {
  setState({ accessToken: token, user });
}

export function setAccessToken(token: string | null) {
  setState({ accessToken: token });
}

export function getAccessToken() {
  return state.accessToken;
}

export function useAuthStore<T>(selector: (s: AuthState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
