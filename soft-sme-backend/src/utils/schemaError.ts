import type { ZodError } from 'zod';

type FlattenedIssues = ReturnType<ZodError<any>['flatten']>;

export const toValidationProblem = <T>(err: ZodError<T>): { error: string; issues: FlattenedIssues } => ({
  error: 'Invalid payload',
  issues: err.flatten(),
});

