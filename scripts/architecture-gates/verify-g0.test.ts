import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checksumGateInput, compareContractSnapshots, extractApiRoutes, validateEvidenceExceptions, validateEvidenceSeverity, verifyApprovedContractSources } from './verify-g0';

const frozenApi = { version: 'legacy-api-snapshot-1.0.0', routes: ['GET /api/legacy'], sseChannels: ['runtime', 'commit'], sseEventTypes: ['RUN_START', 'RUN_END'] };
const frozenDb = { version: 'legacy-db-schema-snapshot-1.0.0', migrations: { 'db/migrations/0001.up.sql': 'sha256:old' } };
const additions = { routes: ['GET /api/approved'], migrations: { 'db/migrations/0002.up.sql': 'sha256:new' } };
const currentApi = { ...frozenApi, routes: ['GET /api/legacy', 'GET /api/approved'] };
const currentDb = { ...frozenDb, migrations: { ...frozenDb.migrations, ...additions.migrations } };

describe('G0 approved additive compatibility', () => {
  it('accepts only the exact reviewed additions while retaining the historical contract', () => {
    expect(compareContractSnapshots(frozenApi, frozenDb, currentApi, currentDb, additions)).toMatchObject({
      ok: true, addedRoutes: ['GET /api/approved'], addedMigrations: ['db/migrations/0002.up.sql'],
    });
  });

  it('rejects an unreviewed extra route instead of accepting an arbitrary superset', () => {
    expect(compareContractSnapshots(frozenApi, frozenDb, { ...currentApi, routes: [...currentApi.routes, 'GET /api/unreviewed'] }, currentDb, additions))
      .toMatchObject({ ok: false, unknownRoutes: ['GET /api/unreviewed'] });
  });

  it('rejects deletion of a historical route and omission of an approved route', () => {
    expect(compareContractSnapshots(frozenApi, frozenDb, { ...currentApi, routes: [] }, currentDb, additions))
      .toMatchObject({ ok: false, removedRoutes: ['GET /api/legacy'], missingApprovedRoutes: ['GET /api/approved'] });
  });

  it('rejects either SSE type or channel changes', () => {
    for (const api of [{ ...currentApi, sseEventTypes: ['RUN_START'] }, { ...currentApi, sseChannels: ['commit'] }]) {
      expect(compareContractSnapshots(frozenApi, frozenDb, api, currentDb, additions)).toMatchObject({ ok: false, sseChanged: true });
    }
  });

  it('rejects modified, removed and unreviewed migrations including approved additions', () => {
    expect(compareContractSnapshots(frozenApi, frozenDb, currentApi, {
      ...currentDb, migrations: { 'db/migrations/0002.up.sql': 'sha256:changed', 'db/migrations/0003.up.sql': 'sha256:unknown' },
    }, additions)).toMatchObject({
      ok: false, removedMigrations: ['db/migrations/0001.up.sql'], changedMigrations: ['db/migrations/0002.up.sql'], unknownMigrations: ['db/migrations/0003.up.sql'],
    });
    expect(compareContractSnapshots(frozenApi, frozenDb, currentApi, {
      ...currentDb, migrations: { ...currentDb.migrations, 'db/migrations/0001.up.sql': 'sha256:changed' },
    }, additions)).toMatchObject({ ok: false, changedMigrations: ['db/migrations/0001.up.sql'] });
  });

  it('rejects duplicate approval identities and changed snapshot versions', () => {
    expect(compareContractSnapshots(frozenApi, frozenDb, { ...currentApi, version: 'changed' }, currentDb, additions))
      .toMatchObject({ ok: false, versionChanged: true });
    expect(compareContractSnapshots(frozenApi, frozenDb, currentApi, currentDb, { ...additions, routes: [...additions.routes, additions.routes[0]!] }))
      .toMatchObject({ ok: false, duplicateApprovals: true });
  });

  it('binds approvals to actual ancestor commits and rejects a different frozen source', () => {
    const manifest = JSON.parse(readFileSync('docs/architecture-gates/G0/approved-additions.json', 'utf8'));
    expect(verifyApprovedContractSources(manifest)).toMatchObject({ routes: expect.arrayContaining(['POST /api/collaborations']) });
    expect(() => verifyApprovedContractSources({ ...manifest, snapshotCommit: 'a094458cc9cb82ff20bdd9b5578ec0fc41af0ffe' })).toThrow('frozen snapshot source');
    const changed = structuredClone(manifest);
    changed.approvals[0].apiSourceSha256 = `sha256:${'0'.repeat(64)}`;
    expect(() => verifyApprovedContractSources(changed)).toThrow('API approval source checksum');
  });
});

describe('G0 API snapshot extraction', () => {
  it('retains routes registered as arrays in the API contract snapshot', () => {
    expect(extractApiRoutes("app.post(['/api/chat/stream', '/api/temp-chat/stream'], handler);")).toEqual(['POST /api/chat/stream', 'POST /api/temp-chat/stream']);
  });
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
