/** The four kinds of back-office work the planner tracks. Order = display order everywhere. */
export const CATEGORIES = ['material', 'equipment', 'logistics', 'billing'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABEL: Record<Category, string> = {
  material: 'Material procurement',
  equipment: 'Equipment procurement',
  logistics: 'Logistics',
  billing: 'Billing',
};

export const CATEGORY_SHORT: Record<Category, string> = {
  material: 'Material',
  equipment: 'Equipment',
  logistics: 'Logistics',
  billing: 'Billing',
};

/** Bar colours from the brand palette (red is reserved for "overdue"); `text` is the readable label colour on top. */
export const CATEGORY_COLOR: Record<Category, { bg: string; text: string }> = {
  material: { bg: '#7d51a0', text: '#ffffff' },
  equipment: { bg: '#f26f33', text: '#ffffff' },
  logistics: { bg: '#ffca07', text: '#231f20' },
  billing: { bg: '#a3cd39', text: '#231f20' },
};

export function isCategory(v: unknown): v is Category {
  return typeof v === 'string' && (CATEGORIES as readonly string[]).includes(v);
}
