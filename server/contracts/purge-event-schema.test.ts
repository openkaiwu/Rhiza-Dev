import Ajv from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { expect, it } from 'vitest';
import schema from './domain-event-envelope.schema.json';

it('validates redacted relation facts in portable journal payloads', () => {
  const ajv = new Ajv();
  addFormats(ajv);
  const validate = ajv.compile(schema.properties.payload);
  const relation = { id: 'edge', source: 'a', target: 'b', relation: 'references', createdAt: '2026-09-09T00:00:00Z', label: '' };
  expect(validate({ removedRelations: [relation] })).toBe(true);
  expect(validate({ removedRelation: { ...relation, label: 'historical', anchorId: 'anchor' } })).toBe(true);
  for (const value of [null, [], {}, { ...relation, source: {} }, { ...relation, target: '' }, { ...relation, label: {} }, { ...relation, anchorId: null }, { ...relation, createdAt: 'invalid' }, { ...relation, extra: 'private' }]) {
    expect(validate({ removedRelation: value })).toBe(false);
  }
  expect(validate({})).toBe(true);
  const object = { id: 'node', kind: 'main', createdAt: relation.createdAt, x: 1, y: 2 };
  expect(validate({ removedObject: object })).toBe(true);
  expect(validate({ removedObject: { ...object, title: 'legacy title', summary: 'legacy summary', status: 'archived', updatedAt: relation.createdAt } })).toBe(true);
  for (const value of [null, [], {}, { ...object, id: {} }, { ...object, x: '1' }, { ...object, kind: 'invalid' }, { ...object, createdAt: 'invalid' }, { ...object, extra: {} }]) {
    expect(validate({ removedObject: value })).toBe(false);
  }
  for (const value of [null, {}, [null], [{ ...relation, label: 'private' }], [{ ...relation, source: {} }], [{ ...relation, createdAt: 'invalid' }], [{ ...relation, extra: 'private' }]]) {
    expect(validate({ removedRelations: value })).toBe(false);
  }
});
