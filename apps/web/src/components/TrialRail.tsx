import { Badge, type BadgeVariant } from '@astryxdesign/core/Badge';
import { Text } from '@astryxdesign/core/Text';
import type { Lane, LaneMarker } from '@/lib/timeline';

const TONE_VARIANTS = {
  accent: 'info',
  bad: 'error',
  good: 'success',
  muted: 'neutral',
} as const;

export function toneBadge(tone: string, glyph: string, label: string): React.ReactNode {
  const variant = TONE_VARIANTS[tone as keyof typeof TONE_VARIANTS] ?? 'neutral';
  return <Badge variant={variant} label={label} icon={<span aria-hidden="true">{glyph}</span>} />;
}

const ROW_HEIGHT_PX = 28;
// Row layout: fixed label gutter, fluid time rail, fixed offset column.
// The gutter fits the longest labels ("released ← second-transfer",
// "image: assertion-failed"); dots sit on the shared time scale, offsets
// read as text. No measurement needed: every x is a CSS calc over fixed
// gutters.
const RAIL_START_PX = 216;
const RAIL_END_PX = 64;
const LABEL_WIDTH_PX = 200;
const OFFSET_WIDTH_PX = 56;
const DOT_PX = 10;

function railLeft(frac: number): string {
  const raw = `calc(${RAIL_START_PX}px + ${frac} * (100% - ${RAIL_START_PX + RAIL_END_PX}px))`;
  return `clamp(${RAIL_START_PX + DOT_PX / 2}px, ${raw}, calc(100% - ${RAIL_END_PX + DOT_PX / 2}px))`;
}

export function LaneTrack({
  lane,
  fraction,
  t0,
  fitMax,
  selectedSequence,
  onSelect,
  actionLabel = 'Select event',
}: {
  lane: Lane;
  fraction: (at: number) => number;
  t0: number | null;
  /** Clock window end; later markers pin at the rail end, hollow. Omit to pin nothing. */
  fitMax?: number | null;
  selectedSequence: number | null;
  onSelect: (sequence: number) => void;
  actionLabel?: string;
}) {
  // One marker per row, earliest first: rows always read top to bottom in
  // time order, and markers sharing an instant break ties by sequence.
  const rows = [...lane.markers].sort((a, b) => a.at - b.at || a.sequence - b.sequence);
  return (
    <div
      className="relative rounded-md bg-surface"
      style={{ height: `${Math.max(1, rows.length) * ROW_HEIGHT_PX + 8}px` }}
    >
      {lane.spans.map((span) => (
        <Span
          key={`${span.fromSequence}-${span.toSequence ?? 'end'}`}
          lane={lane}
          rows={rows}
          span={span}
          fraction={fraction}
        />
      ))}
      {rows.map((marker, rowIndex) => {
        const selected = marker.sequence === selectedSequence;
        const pinned = fitMax !== undefined && fitMax !== null && marker.at > fitMax;
        const offset = t0 === null ? null : `+${((marker.at - t0) / 1000).toFixed(1)}s`;
        return (
          <button
            key={marker.sequence}
            type="button"
            title={offset === null ? `#${marker.sequence} ${marker.label}` : `#${marker.sequence} ${marker.label} (${offset})`}
            aria-label={`${actionLabel} #${marker.sequence}: ${marker.label}`}
            aria-current={selected}
            onClick={() => onSelect(marker.sequence)}
            style={{ top: `${4 + rowIndex * ROW_HEIGHT_PX}px`, height: `${ROW_HEIGHT_PX}px` }}
            className={`absolute inset-x-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 ${
              selected ? 'ring-2 ring-offset-1' : ''
            }`}
          >
            <span
              className="absolute top-1/2 block -translate-y-1/2 text-left"
              style={{ left: '8px', width: `${LABEL_WIDTH_PX}px` }}
            >
              {toneBadge(marker.tone, marker.glyph, marker.label)}
            </span>
            <span
              aria-hidden="true"
              className="absolute top-1/2 h-px -translate-y-1/2 bg-neutral-500/30"
              style={{ left: `${RAIL_START_PX}px`, right: `${RAIL_END_PX}px` }}
            />
            <span
              aria-hidden="true"
              data-dot={marker.sequence}
              data-pinned={pinned || undefined}
              className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${
                pinned ? 'border-2 border-neutral-400 bg-transparent' : 'bg-neutral-400'
              } ${selected ? 'ring-2 ring-offset-1' : ''}`}
              style={{ left: railLeft(fraction(marker.at)) }}
            />
            {offset !== null && (
              <Text
                type="supporting"
                className="absolute top-1/2 block -translate-y-1/2 text-right tabular-nums"
                data-offset={marker.sequence}
                style={{ right: '8px', width: `${OFFSET_WIDTH_PX}px` }}
              >
                {offset}
              </Text>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Span({
  lane,
  rows,
  span,
  fraction,
}: {
  lane: Lane;
  rows: LaneMarker[];
  span: { fromSequence: number; toSequence: number | null; label: string };
  fraction: (at: number) => number;
}) {
  const fromMarker = lane.markers.find((m) => m.sequence === span.fromSequence);
  const toMarker =
    span.toSequence === null ? null : lane.markers.find((m) => m.sequence === span.toSequence);
  if (!fromMarker) return null;
  const fromRow = rows.findIndex((m) => m.sequence === span.fromSequence);
  const toRow =
    span.toSequence === null
      ? rows.length - 1
      : Math.max(
          fromRow,
          rows.findIndex((m) => m.sequence === span.toSequence),
        );
  const fromFrac = fraction(fromMarker.at);
  const toFrac = toMarker ? fraction(toMarker.at) : 1;
  // Thin interval bar across the held rows: the response was captured but
  // withheld from the page for this stretch.
  const firstRow = Math.max(0, fromRow);
  const lastRow = Math.max(toRow, fromRow);
  const centerY = 4 + ((firstRow + lastRow) / 2) * ROW_HEIGHT_PX + ROW_HEIGHT_PX / 2;
  return (
    <div
      aria-hidden="true"
      title={span.label}
      style={{
        left: railLeft(fromFrac),
        width: `max(3px, calc(${Math.max(0, toFrac - fromFrac)} * (100% - ${RAIL_START_PX + RAIL_END_PX}px)))`,
        top: `${centerY - 2.5}px`,
        height: '5px',
      }}
      className="rounded-full bg-info opacity-60 absolute"
    />
  );
}
