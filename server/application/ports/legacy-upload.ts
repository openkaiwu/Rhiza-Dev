/** Byte-oriented attachment storage, intentionally independent of Node buffers/filesystems. */
export interface LegacyUploadPort {
  put(key: string, bytes: Uint8Array): Promise<void>;
}

/** Text extraction remains a host concern because PDF decoding needs platform libraries. */
export interface LegacyTextExtractionPort {
  extractText(mimeType: string, bytes: Uint8Array): Promise<string>;
}
