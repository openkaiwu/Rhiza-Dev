import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { expect, it } from 'vitest';
import { portableSemanticDeltaSchema } from '../domain/portable-workspace-schema';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { createSeedWorkspace } from '../seed';

it('matches semantic snapshot fields while rejecting malformed historical records', () => {
  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(portableSemanticDeltaSchema);
  const snapshot = workspaceSemanticSnapshot(createSeedWorkspace());
  expect(validate(snapshot), JSON.stringify(validate.errors)).toBe(true);
  expect(Object.keys(portableSemanticDeltaSchema.properties).sort()).toEqual([...Object.keys(snapshot), 'defaultModelId'].sort());
  expect(validate({})).toBe(true);
  expect(validate({ defaultModelId: 'selected-model' })).toBe(true);
  expect(validate({ defaultModelId: null })).toBe(true);
  expect(validate({ defaultModelId: 42 })).toBe(false);
  expect(validate({ projectTitle: 'renamed' })).toBe(true);
  for (const delta of [{ mode: 'invalid' }, { messages: [{ id: 'message' }] }, { nodes: [{ id: 'node', title: {} }] }, { auditEvents: [] }, { updatedAt: '2026-09-09T00:00:00Z' }]) {
    expect(validate(delta)).toBe(false);
  }
});
