import { getAccessToken, setSession } from "./authStore";

let refreshPromise: Promise<boolean> | null = null;

/**
 * Exchanges the httpOnly refresh cookie for a new access token. Deduplicated
 * so concurrent 401s (e.g. several in-flight requests after the token
 * expires) trigger a single refresh instead of a stampede.
 */
export function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then(async (res) => {
        if (!res.ok) {
          setSession(null, null);
          return false;
        }
        const data = await res.json();
        setSession(data.accessToken, data.user);
        return true;
      })
      .catch(() => {
        setSession(null, null);
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

const AUTH_ENDPOINTS = new Set(["/auth/login", "/auth/refresh", "/auth/logout"]);

export async function apiFetch(path: string, init: RequestInit = {}) {
  async function doFetch() {
    const token = getAccessToken();
    const headers = new Headers(init.headers);
    // Fastify's JSON body parser rejects a request that declares this content
    // type but sends no body, so only set it when there actually is one.
    if (init.body !== undefined) headers.set("Content-Type", "application/json");
    if (token) headers.set("Authorization", `Bearer ${token}`);

    return fetch(`/api${path}`, { ...init, headers, credentials: "include" });
  }

  let res = await doFetch();

  // A 401 on an expired-but-still-valid session is recoverable via the
  // refresh cookie - retry once after a successful silent refresh instead of
  // bouncing the user to the login screen every 15 minutes.
  if (res.status === 401 && !AUTH_ENDPOINTS.has(path)) {
    const refreshed = await refreshSession();
    if (refreshed) res = await doFetch();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json();
}
