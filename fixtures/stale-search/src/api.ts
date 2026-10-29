export interface SearchResponse {
  query: string;
  delayMs: number;
  results: string[];
  servedAt: string;
}

export async function searchRequest(
  query: string,
  delayMs: number,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const url = `/api/search?q=${encodeURIComponent(query)}&delay=${encodeURIComponent(String(delayMs))}`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return (await res.json()) as SearchResponse;
}
