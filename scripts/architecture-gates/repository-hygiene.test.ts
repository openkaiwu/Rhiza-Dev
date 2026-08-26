import { describe, expect, it } from 'vitest';
import { scanTrackedContent } from './repository-hygiene';

describe('repository hygiene scanner', () => {
  it('accepts safe tracked content', () => {
    expect(scanTrackedContent('safe.json', '{"fixture":"synthetic"}')).toEqual([]);
  });

  it('rejects stable secret signatures', () => {
    expect(scanTrackedContent('fixture.json', 'token: ghp_' + 'a'.repeat(36))).toMatchObject([
      { rule: 'secret', detail: 'GitHub token' },
    ]);
  });

  it('rejects absolute paths without relying on a local username', () => {
    expect(scanTrackedContent('fixture.json', '/Use' + 'rs/example/workspace.json')).toMatchObject([
      { rule: 'absolute-path', detail: 'POSIX home path' },
    ]);
  });
});
