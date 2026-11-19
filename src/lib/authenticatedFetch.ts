type TokenUser = { getIdToken: (forceRefresh?: boolean) => Promise<string> };

const RETRY_DELAYS_MS = [400, 1200];
const unreachable = () => new Response(
  JSON.stringify({ error: "Could not reach the server. It may be restarting. Wait a few seconds and try again." }),
  { status: 503, headers: { "Content-Type": "application/json" } },
);

/** A network failure (for example while the server restarts) is retried for read-only requests, then reported as a 503 instead of crashing the page. */
async function send(fetcher: typeof fetch, path: string, init: RequestInit, readOnly: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetcher(path, init);
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (!readOnly || attempt >= RETRY_DELAYS_MS.length) return unreachable();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/** Refresh before requests; only replay read-only requests after an authentication rejection. */
export async function authenticatedFetch(
  path: string,
  init: RequestInit | undefined,
  user: TokenUser | null,
  fallbackToken: string | null,
  actingAsEmail: string | null,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  const token = user ? await user.getIdToken() : fallbackToken;
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");
  if (actingAsEmail) headers.set("X-ATS-Act-As", actingAsEmail);
  else headers.delete("X-ATS-Act-As");
  const method = (init?.method || "GET").toUpperCase();
  const readOnly = method === "GET" || method === "HEAD";
  const response = await send(fetcher, path, { ...init, headers }, readOnly);
  if (response.status !== 401 || !user || (method !== "GET" && method !== "HEAD")) return response;
  const refreshed = await user.getIdToken(true);
  headers.set("Authorization", `Bearer ${refreshed}`);
  return send(fetcher, path, { ...init, headers }, readOnly);
}
