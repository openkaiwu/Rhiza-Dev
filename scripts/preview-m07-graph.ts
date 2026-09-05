import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/app';
import { createSeedWorkspace } from '../server/seed';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { loadAiConfig } from '../server/config';

const directory = await mkdtemp(join(tmpdir(), 'rhiza-m07-visual-'));
const workspace = createSeedWorkspace();
const template = workspace.discussionNodes[0]!;
workspace.discussionNodes = Array.from({ length: 300 }, (_, index) => ({
  ...template, id: index === 0 ? template.id : `m07-visual-${String(index).padStart(3, '0')}`,
  title: `讨论 ${String(index).padStart(3, '0')}`, summary: '固定大图验收：布局与关系', anchorText: `来源锚点 ${index}`,
  kind: index === 0 ? 'main' as const : 'branch' as const,
  x: 40 + index % 10 * 190, y: 120 + Math.floor(index / 10) * 115,
}));
workspace.discussionEdges = workspace.discussionNodes.slice(1).map((node, index) => ({
  id: `m07-edge-${index}`, source: workspace.discussionNodes[index]!.id, target: node.id,
  relation: 'related-to', label: '相关讨论', createdAt: template.createdAt,
}));
workspace.activeNodeId = template.id;
const store = await openEmbeddedWorkspaceStore(join(directory, 'database'));
await store.initialize(workspace);
const providers = new ProviderService(new ProviderStore(join(directory, 'providers.json')), new SecretVault(join(directory, 'key')), loadAiConfig({}));
const server = createApp(store, providers, true, undefined, undefined, join(directory, 'uploads')).listen(18787, '127.0.0.1', () => console.info('M07 visual fixture ready: http://127.0.0.1:18787'));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close(() => { void store.close().then(() => process.exit(0)); }));
