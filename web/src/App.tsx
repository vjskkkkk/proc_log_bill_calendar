import { lazy, Suspense, useMemo } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { selectToday } from '@shared/schedule/today';
import type { Role, UserPublic } from '@shared/types';
import { useAuthStatus } from './api/auth';
import { usePlan, usePlanVersionPoll } from './api/plan';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toaster';
import LoginPage from './pages/Login';
import ChangePasswordPage from './pages/ChangePassword';
import AdminUsersPage from './pages/AdminUsers';
import TodayPage, { useTodayIST } from './pages/Today';
import ProjectsPage from './pages/Projects';
import TaskListsPage from './pages/TaskLists';

const PlannerPage = lazy(() => import('./pages/Planner'));

function Loading() {
  return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
}

/** Signed in: the shell, the Today badge (my open + overdue items) and the plan-version poll. */
function SignedIn({ user }: { user: UserPublic }) {
  usePlanVersionPoll();
  const plan = usePlan('open');
  const today = useTodayIST();
  const location = useLocation();
  const badge = useMemo(() => {
    if (!plan.data || user.role === 'viewer') return undefined;
    const c = selectToday(plan.data.projects, plan.data.tasks, { date: today, today, userId: user.id, scope: 'mine' }).counts;
    return { count: c.active + c.overdue, overdue: c.overdue };
  }, [plan.data, today, user]);

  const gate = (roles: Role[], el: React.ReactNode) => (roles.includes(user.role) ? el : <Navigate to="/" replace />);
  return (
    <Shell user={user} fullBleed={location.pathname.startsWith('/planner')} todayBadge={badge}>
      <Suspense fallback={<div className="p-6 text-muted">Loading…</div>}>
        <Routes>
          <Route path="/" element={<TodayPage user={user} />} />
          <Route path="/planner" element={<PlannerPage user={user} />} />
          <Route path="/projects" element={<ProjectsPage user={user} />} />
          <Route path="/task-lists" element={<TaskListsPage user={user} />} />
          <Route path="/catalogue" element={<Navigate to="/task-lists" replace />} />
          <Route path="/change-password" element={<ChangePasswordPage forced={user.mustChangePassword} />} />
          <Route path="/admin/users" element={gate(['admin'], <AdminUsersPage />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
    </Shell>
  );
}

export default function App() {
  const status = useAuthStatus();
  const location = useLocation();
  if (status.isLoading) return <Loading />;
  if (status.isError || !status.data) {
    return <div className="p-6 text-brand-red">Cannot reach the server. Please retry.</div>;
  }
  const { needsSetup, user } = status.data;

  if (needsSetup) return <LoginPage mode="setup" />;
  if (!user) return <LoginPage mode="login" />;
  if (user.mustChangePassword && location.pathname !== '/change-password') return <Navigate to="/change-password" replace />;
  if (user.mustChangePassword) {
    return (
      <Shell user={user}>
        <ChangePasswordPage forced />
      </Shell>
    );
  }
  return <SignedIn user={user} />;
}
