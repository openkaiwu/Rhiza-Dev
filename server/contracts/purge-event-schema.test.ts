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
  expect(validate({})).toBe(true);
  for (const value of [null, {}, [null], [{ ...relation, label: 'private' }], [{ ...relation, source: {} }], [{ ...relation, createdAt: 'invalid' }], [{ ...relation, extra: 'private' }]]) {
    expect(validate({ removedRelations: value })).toBe(false);
  }
});
