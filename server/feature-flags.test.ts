// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { loadFeatureFlags } from './feature-flags';

describe('feature flags', () => {
  it('defaults the persistence switch to disabled', () => {
    expect(loadFeatureFlags({})).toEqual({
      postgresPersistence: false,
    });
  });

  it('accepts explicit flags and rejects unknown or malformed values', () => {
    expect(loadFeatureFlags({ RHIZA_FEATURE_FLAGS: 'postgresPersistence=true' })).toMatchObject({
      postgresPersistence: true,
    });
    expect(() => loadFeatureFlags({ RHIZA_FEATURE_FLAGS: 'unknown=true' })).toThrow(/Invalid/);
    expect(() => loadFeatureFlags({ RHIZA_FEATURE_FLAGS: 'postgresPersistence=yes' })).toThrow(/Invalid/);
  });
  it.each(['libreChatRuntime', 'fileContext'])('rejects retired %s with migration guidance even when disabled', name => {
    expect(() => loadFeatureFlags({ RHIZA_FEATURE_FLAGS: `${name}=false` })).toThrow(/Remove.*RHIZA_FEATURE_FLAGS/);
  });
});
