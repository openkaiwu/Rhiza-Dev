import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { loadMigrations } from './migrate';
import { createSeedWorkspace } from '../server/seed';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeImportArchiveStore, stagePortableWorkspace } from '../server/infrastructure/portable-content';
import { NodePortableBundle } from '../server/infrastructure/portable-bundle';
import { createApp } from '../server/host-node/create-app';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import type { AIRuntime } from '../server/ai-runtime';
import { inspectM10Store } from './m10-inspection';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';

// M15–M18 adds migration 0038 onward; this prior reader includes the identical current schema.
const baseline = '0fe6453';
export async function runRollbackDrill(compatibleRef = baseline) {
  const commit = execFileSync('git', ['rev-parse', '--verify', `${compatibleRef}^{commit}`], { encoding: 'utf8' }).trim();
  for (const migration of await loadMigrations()) {
    const sql = execFileSync('git', ['show', `${commit}:db/migrations/${migration.name}.up.sql`]);
    if (createHash('sha256').update(sql).digest('hex') !== migration.checksum) throw new Error('M10_ROLLBACK_SCHEMA_INCOMPATIBLE');
  }
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m10-drill-'));
  const uploads = join(root, 'uploads');
  const blobs = NodeEncryptedBlobStore.atDirectory(uploads);
  const archives = new NodeImportArchiveStore(join(uploads, 'imports'));
  let store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'apply', blobs, archives);
  let calls = 0;
  const model = { id: 'model-one', providerEndpointRef: 'endpoint-one', model: 'same-model', provider: 'Fixture', displayName: 'Fixture', active: true };
  const runtime: AIRuntime = { kind: 'provider-adapter', listModels: async () => [model],
    generate: async function* (input) { calls++; if (input.prompt === 'failed-input-only') { yield { type: 'RUN_ERROR', requestId: input.requestId, code: 'PROVIDER_UNREACHABLE', message: 'fixture failure', status: 502 }; return; } yield { type: 'RUN_END', requestId: input.requestId, text: `fixture answer ${calls}`, model: model.model, provider: model.provider }; } };
  const provider = new ProviderService(new ProviderStore(join(root, 'providers.json')), new SecretVault(join(root, 'provider-key')),
    { baseUrl: 'https://example.test/v1', apiKey: '', model: model.model, providerName: 'Fixture', chatPath: '/chat/completions',
      timeoutMs: 1000, temperature: 0.4, extraHeaders: {}, allowNoKey: true });
  try {
    await store.initialize({ ...createSeedWorkspace(), messages: [], segments: [], contextItems: [] });
    let app = createApp(store, provider, false, runtime, undefined, uploads, blobs);
    const initial = await request(app).get('/api/workspace').expect(200);
    await store.backfillJournal();
    const workspaceId = store.defaultWorkspaceId;
    await request(app).post('/api/v1/workspaces').send({ name: 'Second Workspace' }).expect(201);
    const attachment = await request(app).post(`/api/v1/workspaces/${workspaceId}/attachments`).send({ name: '[purged]', mimeType: 'text/plain', dataBase64: Buffer.from('M10 attachment bytes').toString('base64') }).expect(201);
    const sensitive = 'M10 content that must stay purged';
    const chat = await request(app).post('/api/chat').set('Idempotency-Key', 'drill-chat').send({ nodeId: initial.body.workspace.activeNodeId,
      modelId: model.id, message: sensitive, attachmentIds: [attachment.body.attachment.id] }).expect(201);
    const sourceFacts = await store.readPortableWorkspace();
    const bundle = await new NodePortableBundle(blobs, root).export(sourceFacts);
    const zip = join(root, 'workspace.rhiza');
    const chunks: Uint8Array[] = [];
    for await (const chunk of bundle.bytes) chunks.push(Buffer.from(chunk));
    await writeFile(zip, Buffer.concat(chunks));
    await bundle.dispose();
    const staged = await stagePortableWorkspace(zip);
    try {
      const expected = portableWorkspaceFacts(sourceFacts, value => semanticStateChecksum(value as Record<string, unknown>));
      if (semanticStateChecksum({ facts: staged.facts }) !== semanticStateChecksum({ facts: expected })) throw new Error('M10_BUNDLE_CHECKSUM_MISMATCH');
    } finally { await staged.dispose(); }
    await request(app).post('/api/chat').send({ message: 'failed-input-only', attachmentIds: [attachment.body.attachment.id] }).expect(502);
    const failedRunVersions = (await store.read()).resourceVersions.map(item => item.id);
    await request(app).post('/api/graph/nodes').send({ title: 'Retained conversation' }).expect(201);
    await request(app).patch(`/api/nodes/${initial.body.workspace.activeNodeId}/status`).send({ status: 'archived' }).expect(200);
    const purge = await request(app).post(`/api/graph/nodes/${initial.body.workspace.activeNodeId}/purge`).send({ confirmation: `PURGE ${initial.body.workspace.activeNodeId}`, reason: 'fixture' });
    if (purge.status !== 200) throw new Error(`M10_DRILL_PURGE_FAILED:${purge.body.error?.code ?? purge.status}`);
    if (Object.values(await store.auditHistoricalKeys()).flat().some(key => !key.referenced && key.state === 'active')) throw new Error('M10_PURGED_HISTORICAL_KEY_REMAINS');
    const current = await store.readExisting();
    if (failedRunVersions.some(id => current!.resourceVersions.some(version => version.id === id && !version.purgedAt))) throw new Error('M10_FAILED_RUN_SNAPSHOT_REMAINS');
    const payload = { nodeId: current!.activeNodeId, modelId: model.id, message: 'Retained new history' };
    const retained = await request(app).post('/api/chat').set('Idempotency-Key', 'drill-retained').send(payload).expect(201);
    const before = await inspectM10Store(store);
    if (!before.ok) throw new Error(`M10_DRILL_RECONCILIATION_FAILED:${JSON.stringify(before)}`);
    const callsBeforeRestart = calls;
    await store.close();

    // Run the prior code's actual reader, keeping current schema, Journal and encryption.
    const old = join(root, 'compatible-code');
    await mkdir(old);
    execFileSync('tar', ['-x', '-C', old], { input: execFileSync('git', ['archive', commit], { maxBuffer: 64 * 1024 * 1024 }) });
    await symlink(resolve('node_modules'), join(old, 'node_modules'), 'dir');
    const reader = join(old, 'm10-reader.mts');
    await writeFile(reader, `import { openEmbeddedWorkspaceStore } from './server/embedded-store.ts';
      import { semanticChecksum } from './server/infrastructure/workspace-semantic-checksum.ts';
      const store = await openEmbeddedWorkspaceStore(${JSON.stringify(join(root, 'db'))},undefined,'verify');
      try { const values = []; for (const id of await store.listWorkspaceIds()) {
        const target = store.forWorkspace(id); const facts = await target.readPortableWorkspace();
        values.push({workspaceId:id,checksum:semanticChecksum(facts.workspace),journal:facts.journal.length,
          purgedContentAbsent:!JSON.stringify(facts).includes(${JSON.stringify(sensitive)})}); }
        console.log(JSON.stringify(values)); } finally { await store.close(); }`);
    const oldFacts = JSON.parse(execFileSync(process.execPath, ['--import', 'tsx', reader], { cwd: old, encoding: 'utf8', timeout: 30000 })) as Array<{ workspaceId: string; checksum: string; journal: number; purgedContentAbsent: boolean }>;
    const compatibleReader = before.workspaces.every(item => oldFacts.some(old => old.workspaceId === item.workspaceId && old.checksum === item.currentChecksum && old.journal === item.counts?.journal));
    store = await openEmbeddedWorkspaceStore(join(root, 'db'), undefined, 'verify', blobs, archives);
    const after = await inspectM10Store(store);
    app = createApp(store, provider, false, runtime, undefined, uploads, blobs);
    const retry = await request(app).post('/api/chat').set('Idempotency-Key', 'drill-retained').send(payload).expect(201);
    const recoveredWithoutDuplicateCall = calls === callsBeforeRestart && retry.body.assistantMessage.id === retained.body.assistantMessage.id;
    const purgedContentAbsent = oldFacts.every(item => item.purgedContentAbsent);
    return { schemaVersion: '1.0.0', ok: compatibleReader && recoveredWithoutDuplicateCall && purgedContentAbsent && after.ok
      && JSON.stringify(before) === JSON.stringify(after), compatibleCommit: commit, compatibleReader,
      recoveredWithoutDuplicateCall, purgedContentAbsent, workspaces: before.workspaces.length,
      bundleVerified: true, originalRunCreated: sourceFacts.runs.some(run => run.input.request.manifestId === chat.body.manifest.id), externalGate: 'pending' };
  } finally { await store.close(); await rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const output = console.info;
  console.info = (...args) => console.error(...args);
  try {
    const report = await runRollbackDrill(process.argv[2] || baseline);
    output(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } catch {
    output(JSON.stringify({ schemaVersion: '1.0.0', ok: false, error: 'M10_ROLLBACK_DRILL_FAILED' }));
    process.exitCode = 1;
  } finally { console.info = output; }
}
