import { describe, expect, it, vi } from 'vitest';
import type { PullRequestReviewEvidence } from '../src/application/ports.js';
import { OpenAIReviewAgent } from '../src/infrastructure/openai-review-agent.js';

const commitSha = 'a'.repeat(40);

describe('OpenAIReviewAgent', () => {
  it('uses Responses structured output and keeps deterministic CI evidence authoritative', async () => {
    const parse = vi.fn(async (request: Record<string, unknown>) => {
      void request;
      return { output_parsed: {
        confidence: 0.95,
        taskAssessment: {
          status: 'FULLY_MET' as const,
          score: 96,
          evidence: ['file:src/app.ts'],
          summary: 'The requested protected endpoint is present in the patch.'
        },
        criterionResults: [
          { criterionId: 'implementation', status: 'PASSED' as const, evidence: ['file:src/app.ts'], summary: 'The endpoint is implemented.' },
          { criterionId: 'tests', status: 'FAILED' as const, evidence: ['file:src/app.ts'], summary: 'Model output must not override CI.' }
        ],
        findings: [{ severity: 'HIGH' as const, evidence: ['file:src/app.ts'], summary: 'Missing authorization check.' }]
      } };
    });
    const agent = new OpenAIReviewAgent(
      { apiKey: 'test-key', model: 'gpt-5-nano', maxDiffCharacters: 60_000 },
      { parse }
    );

    const result = await agent.review({
      evidence: reviewEvidence(),
      criteria: [
        { id: 'implementation', description: 'Endpoint is implemented', mandatory: true, method: 'github' },
        { id: 'tests', description: 'Tests pass', mandatory: true, method: 'ci' }
      ],
      plan: 'SECURITY',
      context: { bountyTitle: 'Implement endpoint', bountyDescription: 'Add a protected endpoint.', safetyIdentifier: 'owner-1' }
    });

    expect(result).toMatchObject({ commitSha, confidence: 0.95 });
    expect(result.taskAssessment).toMatchObject({ status: 'FULLY_MET', score: 96, evidence: ['file:src/app.ts'] });
    expect(result.criterionResults).toEqual([
      expect.objectContaining({ criterionId: 'implementation', status: 'PASSED', evidence: ['file:src/app.ts'] }),
      expect.objectContaining({ criterionId: 'tests', status: 'PASSED', evidence: ['check:unit-tests:success'] })
    ]);
    expect(result.blockingIssues).toContain('HIGH: Missing authorization check. (file:src/app.ts)');
    expect(parse).toHaveBeenCalledOnce();
    expect(parse.mock.calls[0]?.[0]).toMatchObject({
      model: 'gpt-5-nano',
      store: false,
      reasoning: { effort: 'low' },
      safety_identifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      text: { format: expect.objectContaining({ type: 'json_schema' }) }
    });
  });

  it('downgrades unsupported or truncated model passes to human-review evidence', async () => {
    const agent = new OpenAIReviewAgent(
      { apiKey: 'test-key', model: 'gpt-5-nano', maxDiffCharacters: 1_000 },
      {
        async parse() {
          return {
            output_parsed: {
              confidence: 0.99,
              taskAssessment: {
                status: 'FULLY_MET' as const,
                score: 99,
                evidence: ['file:not-in-the-pull-request.ts'],
                summary: 'Unsupported task assessment.'
              },
              criterionResults: [{
                criterionId: 'implementation',
                status: 'PASSED' as const,
                evidence: ['file:not-in-the-pull-request.ts'],
                summary: 'Unsupported pass.'
              }],
              findings: []
            }
          };
        }
      }
    );
    const evidence = reviewEvidence();
    evidence.diffTruncated = true;

    const result = await agent.review({
      evidence,
      criteria: [{ id: 'implementation', description: 'Endpoint is implemented', mandatory: true, method: 'github' }],
      plan: 'STANDARD',
      context: { bountyTitle: 'Implement endpoint', bountyDescription: 'Add an endpoint.', safetyIdentifier: 'owner-1' }
    });

    expect(result.confidence).toBe(0.82);
    expect(result.taskAssessment).toMatchObject({ status: 'UNKNOWN', score: 59, evidence: [] });
    expect(result.criterionResults[0]).toMatchObject({ status: 'UNKNOWN', evidence: [] });
  });

  it('keeps the task score independent when required CI evidence is missing', async () => {
    const evidence = reviewEvidence();
    evidence.files = [{
      filename: 'README.md',
      status: 'modified',
      additions: 2,
      deletions: 0,
      changes: 2,
      patch: '@@ -1,2 +1,4 @@\n # OwlPay\n+Hi world,\n+It\'s OwlPay time!'
    }];
    evidence.checks = [];

    const agent = new OpenAIReviewAgent(
      { apiKey: 'test-key', model: 'gpt-5-nano', maxDiffCharacters: 60_000 },
      {
        async parse() {
          return {
            output_parsed: {
              confidence: 0.96,
              taskAssessment: {
                status: 'FULLY_MET' as const,
                score: 94,
                evidence: ['file:README.md'],
                summary: 'Both requested lines are directly present in README.md.'
              },
              criterionResults: [],
              findings: []
            }
          };
        }
      }
    );

    const result = await agent.review({
      evidence,
      criteria: [{ id: 'tests', description: 'Existing tests must pass', mandatory: true, method: 'ci' }],
      plan: 'STANDARD',
      context: {
        bountyTitle: 'Add 2 lines into Readme',
        bountyDescription: 'Add 2 lines into Readme "Hi world, It\'s OwlPay time!"',
        safetyIdentifier: 'owner-1'
      }
    });

    expect(result.taskAssessment).toMatchObject({ status: 'FULLY_MET', score: 94, evidence: ['file:README.md'] });
    expect(result.criterionResults[0]).toMatchObject({ criterionId: 'tests', status: 'UNKNOWN' });
    expect(result.confidence).toBe(0.82);
  });

  it('does not penalize confidence when the bounty does not require CI', async () => {
    const evidence = reviewEvidence();
    evidence.checks = [];

    const agent = new OpenAIReviewAgent(
      { apiKey: 'test-key', model: 'gpt-5-nano', maxDiffCharacters: 60_000 },
      {
        async parse() {
          return {
            output_parsed: {
              confidence: 0.96,
              taskAssessment: {
                status: 'FULLY_MET' as const,
                score: 94,
                evidence: ['file:src/app.ts'],
                summary: 'The requested change is directly present in the patch.'
              },
              criterionResults: [{
                criterionId: 'implementation',
                status: 'PASSED' as const,
                evidence: ['file:src/app.ts'],
                summary: 'The requested implementation is present.'
              }],
              findings: []
            }
          };
        }
      }
    );

    const result = await agent.review({
      evidence,
      criteria: [{ id: 'implementation', description: 'The pull request fulfills the requested bounty changes', mandatory: true, method: 'github' }],
      plan: 'STANDARD',
      context: { bountyTitle: 'Implement endpoint', bountyDescription: 'Add an endpoint.', safetyIdentifier: 'owner-1' }
    });

    expect(result.confidence).toBe(0.96);
    expect(result.taskAssessment?.score).toBe(94);
    expect(result.criterionResults[0]?.status).toBe('PASSED');
  });
});

function reviewEvidence(): PullRequestReviewEvidence {
  return {
    pullRequest: {
      repositoryUrl: 'https://github.com/owlpay/demo',
      pullRequestUrl: 'https://github.com/owlpay/demo/pull/42',
      number: 42,
      state: 'open',
      merged: false,
      headSha: commitSha,
      changedFiles: 1,
      additions: 12,
      deletions: 2,
      authorId: 7,
      author: 'developer',
      title: 'Implement endpoint',
      body: 'Adds the endpoint.'
    },
    files: [{
      filename: 'src/app.ts',
      status: 'modified',
      additions: 12,
      deletions: 2,
      changes: 14,
      patch: '@@ -1 +1 @@\n-old\n+new endpoint'
    }],
    checks: [{ name: 'unit-tests', status: 'completed', conclusion: 'success' }],
    checksAvailable: true,
    diffTruncated: false,
    staticFindings: []
  };
}
