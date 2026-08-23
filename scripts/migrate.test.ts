// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate';

describe('PostgreSQL migration baseline', () => {
  it('has an ordered, checksummed core schema migration', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map(item => item.version)).toEqual(['0001', '0002', '0003', '0004']);
    expect(migrations.every(item => /^[a-f0-9]{64}$/.test(item.checksum))).toBe(true);
    expect(migrations[0].sql).toContain('CREATE TABLE rhiza_projects');
    expect(migrations[0].sql).toContain('CREATE TABLE rhiza_context_manifests');
    expect(migrations[0].sql).not.toMatch(/LibreChat|conversation/i);
    expect(migrations[1].sql).toContain('CREATE TABLE rhiza_attachments');
    expect(migrations[3].sql).toContain('rhiza_context_manifests are immutable');
  });
});
