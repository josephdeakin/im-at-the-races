// A short cavalry galop in E major for the results race: tutti hits, a
// repeated-note trumpet call, a rising answer, and a final sustained E.
// An original homage to Rossini's finale (public domain since 1868), not a
// transcription. All timing in eighth-note steps; the player renders it with
// the Web Audio API so no audio file ships with the app.

export const EIGHTH_SECONDS = 0.21;

export interface FanfareNote {
  /** MIDI pitch: 69 is A4 = 440Hz. */
  midi: number;
  /** Start time in eighth-note steps from the downbeat. */
  at: number;
  /** Length in eighth-note steps. */
  length: number;
  /** Peak gain 0..1. */
  gain: number;
}

export function midiToFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

const E2 = 40;
const B2 = 47;
const E4 = 64;
const GS4 = 68;
const B4 = 71;
const E5 = 76;
const FS5 = 78;
const GS5 = 80;
const A5 = 81;
const B5 = 83;
const CS6 = 85;
const DS6 = 87;
const E6 = 88;

function line(midis: [number, number][], start: number, gain: number): FanfareNote[] {
  const notes: FanfareNote[] = [];
  let at = start;
  for (const [midi, length] of midis) {
    notes.push({ midi, at, length, gain });
    at += length;
  }
  return notes;
}

function chord(midis: number[], at: number, length: number, gain: number): FanfareNote[] {
  return midis.map((midi) => ({ midi, at, length, gain }));
}

function buildTrumpet(): FanfareNote[] {
  return [
    ...line(
      [
        [E5, 2], [E5, 1], [E5, 2], [E5, 1],
        [FS5, 1], [FS5, 1], [GS5, 1], [GS5, 1],
        [A5, 2], [B5, 2],
        [B5, 1], [A5, 1], [GS5, 1], [FS5, 1],
        [E5, 4],
      ],
      4,
      0.32,
    ),
    ...line(
      [
        [E5, 2], [E5, 1], [E5, 2], [E5, 1],
        [GS5, 1], [GS5, 1], [A5, 1], [A5, 1],
        [B5, 2], [CS6, 2],
        [B5, 1], [A5, 1], [GS5, 1], [A5, 1],
        [B5, 4],
      ],
      28,
      0.32,
    ),
    ...line(
      [
        [B5, 1], [CS6, 1], [DS6, 1], [E6, 3],
        [E6, 8],
      ],
      52,
      0.36,
    ),
  ];
}

function buildTutti(): FanfareNote[] {
  const stab = [E4, GS4, B4, E5];
  return [
    ...chord(stab, 0, 2, 0.22),
    ...chord(stab, 2, 2, 0.26),
    ...chord([E4, GS4, B4, E5, E6], 64, 8, 0.24),
  ];
}

function buildBass(): FanfareNote[] {
  const notes: FanfareNote[] = [];
  for (let at = 0; at < 64; at += 2) {
    notes.push({ midi: at % 4 === 0 ? E2 : B2, at, length: 2, gain: 0.2 });
  }
  notes.push({ midi: E2, at: 64, length: 8, gain: 0.22 });
  return notes;
}

export interface FanfareScore {
  trumpet: FanfareNote[];
  tutti: FanfareNote[];
  bass: FanfareNote[];
  /** Total length in eighth-note steps. */
  steps: number;
}

export function buildFanfareScore(): FanfareScore {
  return { trumpet: buildTrumpet(), tutti: buildTutti(), bass: buildBass(), steps: 72 };
}

export function fanfareDurationSeconds(score: FanfareScore): number {
  return score.steps * EIGHTH_SECONDS;
}

export interface FanfareHandle {
  stop: () => void;
  /** Resolves when the piece ends or stop() is called. */
  done: Promise<void>;
}

/** Single starter's bell strike. Silent no-op without Web Audio. */
export function playBell(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return;
  try {
    const ctx = new window.AudioContext();
    const strike = (frequency: number, gainValue: number, delay: number): void => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      const gain = ctx.createGain();
      const start = ctx.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 1);
    };
    strike(880, 0.4, 0);
    strike(1318.5, 0.2, 0.02);
    window.setTimeout(() => void ctx.close(), 1500);
  } catch {
    // A missing bell never breaks the race.
  }
}

/**
 * Play the score on a fresh AudioContext. Call from a user gesture (browser
 * autoplay policy). The context closes itself when the piece ends or stops.
 */
export function playFanfare(): FanfareHandle {
  const score = buildFanfareScore();
  const AudioContextCtor: typeof AudioContext = window.AudioContext;
  const ctx = new AudioContextCtor();
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  let stopped = false;

  const voice = (
    note: FanfareNote,
    type: OscillatorType,
    filterHz: number,
  ): void => {
    const start = ctx.currentTime + note.at * EIGHTH_SECONDS;
    const length = note.length * EIGHTH_SECONDS;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = midiToFrequency(note.midi);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = filterHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.gain, start + 0.02);
    gain.gain.setValueAtTime(note.gain, start + Math.max(0.02, length - 0.05));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + length + 0.05);
  };

  // Gallop kick on every quarter note.
  const kick = (at: number): void => {
    const start = ctx.currentTime + at * EIGHTH_SECONDS;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, start);
    osc.frequency.exponentialRampToValueAtTime(45, start + 0.12);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    osc.connect(gain);
    gain.connect(master);
    osc.start(start);
    osc.stop(start + 0.2);
  };

  for (const note of score.trumpet) voice(note, 'sawtooth', 2400);
  for (const note of score.tutti) voice(note, 'square', 1600);
  for (const note of score.bass) voice(note, 'triangle', 500);
  for (let at = 0; at < score.steps; at += 2) kick(at);

  const durationMs = fanfareDurationSeconds(score) * 1000 + 300;
  const timer = window.setTimeout(finish, durationMs);

  function finish(): void {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    void ctx.close().finally(() => resolveDone());
  }

  return { stop: finish, done };
}
