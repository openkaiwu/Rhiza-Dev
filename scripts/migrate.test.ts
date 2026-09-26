// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migrate';

describe('PostgreSQL migration baseline', () => {
  it('has an ordered, checksummed core schema migration', async () => {
    const migrations = await loadMigrations();
    expect(migrations.map(item => item.version)).toEqual(['0001', '0002', '0003', '0004', '0005', '0006', '0007', '0008', '0009', '0010', '0011', '0012', '0013', '0014', '0015', '0016', '0017', '0018', '0019', '0020', '0021', '0022', '0023', '0024', '0025', '0026', '0027', '0028', '0029', '0030']);
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
    expect(migrations[13].sql).toContain('CREATE TABLE bundle_imports');
    expect(migrations[13].sql).toContain('BUNDLE_IMPORT_INVALID_TRANSITION');
    expect(migrations[14].sql).toContain('command_receipt_sealed_result_valid');
    expect(migrations[15].sql).toContain('command_receipt_sealed_error_valid');
    expect(migrations[28].sql).toContain('rhiza_resource_versions_blob_identity_check');
    expect(migrations[28].sql).toContain('sealed-v1');
    expect(migrations[29].sql).toContain('CREATE TABLE purge_checkpoints');
    expect(migrations[29].sql).toContain('CREATE TABLE purge_key_references');
  });
});
