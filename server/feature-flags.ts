export const featureFlagNames = [
  'postgresPersistence',
] as const;

export type FeatureFlagName = typeof featureFlagNames[number];
export type FeatureFlags = Readonly<Record<FeatureFlagName, boolean>>;

const defaults: FeatureFlags = {
  postgresPersistence: false,
};

export function loadFeatureFlags(env: NodeJS.ProcessEnv = process.env): FeatureFlags {
  const flags = { ...defaults };
  const raw = env.RHIZA_FEATURE_FLAGS;
  if (!raw) return flags;

  for (const entry of raw.split(',')) {
    const [name, value] = entry.trim().split('=');
    if (['libreChatRuntime', 'fileContext'].includes(name)) {
      throw new Error(`Retired flag ${name}. Remove ${name} from RHIZA_FEATURE_FLAGS; provider Runtime and file Context are always wired.`);
    }
    if (!featureFlagNames.includes(name as FeatureFlagName) || !['true', 'false'].includes(value)) {
      throw new Error(`Invalid RHIZA_FEATURE_FLAGS entry: ${entry}`);
    }
    flags[name as FeatureFlagName] = value === 'true';
  }
  return Object.freeze(flags);
}
