import { computeConfirmationVerdict, type ConfirmationVerdict } from '@races/contracts';
import type { StoredTrial } from '../runner/experiment.js';

/** The FI02 verdict (contracts owns the single implementation). */
export type ReproduceVerdict = ConfirmationVerdict;

export function computeReproduced(trials: StoredTrial[]): ReproduceVerdict {
  return computeConfirmationVerdict(trials);
}
