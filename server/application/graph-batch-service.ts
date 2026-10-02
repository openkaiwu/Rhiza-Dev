import type { CommandEnvelope, QueryEnvelope } from '../contracts/application';
import type { GraphBatchPlan, GraphBatchResult, GraphBatchStep, GraphBatchStepOutcome } from '../contracts/graph-batch';
import type { WorkspaceData } from '../domain';
import type { WorkspaceUnitOfWork } from './ports/workspace-unit-of-work';
import { graphBatchError, validateGraphBatchRequest } from './graph-batch-plan';

type Parent = CommandEnvelope<'BatchGraphOperations' | 'UndoGraphBatch'> | QueryEnvelope<'GetGraphBatch'>;
export class GraphBatchService {
  constructor(private readonly uow: WorkspaceUnitOfWork, private readonly now: () => string,
    private readonly execute: (parent: Parent, step: GraphBatchStep) => Promise<WorkspaceData>) {}

  async run(envelope: CommandEnvelope<'BatchGraphOperations' | 'UndoGraphBatch'>): Promise<GraphBatchResult> {
    if (envelope.actor.actorType !== 'human' || !this.uow.prepareGraphBatch || !this.uow.withCommand || !this.uow.readCommittedResult) throw graphBatchError('GRAPH_BATCH_UNAVAILABLE', 503);
    const input = validateGraphBatchRequest({ ...envelope.payload, kind: envelope.commandType === 'BatchGraphOperations' ? 'apply' : 'undo' });
    return this.process(envelope, await this.uow.prepareGraphBatch(input), true);
  }
  async get(envelope: QueryEnvelope<'GetGraphBatch'>): Promise<GraphBatchResult> {
    if (!this.uow.readGraphBatchPlan || !this.uow.withCommand || !this.uow.readCommittedResult) throw graphBatchError('GRAPH_BATCH_UNAVAILABLE', 503);
    return this.process(envelope, await this.uow.readGraphBatchPlan(envelope.actor, envelope.payload.batchId), false);
  }
  private async process(parent: Parent, plan: GraphBatchPlan, apply: boolean): Promise<GraphBatchResult> {
    const outcomes: GraphBatchResult['outcomes'] = [];
    for (const item of plan.items) {
      if (item.error || item.skipped) {
        outcomes.push({ itemId: item.itemId, status: item.error ? 'failed' : 'skipped', code: item.error?.code ?? item.skipped, undoable: false, steps: [] }); continue;
      }
      const steps: GraphBatchStepOutcome[] = []; let previous: WorkspaceData | undefined;
      for (const frozen of item.steps) {
        if (frozen.afterPrevious && !previous) { steps.push({ commandId: frozen.commandId, status: 'blocked', code: 'PREVIOUS_STEP_INCOMPLETE' }); continue; }
        try {
          const saved = await this.uow.withCommand!({ commandId: frozen.commandId, commandType: frozen.commandType, actor: parent.actor, scope: parent.scope,
            occurredAt: this.now() }, () => this.uow.readCommittedResult!<WorkspaceData>());
          if (saved.found) previous = saved.value;
          else if (!apply) { steps.push({ commandId: frozen.commandId, status: 'pending' }); previous = undefined; continue; }
          else {
            const step = structuredClone(frozen);
            if (step.afterPrevious && step.commandType === 'ChangeNodeStatus') {
              const node = previous?.discussionNodes.find(node => node.id === step.payload.nodeId);
              if (!node) throw graphBatchError('GRAPH_BATCH_RECEIPT_INVALID', 503);
              step.payload.expectedNodeVersion = { status: node.status, updatedAt: node.updatedAt };
            }
            previous = await this.execute(parent, step);
          }
          if (!previous?.discussionNodes || !previous.discussionEdges) throw graphBatchError('GRAPH_BATCH_RECEIPT_INVALID', 503);
          steps.push({ commandId: frozen.commandId, status: 'succeeded' });
        } catch (error) {
          previous = undefined;
          const details = (error as { details?: { code?: string; status?: number }; code?: string; status?: number });
          const candidate = details.details?.code ?? details.code;
          const code = typeof candidate === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(candidate) ? candidate : 'GRAPH_BATCH_STEP_FAILED';
          steps.push({ commandId: frozen.commandId, status: 'failed', code, retryable: (details.details?.status ?? details.status ?? 500) >= 500 });
        }
      }
      const successes = steps.filter(step => step.status === 'succeeded').length;
      const status = successes === steps.length ? 'succeeded' : successes ? 'partial' : steps.some(step => step.status === 'failed') ? 'failed' : 'pending';
      outcomes.push({ itemId: item.itemId, status, undoable: plan.request.kind === 'apply' && status === 'succeeded', steps });
    }
    const incomplete = outcomes.some(item => item.steps.some(step => step.status === 'pending' || step.retryable));
    const succeeded = outcomes.filter(item => item.status === 'succeeded' || item.status === 'skipped').length;
    return { batchId: plan.batchId, workspaceId: plan.workspaceId, status: incomplete ? 'incomplete' : succeeded === outcomes.length ? 'completed' : succeeded || outcomes.some(item => item.status === 'partial') ? 'partial' : 'failed', outcomes };
  }
}
