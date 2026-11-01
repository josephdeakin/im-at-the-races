import { describe, expect, it } from 'vitest';
import {
  callCrossed,
  callFinish,
  callHalfway,
  callHold,
  callInquiry,
  callRelease,
  callResultBoard,
  callStretch,
  formFigures,
  formScore,
  lengthsBehind,
  observedRunner,
  ordinal,
  raceDayOffer,
  shortName,
  startingPrices,
} from './raceday';

describe('formFigures', () => {
  it('reads the last three trials, violations first', () => {
    expect(
      formFigures([
        { outcome: 'pass' },
        { outcome: 'violation' },
        { outcome: null },
        { outcome: 'violation' },
      ]),
    ).toBe('1---1');
  });

  it('marks runner errors and empty form', () => {
    expect(formFigures([{ outcome: 'runner-error' }])).toBe('R');
    expect(formFigures([])).toBe('—');
  });
});

describe('formScore and startingPrices', () => {
  it('ranks violations above passes above errors', () => {
    expect(formScore([{ outcome: 'violation' }])).toBeGreaterThan(
      formScore([{ outcome: 'pass' }]),
    );
    expect(formScore([{ outcome: 'pass' }])).toBeGreaterThan(
      formScore([{ outcome: 'runner-error' }]),
    );
  });

  it('gives the best form the shortest odds', () => {
    expect(startingPrices([1, 9, 4])).toEqual(['4/1', '6/4', '5/2']);
  });
});

describe('raceDayOffer', () => {
  it('hides the card when a lone experiment has no feature race', () => {
    expect(raceDayOffer([{ status: 'completed' }], false)).toEqual({
      showCard: false,
      showUndercard: false,
    });
  });

  it('offers the feature race alone for a lone experiment', () => {
    expect(raceDayOffer([{ status: 'completed' }], true)).toEqual({
      showCard: true,
      showUndercard: false,
    });
  });

  it('offers the undercard once two experiments finish', () => {
    expect(
      raceDayOffer([{ status: 'completed' }, { status: 'failed' }], false),
    ).toEqual({ showCard: true, showUndercard: true });
  });

  it('holds the undercard while anything still runs', () => {
    expect(raceDayOffer([{ status: 'completed' }, { status: 'running' }], false)).toEqual({
      showCard: false,
      showUndercard: false,
    });
    expect(raceDayOffer([{ status: 'completed' }, { status: 'running' }], true)).toEqual({
      showCard: true,
      showUndercard: false,
    });
  });
});

describe('racecaller', () => {
  it('scales margins from a nose to lengths', () => {
    expect(lengthsBehind(0.005)).toBe('a nose');
    expect(lengthsBehind(0.05)).toBe('half a length');
    expect(lengthsBehind(0.3)).toBe('3 lengths');
  });

  it('calls the running order and the finish', () => {
    expect(callHalfway(['Alpha', 'Beta'])).toContain('Alpha');
    expect(callStretch(['Alpha', 'Beta'], 0.2)).toContain('lengths');
    expect(callFinish(['Alpha', 'Beta'], false)).toContain('wins it');
    expect(callFinish(['Alpha', 'Beta'], true)).toContain('Photo finish');
  });

  it('handles solo runners', () => {
    expect(callHalfway(['Solo'])).toContain('clear');
    expect(callFinish(['Solo'], false)).toContain('walks it alone');
  });

  it('narrates holds, releases, crossings, and the inquiry', () => {
    expect(callHold('Alpha')).toContain('held');
    expect(callRelease('Alpha', 'Beta')).toContain('after Beta');
    expect(callRelease('Alpha', null)).toContain('finally released');
    expect(callCrossed('Beta', 1)).toContain('1st');
    expect(callResultBoard('Showing results for “alpha”')).toContain('alpha');
    expect(callResultBoard(null)).toContain('under review');
    expect(callInquiry('Alpha')).toContain('wrong horse');
    expect(callInquiry(null)).toContain('controversial');
  });

  it('matches the observed value back to a runner', () => {
    const runners = [{ label: 'Alpha' }, { label: 'Beta' }];
    expect(observedRunner('Showing results for “alpha”', runners)).toBe('Alpha');
    expect(observedRunner('Showing results for “gamma”', runners)).toBeNull();
    expect(observedRunner(null, runners)).toBeNull();
  });
});

describe('labels', () => {
  it('ordinals and truncation', () => {
    expect([ordinal(1), ordinal(2), ordinal(3), ordinal(4)]).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
    ]);
    expect(shortName('x'.repeat(40))).toHaveLength(28);
  });

  it('keeps the distinguishing tail when names share a prefix', () => {
    const labels = [1, 2, 3].map((rep) =>
      shortName(`stale-bank-lost-update (verification rep ${rep})`),
    );
    expect(new Set(labels).size).toBe(3);
    for (const label of labels) expect(label).toHaveLength(28);
    expect(labels[0].endsWith('(verification rep 1)'.slice(-13))).toBe(true);
  });
});
