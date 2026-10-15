import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuthStatus } from './api/auth';
import { Shell } from './components/Shell';
import LoginPage from './pages/Login';
import ChangePasswordPage from './pages/ChangePassword';
import AdminUsersPage from './pages/AdminUsers';
import type { Role } from '@shared/types';

function Loading() {
  return <div className="flex min-h-screen items-center justify-center text-muted">Loading…</div>;
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

  const gate = (roles: Role[], el: React.ReactNode) => (roles.includes(user.role) ? el : <Navigate to="/" replace />);
  return (
    <Shell user={user}>
      <Routes>
        <Route path="/" element={<h1 className="text-2xl font-semibold">Today</h1>} />
        <Route path="/change-password" element={<ChangePasswordPage forced={user.mustChangePassword} />} />
        <Route path="/admin/users" element={gate(['admin'], <AdminUsersPage />)} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
