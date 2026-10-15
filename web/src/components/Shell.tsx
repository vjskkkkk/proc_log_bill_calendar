import { Link, NavLink } from 'react-router-dom';
import type { UserPublic } from '@shared/types';
import { useLogout } from '../api/auth';
import { useTheme } from '../lib/theme';

/** The sibling apps (docs/PLAN.md): projects are picked from BOQ quotes and CRM leads; these buttons jump there. */
export const BOQ_URL = 'https://koochie-boq.vikramjit.workers.dev';
export const CRM_URL = 'https://yourcrm.vikramjit.workers.dev';

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
}

const topButton =
  'inline-flex h-9 items-center gap-2 rounded-lg px-3 text-sm font-medium text-neutral-300 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60';

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  const dark = theme === 'dark';
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-neutral-300 hover:bg-white/10 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green/60"
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {dark ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}

export function Shell({
  user,
  children,
  fullBleed = false,
  todayBadge,
}: {
  user: UserPublic;
  children: React.ReactNode;
  /** The Planner uses the whole window below the top bar and scrolls inside itself. */
  fullBleed?: boolean;
  /** My open + overdue items today (red when any are overdue). */
  todayBadge?: { count: number; overdue: number } | undefined;
}) {
  const logout = useLogout();
  const link = ({ isActive }: { isActive: boolean }) =>
    `relative flex h-full items-center gap-1.5 px-3 text-sm font-medium transition-colors after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors ${
      isActive ? 'text-white after:bg-brand-green' : 'text-neutral-400 hover:text-white after:bg-transparent hover:after:bg-white/25'
    }`;
  const width = fullBleed ? 'px-4' : 'mx-auto max-w-[1500px] px-6';
  return (
    <div className={fullBleed ? 'h-screen flex flex-col overflow-hidden' : 'min-h-screen flex flex-col'}>
      <header className="sticky top-0 z-30 shrink-0 bg-header text-white border-b border-white/10 shadow-md shadow-black/20">
        <div className={`${width} h-14 flex items-center gap-6`}>
          <Link to="/" className="flex h-full items-center shrink-0" title="Today">
            <img src="/brand/logo_white.svg" alt="Koochie Sports" className="h-14 w-auto" />
          </Link>
          <nav className="flex h-full items-stretch gap-1 overflow-x-auto whitespace-nowrap">
            <NavLink to="/" end className={link}>
              Today
              {todayBadge && todayBadge.count > 0 && (
                <span
                  className={`min-w-5 rounded-full px-1.5 text-[11px] leading-5 font-semibold text-center ${todayBadge.overdue ? 'bg-brand-red text-white' : 'bg-white/15 text-white'}`}
                  title={todayBadge.overdue ? `${todayBadge.overdue} overdue` : 'Open today'}
                >
                  {todayBadge.count}
                </span>
              )}
            </NavLink>
            <NavLink to="/planner" className={link}>Planner</NavLink>
            <NavLink to="/projects" className={link}>Projects</NavLink>
            <NavLink to="/catalogue" className={link}>Catalogue</NavLink>
            {user.role === 'admin' && <NavLink to="/admin/users" className={link}>Users</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <a href={BOQ_URL} target="_blank" rel="noopener" className={topButton} title="Open BOQ Maker (quotes)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" />
              </svg>
              BOQ
            </a>
            <a href={CRM_URL} target="_blank" rel="noopener" className={topButton} title="Open the Koochie CRM (lead pipeline)">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="5" height="16" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" /><rect x="17" y="4" width="4" height="6" rx="1" />
              </svg>
              CRM
            </a>
            <div className="mx-1.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <Link to="/change-password" className="flex items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-white/10" title="Account: change password">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-purple text-xs font-semibold text-white ring-2 ring-white/10">{initials(user.name)}</span>
              <div className="leading-tight">
                <div className="text-sm font-medium">{user.name}</div>
                <div className="text-[11px] uppercase tracking-wider text-neutral-400">{user.role}</div>
              </div>
            </Link>
            <div className="mx-1.5 h-6 w-px bg-white/15" aria-hidden="true" />
            <ThemeToggle />
            <button type="button" className={topButton} onClick={() => logout.mutate()} title="Sign out">
              Sign out
            </button>
          </div>
        </div>
      </header>
      {fullBleed ? (
        <main className="flex-1 min-h-0 flex flex-col">{children}</main>
      ) : (
        <main className="flex-1 mx-auto w-full max-w-[1500px] px-6 py-6">{children}</main>
      )}
    </div>
  );
}
