/** Client-safe formatting helpers (no server imports). */
import { ApiErrorSchema } from '@races/contracts';

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function formatDurationMs(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.round((minutes / 60) * 10) / 10} h`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function extractApiMessage(body: unknown, fallback: string): string {
  const parsed = ApiErrorSchema.safeParse(body);
  if (parsed.success && parsed.data.error.message.trim() !== '') {
    return parsed.data.error.message;
  }
  return fallback;
}
