/**
 * Obvious-pattern secret redaction for persisted evidence: a deliberately
 * narrow safety net (known secret query keys, credential schemes), not a
 * general secret detector. Anything outside these patterns is kept verbatim
 * so evidence stays inspectable.
 */

const SECRET_QUERY_KEYS = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'api_key',
  'apikey',
  'api-key',
  'secret',
  'client_secret',
  'password',
  'passwd',
  'auth',
  'authorization',
  'session',
  'sessionid',
  'sid',
]);

const REDACTED = '[redacted]';

/** Replace values of known secret query params, preserving the rest of the URL. */
export function redactUrl(raw: string): string {
  const queryIndex = raw.indexOf('?');
  if (queryIndex === -1) return raw;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw.slice(queryIndex + 1));
  } catch {
    return raw;
  }
  let changed = false;
  for (const key of [...new Set(params.keys())]) {
    if (SECRET_QUERY_KEYS.has(key.toLowerCase())) {
      params.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? `${raw.slice(0, queryIndex + 1)}${params.toString()}` : raw;
}

/** Mask bearer/basic credentials and obvious secret values in captured text. */
export function redactExcerpt(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/=]+/gi, `$1${REDACTED}`)
    .replace(/(Basic\s+)[A-Za-z0-9+/=]+/gi, `$1${REDACTED}`)
    .replace(
      /("(?:api_?key|apikey|token|secret|password)"\s*:\s*")[^"]+"/gi,
      `$1${REDACTED}"`,
    );
}
