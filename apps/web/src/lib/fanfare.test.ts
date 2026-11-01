import { describe, expect, it } from 'vitest';
import {
  buildFanfareScore,
  fanfareDurationSeconds,
  midiToFrequency,
  playBell,
} from './fanfare';

describe('midiToFrequency', () => {
  it('maps A4 to 440Hz', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 5);
  });

  it('rises an octave every 12 semitones', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 5);
  });
});

describe('buildFanfareScore', () => {
  it('keeps every note inside the score with sane pitch and gain', () => {
    const score = buildFanfareScore();
    const notes = [...score.trumpet, ...score.tutti, ...score.bass];
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) {
      expect(note.midi).toBeGreaterThanOrEqual(20);
      expect(note.midi).toBeLessThanOrEqual(100);
      expect(note.length).toBeGreaterThan(0);
      expect(note.at + note.length).toBeLessThanOrEqual(score.steps);
      expect(note.gain).toBeGreaterThan(0);
      expect(note.gain).toBeLessThanOrEqual(1);
    }
  });

  it('runs about fifteen seconds', () => {
    const seconds = fanfareDurationSeconds(buildFanfareScore());
    expect(seconds).toBeGreaterThan(10);
    expect(seconds).toBeLessThan(25);
  });

  it('bell is a silent no-op without Web Audio', () => {
    expect(() => playBell()).not.toThrow();
  });
});
