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
  'ASSIGNED',
  'SUBMITTED',
  'VERIFYING',
  'READY_FOR_REVIEW',
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
  reviewPlan: z.enum(['STANDARD', 'SECURITY']).default('STANDARD'),
  deadline: z.string().datetime(),
  criteria: z.array(criterionSchema).min(1).max(20)
}).superRefine((value, context) => {
  const deadline = new Date(value.deadline).getTime();
  if (deadline < Date.now() + 3_600_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deadline'], message: 'Deadline must be at least 1 hour from now' });
  }
  if (deadline > Date.now() + 7 * 24 * 3_600_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['deadline'], message: 'Deadline must be within the next 7 days' });
  }
});

export const submitWorkSchema = z.object({
  pullRequestUrl: z.string().url().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+\/?$/),
  developerAddress: addressSchema,
  submissionTxHash: bytes32Schema.optional()
});

export const applicationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN']);

export const createApplicationSchema = z.object({
  message: z.string().trim().min(20).max(600),
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
  commitSha: z.string().regex(/^[a-fA-F0-9]{40}$/).optional()
});

export type Criterion = z.infer<typeof criterionSchema>;
export type BountyStatus = z.infer<typeof bountyStatusSchema>;
export type CreateBountyInput = z.infer<typeof createBountySchema>;
export type SubmitWorkInput = z.infer<typeof submitWorkSchema>;
export type VerificationInput = z.infer<typeof verificationInputSchema>;
export type ApplicationStatus = z.infer<typeof applicationStatusSchema>;
export type CreateApplicationInput = z.infer<typeof createApplicationSchema>;
export type ReviewPlan = CreateBountyInput['reviewPlan'];
export type ReviewPaymentStatus = 'REQUIRED' | 'PAID' | 'CONSUMED';

export interface BountyApplication {
  id: string;
  bountyId: string;
  developerUserId: string;
  developerGithubLogin: string;
  developerGithubAvatarUrl: string | null;
  developerAddress: string;
  message: string;
  status: ApplicationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Submission {
  pullRequestUrl: string;
  developerAddress: string;
  developerUserId?: string;
  commitSha: string;
  submissionHash: string;
  submissionTxHash?: string;
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
  payoutTxHash?: string;
  assignedDeveloperUserId?: string;
  assignedDeveloperGithubLogin?: string;
  assignedDeveloperAddress?: string;
  assignedAt?: string;
  assignmentTxHash?: string;
  applicantCount: number;
  reviewPrice: string;
  reviewPaymentStatus: ReviewPaymentStatus;
  reviewPaymentTxHash?: string;
  reviewPaidAt?: string;
  reviewConsumedAt?: string;
  submission?: Submission;
  decision?: AgentDecision;
}
