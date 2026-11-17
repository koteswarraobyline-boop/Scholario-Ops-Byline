/**
 * The action a feature dependency implies.
 * HARD means the feature has stopped. SOFT means it still runs, with reduced function.
 */
export function featureAction(featureName: string, via: 'HARD' | 'SOFT', causeName: string): string {
  const self = featureName === causeName;
  if (via === 'HARD') {
    return self
      ? `Stopped. Restore ${featureName} before the people who use it can continue.`
      : `Stopped. Restore ${causeName} — ${featureName} cannot run without it.`;
  }
  return self
    ? `Degraded. ${featureName} is only partly available.`
    : `Degraded. ${featureName} still runs with reduced function until ${causeName} recovers.`;
}
