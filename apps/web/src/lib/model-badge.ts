import type { RunEvent } from '@races/contracts';

export interface ModelBadgeInfo {
  modelId: string | null;
  label: string;
  usageLine: string | null;
}

const STARTED = /Agent investigation started \(model ([^,)]+)/;
const USAGE = /Usage: (\d+) model calls(?:, (\d+) input \/ (\d+) output tokens)?/;

export function modelBadgeFromEvents(events: RunEvent[]): ModelBadgeInfo {
  let modelId: string | null = null;
  let usageLine: string | null = null;
  for (const event of events) {
    if (event.kind !== 'run.log') continue;
    const message = event.payload.message;
    if (modelId === null) {
      const started = STARTED.exec(message);
      if (started) modelId = started[1].trim();
    }
    const usage = USAGE.exec(message);
    if (usage) {
      usageLine =
        usage[2] !== undefined && usage[3] !== undefined
          ? `${usage[1]} model calls · ${usage[2]} in / ${usage[3]} out tokens`
          : `${usage[1]} model calls`;
    }
  }
  const label =
    modelId === null
      ? 'Model not recorded'
      : modelId.toLowerCase().includes('muse-spark')
        ? `Muse Spark · ${modelId}`
        : modelId;
  return { modelId, label, usageLine };
}

export function visionNotesFromEvents(events: RunEvent[]): string[] {
  const notes: string[] = [];
  for (const event of events) {
    if (event.kind !== 'run.log') continue;
    const message = event.payload.message;
    if (message.startsWith('Vision (')) notes.push(message);
    else if (message.startsWith('Vision: unavailable')) notes.push(message);
  }
  return notes;
}
