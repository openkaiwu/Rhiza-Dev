import type { ContextManifest } from '../domain';
import type { ContextEnvelope } from '../execution-runtime/run';
import type { RuntimeRequest } from './ports/runtime';
import type { FrozenContextItem } from '../context-runtime/contracts';

/** Prepared local Chat facts shared by ordinary and collaboration execution. */
export type PreparedRun = { replay?: ContextEnvelope['replay']; frozen: FrozenContextItem[]; sourceRunId?: string;
  manifest: ContextManifest; request: RuntimeRequest; createdAt: string; userMessageId: string; versionGroupId: string; version: number };
