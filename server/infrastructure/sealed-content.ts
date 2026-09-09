import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface ContentIdentity { workspaceId: string; contentId: string }
export interface SealedContent { version: 1; iv: Uint8Array; tag: Uint8Array; ciphertext: Uint8Array }

// Keys belong to the deletable key store, never to the immutable content envelope.
// Bind ciphertext to logical identity so copying a row across scopes cannot decrypt it.
export function associatedData(identity: ContentIdentity): Buffer {
  if (!identity.workspaceId || !identity.contentId) throw new Error('CONTENT_IDENTITY_REQUIRED');
  return Buffer.from(JSON.stringify(['rhiza.content.v1', identity.workspaceId, identity.contentId]));
}

export function sealContent(identity: ContentIdentity, plaintext: Uint8Array, key: Uint8Array): SealedContent {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  cipher.setAAD(associatedData(identity));
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { version: 1, iv, tag: cipher.getAuthTag(), ciphertext };
}

export function openContent(identity: ContentIdentity, content: SealedContent, key: Uint8Array): Uint8Array {
  if (content.version !== 1 || content.iv.length !== 12 || content.tag.length !== 16) throw new Error('CONTENT_ENVELOPE_INVALID');
  const decipher = createDecipheriv('aes-256-gcm', key, content.iv, { authTagLength: 16 });
  decipher.setAAD(associatedData(identity));
  decipher.setAuthTag(content.tag);
  // Do not release unauthenticated plaintext before final() verifies the tag.
  const plaintext = decipher.update(content.ciphertext);
  let final: Buffer | undefined;
  try {
    final = decipher.final();
    return Buffer.concat([plaintext, final]);
  } finally {
    plaintext.fill(0);
    final?.fill(0);
  }
}
