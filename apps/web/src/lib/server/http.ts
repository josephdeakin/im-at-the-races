import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@races/contracts';
import { NotFoundError } from '@races/db';

/** Structural subset of a Zod schema: enough to parse without importing zod. */
export interface SafeParser<T> {
  safeParse(data: unknown):
    | { success: true; data: T }
    | { success: false; error: { issues: unknown } };
}

export function ok<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 200 });
}

export function created<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 201 });
}

export function accepted<T>(data: T): NextResponse<T> {
  return NextResponse.json(data, { status: 202 });
}

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): NextResponse {
  return NextResponse.json(apiErrorBody(code, message, details), { status });
}

export function validationError(message: string, issues: unknown): NextResponse {
  return apiError('VALIDATION_ERROR', message, 400, issues);
}

export function notFoundError(message: string): NextResponse {
  return apiError('NOT_FOUND', message, 404);
}

/**
 * Reject cross-origin mutation requests. Browser fetches always send Origin
 * (POST) or Referer; non-browser clients (curl) send neither and are allowed.
 */
export function isSameOriginMutation(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const referer = req.headers.get('referer');
  if (!origin && !referer) return true;
  const host = req.headers.get('host');
  if (!host) return false;
  const expected = `${req.nextUrl.protocol}//${host}`;
  if (origin && origin !== expected) return false;
  if (referer) {
    let parsed: URL;
    try {
      parsed = new URL(referer);
    } catch {
      return false;
    }
    if (`${parsed.protocol}//${parsed.host}` !== expected) return false;
  }
  return true;
}

export async function readJsonBody(req: NextRequest): Promise<{
  ok: boolean;
  value: unknown;
}> {
  try {
    return { ok: true, value: await req.json() };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** Map query-helper errors to the shared error envelope. */
export async function guard(handler: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await handler();
  } catch (err) {
    if (err instanceof NotFoundError) return notFoundError(err.message);
    console.error('[api] unexpected error', err);
    return apiError('INTERNAL_ERROR', 'Unexpected server error', 500);
  }
}
