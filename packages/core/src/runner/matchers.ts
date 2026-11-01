import type { PlanRequestMatcher } from '@races/contracts';

export interface RequestCandidate {
  method: string;
  url: string;
  body: string | null;
}

interface CompiledMatcher {
  def: PlanRequestMatcher;
  regex: RegExp;
  seen: number;
  bound: boolean;
}

/**
 * Binds live requests to logical request IDs from the plan.
 *
 * A candidate matches when method, URL pattern, query/body predicates, and
 * the after-action relationship all hold. The occurrence-th matching request
 * (in start order) binds the logical ID; later matches are ignored. Each
 * candidate binds at most one logical ID (plan order wins).
 *
 * After-action gates on action start, not completion: a click's own fetch
 * reaches the route handler before the click call resolves, so gating on
 * completion would make the action's own effects unmatchable.
 */
export class RequestTracker {
  private readonly compiled: CompiledMatcher[];
  private readonly startedActions = new Set<string>();

  constructor(matchers: PlanRequestMatcher[]) {
    this.compiled = matchers.map((def) => ({
      def,
      regex: new RegExp(def.urlPattern),
      seen: 0,
      bound: false,
    }));
  }

  noteActionStarted(actionId: string): void {
    this.startedActions.add(actionId);
  }

  observe(candidate: RequestCandidate): string | null {
    // Every matching candidate counts toward every unbound matcher first;
    // only then does the first matcher (plan order) whose own occurrence has
    // been reached claim the candidate. Counting after a bind decision would
    // make occurrence plan-order dependent.
    let bindId: string | null = null;
    for (const entry of this.compiled) {
      if (entry.bound) continue;
      if (!this.predicatesMatch(entry, candidate)) continue;
      entry.seen += 1;
      if (bindId === null && entry.seen >= entry.def.occurrence) {
        entry.bound = true;
        bindId = entry.def.id;
      }
    }
    return bindId;
  }

  /** Logical IDs that never bound to a request. */
  unmatched(): string[] {
    return this.compiled.filter((entry) => !entry.bound).map((entry) => entry.def.id);
  }

  isBound(logicalId: string): boolean {
    return this.compiled.some((entry) => entry.def.id === logicalId && entry.bound);
  }

  private predicatesMatch(entry: CompiledMatcher, candidate: RequestCandidate): boolean {
    const def = entry.def;
    if (candidate.method.toUpperCase() !== def.method) return false;
    if (!entry.regex.test(candidate.url)) return false;
    if (def.afterAction !== undefined && !this.startedActions.has(def.afterAction)) {
      return false;
    }
    if (def.query !== undefined) {
      let params: URLSearchParams;
      try {
        params = new URL(candidate.url).searchParams;
      } catch {
        return false;
      }
      for (const [name, substring] of Object.entries(def.query)) {
        if (!(params.get(name) ?? '').includes(substring)) return false;
      }
    }
    if (def.bodyContains !== undefined && !(candidate.body ?? '').includes(def.bodyContains)) {
      return false;
    }
    return true;
  }
}
