import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPdfText } from '../context-planner';
import type { LegacyTextExtractionPort, LegacyUploadPort } from '../application/ports/legacy-upload';

/** Writes the same `${uploadDirectory}/${attachmentId}` object layout used by M01. */
export class NodeFilesystemLegacyUpload implements LegacyTextExtractionPort, LegacyUploadPort {
  constructor(private readonly uploadDirectory: string) {}

  async put(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.uploadDirectory, { recursive: true });
    await writeFile(resolve(this.uploadDirectory, key), bytes);
  }

  async delete(key: string): Promise<void> {
    await rm(resolve(this.uploadDirectory, key), { force: true });
  }

  async extractText(mimeType: string, bytes: Uint8Array): Promise<string> {
    if (mimeType === 'application/pdf') return extractPdfText(Buffer.from(bytes));
    return new TextDecoder().decode(bytes);
  }
}
