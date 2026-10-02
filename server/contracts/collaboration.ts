import type { ContextItem, StoredMessage, StoredAttachment, ContextManifest, ContextMode, GenerationOptions } from '../domain';

export interface CollaborationModelSnapshot {
  id: string; provider: string; model: string; displayName: string; active: boolean;
  providerEndpointRef?: string; endpointVersion?: string;
  endpoint?: { baseUrl: string; chatPath: string; allowNoKey: boolean };
}
export type CollaborationMode = 'independent-review' | 'peer-review' | 'debate' | 'second-opinion';
export type CollaborationStatus = 'running' | 'synthesizing' | 'completed' | 'partial' | 'failed' | 'canceled' | 'interrupted' | 'budget-exhausted';
export type ParticipantStatus = 'running' | 'completed' | 'failed' | 'canceled' | 'interrupted';
export interface FrozenCollaborationBase {
  workspaceId: string; nodeId: string; contextBaseHash: string; prompt: string;
  contextItems: ContextItem[]; history: StoredMessage[]; attachmentIds: string[]; attachments?: StoredAttachment[];
  mode?: ContextMode; generation?: GenerationOptions; manifest?: ContextManifest;
}
export interface CollaborationExchange {
  participantId: string; round: number; status: ParticipantStatus;
  runRef: string; manifestRef: string; providerEndpointRef: string; outputRef?: string; text?: string; errorCode?: string;
}
export interface CollaborationInvocation {
  base: FrozenCollaborationBase; exchange: CollaborationExchange[];
  missingParticipants?: CollaborationSynthesis['missingParticipants'];
}
export interface CollaborationAttempt extends CollaborationExchange {
  id: string; attempt: number; input: CollaborationInvocation; reservedTokens: number;
  usedTokens?: number; usageEstimated?: boolean; startedAt: string; terminalAt?: string;
}
export interface CollaborationRecord {
  id: string; workspaceId: string; nodeId: string; revision: number; mode: CollaborationMode;
  participants: string[]; synthesisModelId: string; base: FrozenCollaborationBase;
  status: CollaborationStatus; createdAt: string; cancelRequestedAt?: string;
  budget: { tokenLimit: number; synthesisTokens: number; usedTokens: number; reservedTokens: number; deadlineAt: string; maxRounds: number };
  attempts: CollaborationAttempt[];
  models?: CollaborationModelSnapshot[];
  synthesis?: CollaborationSynthesis;
}

export interface CollaborationSynthesis {
  recommendation: string; rationale: string;
  alternatives: Array<{ option: string; pros: string[]; cons: string[]; applicability: string }>;
  risks: string[]; disagreements: Array<{ summary: string; sourceOutputRefs: string[] }>;
  sourceOutputRefs: string[];
  missingParticipants: Array<{ participantId: string; status: string; errorCode?: string }>;
}
