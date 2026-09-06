import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import LoginPage from './pages/LoginPage';
import OrgListPage from './pages/OrgListPage';
import WizardPage from './pages/WizardPage';
import MembersPage from './pages/MembersPage';
import TeamPage from './pages/TeamPage';
import SettingsPage from './pages/SettingsPage';
import EventsPage from './pages/EventsPage';
import EventPage from './pages/EventPage';
import TableScreenPage from './pages/TableScreenPage';
import InvitePage from './pages/InvitePage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/" element={<RequireAuth><OrgListPage /></RequireAuth>} />
          <Route path="/new" element={<RequireAuth><WizardPage /></RequireAuth>} />
          <Route path="/o/:slug/members" element={<RequireAuth><MembersPage /></RequireAuth>} />
          <Route path="/o/:slug/team" element={<RequireAuth><TeamPage /></RequireAuth>} />
          <Route path="/o/:slug/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
          <Route path="/o/:slug/events" element={<RequireAuth><EventsPage /></RequireAuth>} />
          <Route path="/o/:slug/events/:eventId" element={<RequireAuth><EventPage /></RequireAuth>} />
          <Route path="/o/:slug/events/:eventId/screen" element={<RequireAuth><TableScreenPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <main className="min-h-screen bg-stone-50 flex items-center justify-center text-stone-400">
        載入中…
      </main>
    );
  }
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
