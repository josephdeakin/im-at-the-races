import {
  DEFAULT_PLAN_TIMEOUTS,
  RUNNER_CAPABILITIES,
  type ExperimentPlan,
} from '@races/contracts';

/**
 * Checked-in scripted experiment for the stale-search fixture. This is
 * plan DATA, not engine logic: the runner discovers everything through the
 * matchers and assertions below. `startUrl` is a placeholder the worker
 * replaces with the project's target URL before validation.
 *
 * Experiment: type "alpha", then "beta". Baseline delivers naturally (final
 * results belong to beta). Intervention holds alpha's response until beta's
 * completes, then delivers alpha — exposing the stale overwrite on the buggy
 * app while the fixed control stays correct.
 */
export const STALE_SEARCH_PLAN_TEMPLATE: Omit<ExperimentPlan, 'startUrl'> & { startUrl: string } =
  {
    schemaVersion: 1,
    id: 'stale-search-v1',
    hypothesis:
      'On the search page, a slow earlier response overwrites the results of a newer query.',
    startUrl: '{{TARGET_URL}}',
    actions: [
      { id: 'a1', kind: 'fill', testId: 'search-input', value: 'alpha' },
      { id: 'a2', kind: 'fill', testId: 'search-input', value: 'beta' },
    ],
    requests: [
      {
        id: 'reqA',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'alpha' },
        occurrence: 1,
        afterAction: 'a1',
      },
      {
        id: 'reqB',
        method: 'GET',
        urlPattern: '/api/search',
        query: { q: 'beta' },
        occurrence: 1,
        afterAction: 'a2',
      },
    ],
    schedule: {
      hold: ['reqA'],
      releases: [{ request: 'reqA', afterResponse: 'reqB', settleMs: 500, timeoutMs: 10_000 }],
    },
    assertions: [
      {
        id: 'final-matches-query',
        description: 'Displayed results belong to the current query (beta).',
        type: 'textContains',
        testId: 'results-for',
        expected: 'beta',
      },
    ],
    timeouts: { ...DEFAULT_PLAN_TIMEOUTS },
    requiredCapabilities: [RUNNER_CAPABILITIES.HTTP_HOLD_RELEASE],
  };
