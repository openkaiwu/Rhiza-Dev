// @vitest-environment node
import { expect, it } from 'vitest';
import { sanitizedFindings, verifyChecksum } from './gitleaks';

it('reports hashes, lines and counts without detector snippets, filenames, credentials or parameters', () => {
  const sensitive = 'fixture-private-credential';
  const report = sanitizedFindings([{ RuleID: 'github-pat', File: sensitive, Secret: sensitive, Match: sensitive, Message: sensitive, StartLine: 7 }]);
  expect(JSON.stringify(report)).not.toContain(sensitive);
  expect(report).toMatchObject([{ fileRef: expect.stringMatching(/^[a-f0-9]{64}$/), ruleRef: expect.stringMatching(/^[a-f0-9]{64}$/), line: 7 }]);
  expect(() => sanitizedFindings({ broken: true })).toThrow('INVALID_SCAN_REPORT');
  expect(() => verifyChecksum(Buffer.from('tampered release'),'a'.repeat(64))).toThrow('TOOL_CHECKSUM_MISMATCH');
});
