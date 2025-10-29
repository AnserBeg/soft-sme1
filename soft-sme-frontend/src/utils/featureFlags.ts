const normalizeFlagValue = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim().toLowerCase();
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (value == null) {
    return '';
  }
  return String(value).trim().toLowerCase();
};

const truthyValues = new Set(['1', 'true', 'yes', 'on']);

export const isFeatureFlagEnabled = (value: unknown): boolean => {
  const normalized = normalizeFlagValue(value);
  if (!normalized) {
    return false;
  }
  if (normalized === '0') {
    return false;
  }
  if (normalized === 'false' || normalized === 'off' || normalized === 'no') {
    return false;
  }
  return truthyValues.has(normalized);
};

export default {
  isFeatureFlagEnabled,
};
