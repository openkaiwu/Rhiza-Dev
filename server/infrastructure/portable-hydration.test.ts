// @vitest-environment node
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { expect, it } from 'vitest';
import { exportSecurityFixture } from '../../scripts/security/export-fixture';
import { workspaceSemanticSnapshot } from '../domain-journal';
import { NodePortableBundle } from './portable-bundle';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { stagePortableWorkspace } from './portable-content';
import { hydratePortableWorkspace } from './portable-hydration';

it('hydrates only exact frozen bytes into an independently complete archive without changing facts or source inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-bundle-hydrate-'));
  try {
    const fixture = await exportSecurityFixture(root, { attachmentText: 'Historical file A' });
    fixture.facts.workspace.resourceVersions.push({ ...fixture.facts.workspace.resourceVersions[0], id: 'shared-version', version: 2 });
    fixture.facts.journal[0].payload.snapshot = { stateSchema: 'rhiza.workspace-semantic.v1', sourceSequence: 0, state: workspaceSemanticSnapshot(fixture.facts.workspace) };
    const source = await new NodePortableBundle(new NodeFilesystemBlobStore(join(root, 'source')), root).export(fixture.facts, { includeResources: false });
    const thinPath = join(root, 'thin.rhiza');
    try { await pipeline(Readable.from(source.bytes), createWriteStream(thinPath)); } finally { await source.dispose(); }
    const original = await readFile(thinPath);
    const staged = await stagePortableWorkspace(thinPath, undefined, root, { allowExternal: true });
    try {
      const before = await readdir(root);
      const supply = (resourceVersionId: string, text: string) => [{ resourceVersionId, bytes: Readable.from([Buffer.from(text)]) }];
      await expect(hydratePortableWorkspace(staged, supply('version', 'Historical file B'), root)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_CONTENT_MISMATCH' });
      await expect(hydratePortableWorkspace(staged, supply('unknown-version', 'Historical file A'), root)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH' });
      await expect(hydratePortableWorkspace(staged, [], root)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_CONTENT_REQUIRED' });
      await expect(hydratePortableWorkspace(staged, [...supply('version', 'Historical file A'), ...supply('version', 'Historical file A')], root)).rejects.toMatchObject({ code: 'BUNDLE_EXTERNAL_DESCRIPTOR_MISMATCH' });
      expect(await readdir(root)).toEqual(before);
      const hydrated = await hydratePortableWorkspace(staged, supply('version', 'Historical file A'), root);
      const outputPath = join(root, 'complete.rhiza');
      try { await pipeline(Readable.from(hydrated.bytes), createWriteStream(outputPath)); } finally { await hydrated.dispose(); }
      await staged.dispose();
      const complete = await stagePortableWorkspace(outputPath, undefined, root);
      try {
        expect(complete.facts).toEqual(staged.facts);
        expect(complete.assessment.missingResources).toEqual([]);
        expect(complete.archiveDigest).not.toBe(staged.archiveDigest);
        const version = complete.facts.workspace.resourceVersions[0];
        expect(await readFile(complete.files.get(`blobs/sha256/${version.digest}`)!)).toEqual(Buffer.from('Historical file A'));
        expect(JSON.parse(await readFile(complete.files.get('workspace.json')!, 'utf8')).externalResources).toEqual([]);
      } finally { await complete.dispose(); }
      expect(await readFile(thinPath)).toEqual(original);
      expect(staged.assessment.missingResources).toHaveLength(2);
    } finally { await staged.dispose(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});
