import { z } from 'zod';

export const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid EVM address');
export const bytes32Schema = z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid bytes32 value');

export const criterionSchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string().min(3).max(500),
  mandatory: z.boolean().default(true),
  method: z.enum(['github', 'ci', 'static-analysis', 'manual']).default('github')
});

export const bountyStatusSchema = z.enum([
  'DRAFT',
  'OPEN',
  'SUBMITTED',
  'VERIFYING',
  'REVISION_REQUIRED',
  'HUMAN_REVIEW',
  'APPROVED',
  'PAID',
  'EXPIRED',
  'REFUNDED',
  'CANCELLED'
]);

export const createBountySchema = z.object({
  title: z.string().min(5).max(120),
  description: z.string().min(10).max(4000),
  repositoryUrl: z.string().url().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/),
  ownerAddress: addressSchema,
  rewardAmount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  verificationBudget: z.string().regex(/^\d+(\.\d{1,6})?$/),
  deadline: z.string().datetime(),
  criteria: z.array(criterionSchema).min(1).max(20)
}).superRefine((value, context) => {
  if (new Date(value.deadline).getTime() <= Date.now()) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deadline'], message: 'Deadline must be in the future' });
  }
});

export const submitWorkSchema = z.object({
  pullRequestUrl: z.string().url().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/),
  developerAddress: addressSchema
});

export const criterionResultSchema = z.object({
  criterionId: z.string(),
  status: z.enum(['PASSED', 'FAILED', 'UNKNOWN']),
  evidence: z.array(z.string()).max(20),
  summary: z.string().max(1000)
});

export const verificationInputSchema = z.object({
  confidence: z.number().min(0).max(1),
  criterionResults: z.array(criterionResultSchema),
  blockingIssues: z.array(z.string()).max(20).default([]),
  paidVerification: z.object({
    provider: z.string(),
    commitSha: z.string().regex(/^[a-fA-F0-9]{40}$/),
    reportHash: bytes32Schema,
    price: z.string().regex(/^\d+(\.\d{1,6})?$/)
  }).optional()
});

export type Criterion = z.infer<typeof criterionSchema>;
export type BountyStatus = z.infer<typeof bountyStatusSchema>;
export type CreateBountyInput = z.infer<typeof createBountySchema>;
export type SubmitWorkInput = z.infer<typeof submitWorkSchema>;
export type VerificationInput = z.infer<typeof verificationInputSchema>;

export interface Submission {
  pullRequestUrl: string;
  developerAddress: string;
  developerUserId?: string;
  commitSha: string;
  submittedAt: string;
}

export interface AgentDecision {
  decision: 'APPROVE' | 'REVISION_REQUIRED' | 'HUMAN_REVIEW';
  confidence: number;
  summary: string;
  blockingIssues: string[];
  criterionResults: z.infer<typeof criterionResultSchema>[];
  decidedAt: string;
}

export interface Bounty extends CreateBountyInput {
  id: string;
  ownerUserId?: string;
  status: BountyStatus;
  createdAt: string;
  onchainId?: string;
  fundingTxHash?: string;
  submission?: Submission;
  decision?: AgentDecision;
}
