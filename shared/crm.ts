/** "Company — Project", or whichever is filled when they match or one is blank (same rule as BOQ Maker's CRM title). */
export function crmTitle(company: string, project: string): string {
  const c = company.trim();
  const p = project.trim();
  const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
  if (!c || !p || norm(c) === norm(p)) return c || p;
  return `${c} — ${p}`;
}
