import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checksumGateInput, extractApiRoutes, validateEvidenceExceptions, validateEvidenceSeverity } from './verify-g0';

describe('G0 API snapshot extraction', () => {
  it('includes PUT routes and excludes SPA fallbacks', () => {
    const routes = extractApiRoutes("app.put('/api/providers/:id', handler); app.get('*path', handler);");
    expect(routes).toContain('PUT /api/providers/:id');
    expect(routes).not.toContain('GET *path');
  });
});

describe('G0 commit-bound input checksums', () => {
  it('uses canonical JSON for the fixture registry and byte hashes for other inputs', () => {
    expect(checksumGateInput('fixture-registry.json', '{\n  "b": 2, "a": 1\n}\n'))
      .toBe(checksumGateInput('fixture-registry.json', '{"a":1,"b":2}'));
    expect(checksumGateInput('performance-profile.json', '{\n  "b": 2, "a": 1\n}\n'))
      .not.toBe(checksumGateInput('performance-profile.json', '{"a":1,"b":2}'));
  });
});

describe('G0 evidence exceptions', () => {
  it('validates blocking and observational top-level severities', () => {
    expect(() => validateEvidenceSeverity('blocking', 'blocking', 'archived evidence')).not.toThrow();
    expect(() => validateEvidenceSeverity('observational', 'observational', 'CI observation')).not.toThrow();
    expect(() => validateEvidenceSeverity('observational', 'blocking', 'archived evidence')).toThrow('must be blocking');
  });

  it('accepts a non-expired owned exception', () => {
    expect(() => validateEvidenceExceptions([{ owner: 'platform', expiry: '2099-01-01', adr_or_issue: 'INH-12', severity: 'observational' }], 'known_exceptions', new Date('2026-08-23T00:00:00Z')))
      .not.toThrow();
  });

  it('escalates an expired observational exception to blocking', () => {
    expect(() => validateEvidenceExceptions([{ owner: 'platform', expiry: '2000-01-01', adr_or_issue: 'INH-12', severity: 'observational' }], 'known_exceptions', new Date('2026-08-23T00:00:00Z')))
      .toThrow('escalates to blocking');
  });

  it('keeps an exception valid through its inclusive expiry date', () => {
    expect(() => validateEvidenceExceptions([{ owner: 'platform', expiry: '2026-08-23', adr_or_issue: 'INH-12', severity: 'blocking' }], 'known_exceptions', new Date('2026-08-23T23:59:59Z')))
      .not.toThrow();
  });

  it('requires severity in every newly generated CI observation', () => {
    const schema = JSON.parse(readFileSync('docs/architecture-gates/ci-observation.schema.json', 'utf8')) as { required: string[] };
    expect(schema.required).toContain('severity');
  });
});
