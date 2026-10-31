import { z } from 'zod';
import { ExperimentPlanSchema } from './plans.js';

/**
 * Agent tool-call contract. Every model tool call is validated with one
 * of these schemas before execution; validation failures return actionable
 * errors to the model and consume a bounded retry allowance.
 */

const RepoPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(1000)
  .refine((value) => !value.includes('..') && !value.startsWith('/'), {
    message: 'path must be relative to the repository root without parent traversal',
  });

export const ListFilesArgsSchema = z.object({
  /** Directory relative to the repo root; defaults to the root. */
  path: RepoPathSchema.optional().default('.'),
  /** Optional substring filter on file paths. */
  pattern: z.string().trim().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(200).optional().default(100),
});

export const SearchCodeArgsSchema = z.object({
  /** Literal substring (not a regex) to find in text files. */
  query: z.string().trim().min(1).max(500),
  path: RepoPathSchema.optional().default('.'),
  limit: z.number().int().min(1).max(50).optional().default(30),
});

export const ReadFileArgsSchema = z.object({
  path: RepoPathSchema,
  /** 1-based first line; defaults to 1. */
  offset: z.number().int().min(1).max(1_000_000).optional().default(1),
  /** Max lines to return; defaults to 80, capped at 300. */
  limit: z.number().int().min(1).max(300).optional().default(80),
});

export const ObservePageArgsSchema = z.object({
  /** Defaults to the project target URL. Must stay within permitted origins. */
  url: z.string().trim().min(1).max(2000).optional(),
});

export const ActArgsSchema = z
  .object({
    kind: z.enum(['fill', 'click']),
    testId: z.string().trim().min(1).max(300),
    /** Required for fill; forbidden for click. */
    value: z.string().max(2000).optional(),
  })
  .superRefine((args, ctx) => {
    if (args.kind === 'fill' && args.value === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'fill requires a value' });
    }
    if (args.kind === 'click' && args.value !== undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'click must not carry a value' });
    }
  });

export const ReadEvidenceArgsSchema = z.object({
  /** Artifact ID from an earlier observation or trial. */
  artifactId: z.string().trim().min(1).max(100),
});

const ExploreExperimentSchema = z.object({
  mode: z.literal('explore').optional().default('explore'),
  /** Full experiment plan. startUrl should be the project target URL. */
  plan: ExperimentPlanSchema,
});

const ConfirmExperimentSchema = z.object({
  mode: z.literal('confirm'),
  /** Experiment ID from an earlier explore result. */
  experimentId: z.string().trim().min(1).max(100),
  /** Confirmation pairs to run; 3 unless the orchestrator says otherwise. */
  attempts: z.number().int().min(1).max(3).optional().default(3),
});

export const RunExperimentArgsSchema = z.union([ExploreExperimentSchema, ConfirmExperimentSchema]);

export const CoverageRecordSchema = z.object({
  pagesVisited: z.array(z.string().trim().min(1).max(2000)).max(50).optional().default([]),
  workflowsTested: z.array(z.string().trim().min(1).max(500)).max(50).optional().default([]),
  experimentsRun: z.number().int().min(0).max(1000),
});

export const FindingDraftSchema = z.object({
  experimentId: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(500),
  /**
   * Why the expectation is justified: user requirement, source behaviour,
   * existing test, observed normal behaviour, or inference (say which).
   */
  expectationProvenance: z.string().trim().min(1).max(2000),
  explanation: z.string().trim().min(1).max(4000),
  implicatedCode: z
    .array(
      z.object({
        path: RepoPathSchema,
        excerpt: z.string().max(2000).optional(),
      }),
    )
    .max(10)
    .optional()
    .default([]),
});

export const FinishArgsSchema = z.object({
  summary: z.string().trim().min(1).max(4000),
  coverage: CoverageRecordSchema,
  unresolvedSuspicions: z.array(z.string().trim().min(1).max(1000)).max(20).optional().default([]),
  limitations: z.array(z.string().trim().min(1).max(1000)).max(20).optional().default([]),
  findings: z.array(FindingDraftSchema).max(10).optional().default([]),
});

export type ListFilesArgs = z.infer<typeof ListFilesArgsSchema>;
export type SearchCodeArgs = z.infer<typeof SearchCodeArgsSchema>;
export type ReadFileArgs = z.infer<typeof ReadFileArgsSchema>;
export type ObservePageArgs = z.infer<typeof ObservePageArgsSchema>;
export type ActArgs = z.infer<typeof ActArgsSchema>;
export type ReadEvidenceArgs = z.infer<typeof ReadEvidenceArgsSchema>;
export type RunExperimentArgs = z.infer<typeof RunExperimentArgsSchema>;

export const EditFileArgsSchema = z.object({
  path: RepoPathSchema,
  /** Exact text to find; must occur exactly once in the file. */
  find: z.string().min(1).max(20_000),
  replace: z.string().max(20_000),
});

export const RunCheckArgsSchema = z.object({
  name: z.enum(['build', 'typecheck', 'test']),
});

export const FinishRepairArgsSchema = z.object({
  summary: z.string().trim().min(1).max(2000),
  changedFiles: z.array(z.string().trim().min(1).max(500)).max(50),
});

export type EditFileArgs = z.infer<typeof EditFileArgsSchema>;
export type RunCheckArgs = z.infer<typeof RunCheckArgsSchema>;
export type FinishRepairArgs = z.infer<typeof FinishRepairArgsSchema>;
export type CoverageRecord = z.infer<typeof CoverageRecordSchema>;
export type FindingDraft = z.infer<typeof FindingDraftSchema>;
export type FinishArgs = z.infer<typeof FinishArgsSchema>;

export const AGENT_TOOL_NAMES = [
  'listFiles',
  'searchCode',
  'readFile',
  'observePage',
  'act',
  'readEvidence',
  'runExperiment',
  'finish',
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

export const FindingStatusSchema = z.enum(['candidate', 'reproduced']);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  experimentId: z.string().min(1),
  title: z.string().min(1),
  status: FindingStatusSchema,
  expectationProvenance: z.string(),
  explanation: z.string(),
  implicatedCode: z.array(
    z.object({
      path: z.string(),
      excerpt: z.string().nullable(),
      exists: z.boolean(),
    }),
  ),
  sourceIdentity: z.string(),
  createdAt: z.string().min(1),
});

export type Finding = z.infer<typeof FindingSchema>;
