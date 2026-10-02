import { applicationError } from '../contracts/application-error';
import type { ResourceVersionView } from '../contracts/application';
import type { ResourceVersionFacts } from './ports/workspace-unit-of-work';
import type { BlobStorePort } from './ports/host-runtime';

const previewLimit = 256 * 1024;
const textTypes = new Set(['application/json', 'application/xml', 'application/javascript', 'application/vnd.rhiza.context+json']);
const invalid = () => applicationError('资源内容无法通过完整性校验。', 'RESOURCE_CONTENT_INVALID', 'conflict', 'none', false, 409);

/** A version read follows only its immutable identity, never a latest attachment or current Context. */
export async function readVerifiedResourceVersion(facts: ResourceVersionFacts, input: { workspaceId: string; resourceId: string; versionId: string }, blobs: BlobStorePort): Promise<{ view: ResourceVersionView; bytes: Uint8Array }> {
  const { resource, version } = facts;
  if (resource.workspaceId !== input.workspaceId || resource.id !== input.resourceId || version.id !== input.versionId || version.resourceId !== resource.id)
    throw applicationError('资源版本不存在。', 'RESOURCE_VERSION_NOT_FOUND', 'not_found', 'none', false, 404);
  if (version.purgedAt || version.blobRef === 'purged-v1') throw applicationError('资源版本已被永久清除。', 'RESOURCE_VERSION_PURGED', 'not_found', 'none', false, 410);
  if (version.digestAlgorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(version.digest) || !Number.isSafeInteger(version.size) || version.size < 0) throw invalid();
  const sealed = version.blobRef.split('/');
  if (sealed[0] === 'sealed-v1') {
    try {
      if (sealed.length !== 6 || decodeURIComponent(sealed[1]) !== input.workspaceId || decodeURIComponent(sealed[2]) !== version.id
        || !/^[a-f0-9]{64}$/.test(sealed[3]) || sealed[4] !== version.digest || sealed[5] !== String(version.size)) throw invalid();
    } catch { throw invalid(); }
  } else if (version.blobRef !== `sha256/${version.digest.slice(0, 2)}/${version.digest}`) throw invalid();
  let bytes: Uint8Array;
  try { bytes = await blobs.read(version.blobRef, version.digest); }
  catch (error) {
    if (error && typeof error === 'object' && 'reason' in error && error.reason === 'missing_blob')
      throw applicationError('资源内容不存在。', 'RESOURCE_CONTENT_MISSING', 'not_found', 'none', false, 404);
    throw invalid();
  }
  if (bytes.length !== version.size) throw invalid();
  const mediaType = version.mediaType.split(';')[0].trim().toLowerCase();
  let preview: ResourceVersionView['preview'] = { kind: 'binary' };
  if (mediaType.startsWith('text/') || textTypes.has(mediaType)) {
    if (bytes.length > previewLimit && mediaType !== 'application/vnd.rhiza.context+json') preview = { kind: 'too_large' };
    else {
      try {
        let text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (mediaType === 'application/vnd.rhiza.context+json') {
          const snapshot: unknown = JSON.parse(text);
          if (!snapshot || typeof snapshot !== 'object' || !('schemaVersion' in snapshot) || snapshot.schemaVersion !== '1.0.0'
            || !('content' in snapshot) || typeof snapshot.content !== 'string') throw invalid();
          text = snapshot.content;
        }
        preview = bytes.length > previewLimit ? { kind: 'too_large' } : { kind: 'text', text };
      } catch { throw invalid(); }
    }
  }
  const { id, resourceId, version: ordinal, digestAlgorithm, digest, canonicalization, size, createdAt } = version;
  return { bytes, view: { resource: { id: resource.id, workspaceId: resource.workspaceId, kind: resource.kind, title: resource.logicalName },
    version: { id, resourceId, version: ordinal, digestAlgorithm, digest, canonicalization, mediaType: version.mediaType, size, createdAt }, preview } };
}
