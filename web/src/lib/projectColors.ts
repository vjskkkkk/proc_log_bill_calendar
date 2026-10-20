/**
 * Project colours: muted, dark hues that no category uses (categories keep the bright brand colours), given out in
 * planner order so neighbouring projects always differ. The same project gets the same colour on Today and the
 * Planner because both use the open plan's project order.
 */
export const PROJECT_PALETTE = ['#2f5d8a', '#8a5a2b', '#7a2f45', '#2f6b4f', '#4b5563', '#5b6b2a'] as const;

export function projectColorMap(projectIds: string[]): Map<string, string> {
  return new Map(projectIds.map((id, i) => [id, PROJECT_PALETTE[i % PROJECT_PALETTE.length]!]));
}

/** An opaque tint of `color` over the surface (sticky cells must hide what scrolls beneath them). */
export const tint = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, var(--color-surface))`;
