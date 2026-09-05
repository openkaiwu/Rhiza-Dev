import { embedTerms, estimateTokens, tokenize, type PlannerCandidate } from '../context-planner';
import type { ContextContributor, ContextSource } from './contracts';

/** Reuses the existing local tokenizer and feature hashing at materialization time. */
export class LexicalContextContributor implements ContextContributor {
  readonly version = 'lexical-v1';
  contribute(source: ContextSource): PlannerCandidate {
    const terms = tokenize(source.content);
    return {
      text: source.content, terms, embedding: embedTerms(terms), graphDistance: source.sourceType === 'chunk' ? 2 : 8,
      attachmentId: source.attachmentId,
      item: {
        id: `planner:${source.sourceType}:${source.sourceId}`, title: source.title, detail: source.title,
        sourceType: source.sourceType, sourceId: source.sourceId, sourceNodeId: source.nodeId,
        content: source.content, tokens: estimateTokens(source.content), role: 'Reference',
        status: 'active', selectionMode: 'AUTO_RETRIEVED',
      },
    };
  }
}
