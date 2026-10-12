import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { AppProvider } from './contexts/AppContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';
import PageLoader from './components/PageLoader';

const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const AppLayout = lazy(() => import('./components/AppLayout'));
const WorkflowPage = lazy(() => import('./pages/WorkflowPage'));
const MobileHomePage = lazy(() => import('./mobile/pages/MobileHomePage'));
const MobileTasksPage = lazy(() => import('./mobile/pages/MobileTasksPage'));
const MobileTaskDetailPage = lazy(() => import('./mobile/pages/MobileTaskDetailPage'));
const MobileInstancesPage = lazy(() => import('./mobile/pages/MobileInstancesPage'));
const MobileInstanceDetailPage = lazy(() => import('./mobile/pages/MobileInstanceDetailPage'));
const MobileNotificationsPage = lazy(() => import('./mobile/pages/MobileNotificationsPage'));
const MobileShell = lazy(() => import('./mobile/layouts/MobileShell'));
const SettingsLayout = lazy(() => import('./pages/settings/SettingsLayout'));
const AIModelsPage = lazy(() => import('./pages/settings/AIModelsPage'));
const AIAssistantsPage = lazy(() => import('./pages/settings/AIAssistantsPage'));
const AISkillsPage = lazy(() => import('./pages/settings/AISkillsPage'));
const UsersPage = lazy(() => import('./pages/settings/UsersPage'));

const withSuspense = (node: React.ReactNode) => (
  <Suspense fallback={<PageLoader />}>{node}</Suspense>
);

const basename = (import.meta.env.VITE_BASE_PATH || '/').replace(/\/$/, '') || undefined;

const App: React.FC = () => (
  <BrowserRouter basename={basename}>
    <AuthProvider>
      <AppProvider>
        <Toaster position="top-center" />
        <Routes>
          <Route path="/login" element={withSuspense(<LoginPage />)} />
          <Route path="/register" element={withSuspense(<RegisterPage />)} />
          <Route
            path="/workflows/*"
            element={
              <ProtectedRoute>
                {withSuspense(
                  <AppLayout>
                    <WorkflowPage />
                  </AppLayout>,
                )}
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                {withSuspense(
                  <AppLayout>
                    <SettingsLayout />
                  </AppLayout>,
                )}
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="models" replace />} />
            <Route path="models" element={withSuspense(<AIModelsPage />)} />
            <Route path="assistants" element={withSuspense(<AIAssistantsPage />)} />
            <Route path="skills" element={withSuspense(<AISkillsPage />)} />
            <Route
              path="users"
              element={
                <AdminRoute redirectTo="/settings/models">
                  {withSuspense(<UsersPage />)}
                </AdminRoute>
              }
            />
          </Route>

          {/* 移动端工作流门户 */}
          <Route path="/m" element={<ProtectedRoute>{withSuspense(<MobileShell />)}</ProtectedRoute>}>
            <Route index element={<Navigate to="/m/home" replace />} />
            <Route path="home" element={withSuspense(<MobileHomePage />)} />
            <Route path="tasks" element={withSuspense(<MobileTasksPage />)} />
            <Route path="tasks/:taskId" element={withSuspense(<MobileTaskDetailPage />)} />
            <Route path="instances" element={withSuspense(<MobileInstancesPage />)} />
            <Route path="instances/:instanceId" element={withSuspense(<MobileInstanceDetailPage />)} />
            <Route path="notifications" element={withSuspense(<MobileNotificationsPage />)} />
          </Route>

          <Route path="/" element={<Navigate to="/workflows" replace />} />
          <Route path="*" element={<Navigate to="/workflows" replace />} />
        </Routes>
      </AppProvider>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
