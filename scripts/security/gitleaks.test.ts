// @vitest-environment node
import { expect, it } from 'vitest';
import { classifyHistoryFindings, parseHistoryFindingReviews, sanitizedFindings, verifyChecksum } from './gitleaks';
import { createHash } from 'node:crypto';

it('reports hashes, lines and counts without detector snippets, filenames, credentials or parameters', () => {
  const sensitive = 'fixture-private-credential';
  const report = sanitizedFindings([{ RuleID: 'github-pat', File: sensitive, Secret: sensitive, Match: sensitive, Message: sensitive, StartLine: 7 }]);
  expect(JSON.stringify(report)).not.toContain(sensitive);
  expect(report).toMatchObject([{ fileRef: expect.stringMatching(/^[a-f0-9]{64}$/), ruleRef: expect.stringMatching(/^[a-f0-9]{64}$/), line: 7 }]);
  expect(() => sanitizedFindings({ broken: true })).toThrow('INVALID_SCAN_REPORT');
  expect(() => verifyChecksum(Buffer.from('tampered release'),'a'.repeat(64))).toThrow('TOOL_CHECKSUM_MISMATCH');
});

it('accepts only an exact reviewed historical finding while leaving new revisions, scopes and locations blocked', () => {
  const hash = (value: string) => createHash('sha256').update(value).digest('hex');
  const sensitive = 'fixture-private-credential'; const snippet = 'fixture-private-snippet';
  const raw = { RuleID: 'generic-api-key', File: 'fixture-private-location', StartLine: 36, EndLine: 37, Commit: 'a'.repeat(40), Secret: sensitive, Match: snippet };
  const review = { ruleRef: hash(raw.RuleID), fileRef: hash(raw.File), commit: raw.Commit, line: 36, endLine: 37, sourceBlobDigest: 'b'.repeat(64), kind: 'public-config-assignment' as const };
  const classified = classifyHistoryFindings([raw], 'git', [review]);
  expect(classified).toMatchObject({ reviewedFindingCount: 1, unreviewedFindingCount: 0, findings: [{ review: { kind: 'public-config-assignment', sourceBlobDigest: review.sourceBlobDigest } }] });
  expect(JSON.stringify(classified)).not.toContain('fixture-private');
  for (const changed of [{ ...raw, Commit: 'c'.repeat(40) }, { ...raw, File: 'another-private-location' }, { ...raw, RuleID: 'another-rule' }, { ...raw, StartLine: 35 }, { ...raw, EndLine: 38 }, { ...raw, Commit: undefined }]) {
    expect(classifyHistoryFindings([changed], 'git', [review])).toMatchObject({ reviewedFindingCount: 0, unreviewedFindingCount: 1 });
  }
  expect(classifyHistoryFindings([raw], 'dir', [review])).toMatchObject({ reviewedFindingCount: 0, unreviewedFindingCount: 1 });
  expect(classifyHistoryFindings([raw, { ...raw, Commit: 'c'.repeat(40) }], 'git', [review])).toMatchObject({ reviewedFindingCount: 1, unreviewedFindingCount: 1 });
});

it('rejects broad, malformed, duplicated or tool-version-stale review decisions before applying them', () => {
  const review = { ruleRef: 'a'.repeat(64), fileRef: 'b'.repeat(64), commit: 'c'.repeat(40), line: 36, endLine: 37, sourceBlobDigest: 'd'.repeat(64), kind: 'public-config-assignment' };
  const valid = { schemaVersion: '1.0.0', toolVersion: '8.30.1', reviews: [review] };
  expect(parseHistoryFindingReviews(valid)).toEqual([review]);
  for (const value of [null, { ...valid, toolVersion: '8.30.0' }, { ...valid, reviews: [review, review] }, { ...valid, wildcard: true },
    ...[{ ...review, commit: '*' }, { ...review, fileRef: '*' }, { ...review, line: 0 }, { ...review, endLine: 35 }, { ...review, kind: 'ignore' }, { ...review, ruleRef: undefined }, { ...review, sourceBlobDigest: undefined }].map(entry => ({ ...valid, reviews: [entry] }))]) {
    expect(() => parseHistoryFindingReviews(value)).toThrow('INVALID_HISTORY_REVIEW');
  }
});
