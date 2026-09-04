// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate';

describe('PostgreSQL migration baseline', () => {
  it('has an ordered, checksummed core schema migration', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map(item => item.version)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009']);
    expect(migrations.every(item => /^[a-f0-9]{64}$/.test(item.checksum))).toBe(true);
    expect(migrations[0].sql).toContain('CREATE TABLE rhiza_projects');
    expect(migrations[0].sql).toContain('CREATE TABLE rhiza_context_manifests');
    expect(migrations[0].sql).not.toMatch(/LibreChat|conversation/i);
    expect(migrations[1].sql).toContain('CREATE TABLE rhiza_attachments');
    expect(migrations[3].sql).toContain('rhiza_context_manifests are immutable');
    expect(migrations[4].sql).toContain('CREATE TABLE IF NOT EXISTS users');
    expect(migrations[4].sql).toContain('ON CONFLICT');
    expect(migrations[5].sql).toContain('CREATE TABLE rhiza_resource_versions');
    expect(migrations[5].sql).toContain('rhiza_resource_versions are immutable');
    expect(migrations[6].sql).toContain('CREATE TABLE workspace_events');
    expect(migrations[6].sql).toContain('workspace_events are append-only');
    expect(migrations[6].sql).not.toContain('workflow.created');
    expect(migrations[8].sql).toContain('CREATE TABLE workspace_objects');
    expect(migrations[8].sql).toContain('CREATE TABLE projection_checkpoints');
    expect(migrations[8].sql).toContain('CREATE TABLE graph_layout_nodes');
  });
});
