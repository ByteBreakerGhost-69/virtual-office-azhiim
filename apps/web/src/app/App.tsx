import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Loading } from '../components/ui.js';
import { LoginPage, SetupPage } from './AuthPages.js';
import { SessionProvider, useAuthStatus } from './session.js';
import { Shell } from './Shell.js';

const Overview = lazy(() => import('../features/overview/OverviewPage.js'));
const OfficePage = lazy(() => import('../features/office/OfficePage.js'));
const AgentsPage = lazy(() => import('../features/agents/AgentsPage.js'));
const TasksPage = lazy(() => import('../features/tasks/TasksPage.js'));
const TaskDetailPage = lazy(() => import('../features/tasks/TaskDetailPage.js'));
const OrganizationPage = lazy(() => import('../features/organization/OrganizationPage.js'));
const ActivityPage = lazy(() => import('../features/activity/ActivityPage.js'));
const ApprovalsPage = lazy(() => import('../features/approvals/ApprovalsPage.js'));
const IntegrationsPage = lazy(() => import('../features/integrations/IntegrationsPage.js'));
const SettingsPage = lazy(() => import('../features/settings/SettingsPage.js'));
const ProjectsPage = lazy(() => import('../features/projects/ProjectsPage.js'));
const HivePage = lazy(() => import('../features/projects/HivePage.js'));

export function App() {
  const auth = useAuthStatus();
  if (auth.isLoading) return <Loading />;
  if (auth.data?.setupRequired) return <SetupPage />;
  if (!auth.data?.authenticated) return <LoginPage />;
  return (
    <SessionProvider>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<Navigate to="/office" replace />} />
            <Route path="/overview" element={<Overview />} />
            <Route path="/office" element={<OfficePage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/tasks/:id" element={<TaskDetailPage />} />
            <Route path="/organization" element={<OrganizationPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/approvals" element={<ApprovalsPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/hive" element={<HivePage />} />
            <Route path="*" element={<Navigate to="/office" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </SessionProvider>
  );
}
