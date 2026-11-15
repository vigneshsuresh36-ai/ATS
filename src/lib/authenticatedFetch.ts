type TokenUser = { getIdToken: (forceRefresh?: boolean) => Promise<string> };

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
  const response = await fetcher(path, { ...init, headers });
  const method = (init?.method || "GET").toUpperCase();
  if (response.status !== 401 || !user || (method !== "GET" && method !== "HEAD")) return response;
  const refreshed = await user.getIdToken(true);
  headers.set("Authorization", `Bearer ${refreshed}`);
  return fetcher(path, { ...init, headers });
}
