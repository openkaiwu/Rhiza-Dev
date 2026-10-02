import { applicationError } from '../contracts/application-error';
import type { CollaborationSynthesis } from '../contracts/collaboration';

const fail = (): never => { throw applicationError('汇总输出格式或来源引用无效，请手动重试汇总。', 'COLLABORATION_SYNTHESIS_INVALID', 'validation', 'retry', true, 422); };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 4000;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 16 && value.every(text);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).length === allowed.length && allowed.every(key => Object.hasOwn(value, key));

export function parseCollaborationSynthesis(raw: string, outputs: string[], missing: CollaborationSynthesis['missingParticipants']): CollaborationSynthesis {
  let value: unknown;
  try { if (raw.length > 64_000) return fail(); value = JSON.parse(raw); } catch { return fail(); }
  if (!object(value) || !keys(value, ['recommendation','rationale','alternatives','risks','disagreements','sourceOutputRefs'])
    || !text(value.recommendation) || !text(value.rationale) || !strings(value.risks) || !strings(value.sourceOutputRefs)
    || value.sourceOutputRefs.length === 0 || value.sourceOutputRefs.some(ref => !outputs.includes(ref))
    || !Array.isArray(value.alternatives) || value.alternatives.length > 16
    || value.alternatives.some(item => !object(item) || !keys(item, ['option','pros','cons','applicability']) || !text(item.option) || !text(item.applicability) || !strings(item.pros) || !strings(item.cons))
    || !Array.isArray(value.disagreements) || value.disagreements.length > 16
    || value.disagreements.some(item => !object(item) || !keys(item, ['summary','sourceOutputRefs']) || !text(item.summary) || !strings(item.sourceOutputRefs) || item.sourceOutputRefs.some(ref => !outputs.includes(ref)))) return fail();
  return { ...(value as unknown as Omit<CollaborationSynthesis, 'missingParticipants'>), missingParticipants: structuredClone(missing) };
}
