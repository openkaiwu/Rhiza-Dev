import { expect, it } from 'vitest';
import { parseCollaborationSynthesis } from './collaboration-synthesis';

it('validates typed synthesis provenance and attaches authoritative missing participants', () => {
  const input = { recommendation: 'A', rationale: 'Works offline', alternatives: [{ option: 'B', pros: ['Fast'], cons: ['Network'], applicability: 'Online' }], risks: ['Storage'], disagreements: [{ summary: 'Latency', sourceOutputRefs: ['output-a'] }], sourceOutputRefs: ['output-a'] };
  const missing = [{ participantId: 'b', status: 'failed', errorCode: 'PROVIDER_TIMEOUT' }];
  expect(parseCollaborationSynthesis(JSON.stringify(input), ['output-a'], missing)).toEqual({ ...input, missingParticipants: missing });
  expect(() => parseCollaborationSynthesis(JSON.stringify({ ...input, sourceOutputRefs: ['invented'] }), ['output-a'], missing)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'COLLABORATION_SYNTHESIS_INVALID' }) }));
  expect(() => parseCollaborationSynthesis(JSON.stringify({ ...input, missingParticipants: [] }), ['output-a'], missing)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'COLLABORATION_SYNTHESIS_INVALID' }) }));
  expect(() => parseCollaborationSynthesis('plain unstructured answer', ['output-a'], missing)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'COLLABORATION_SYNTHESIS_INVALID' }) }));
  expect(() => parseCollaborationSynthesis(JSON.stringify({ ...input, risks: 'none' }), ['output-a'], missing)).toThrow(expect.objectContaining({ details: expect.objectContaining({ code: 'COLLABORATION_SYNTHESIS_INVALID' }) }));
});
