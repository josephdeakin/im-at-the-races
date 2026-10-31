import { z } from 'zod';

export const API_ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  ORIGIN_FORBIDDEN: 'ORIGIN_FORBIDDEN',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export const ApiErrorCodeSchema = z.enum(API_ERROR_CODES);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string().min(1),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorBody = z.infer<typeof ApiErrorSchema>;

/** Validation failure details carried on 400 responses. */
export type ZodIssueList = z.core.$ZodIssue[];

export function apiErrorBody(
  code: ApiErrorCode,
  message: string,
  details?: ZodIssueList | null,
): ApiErrorBody {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}
