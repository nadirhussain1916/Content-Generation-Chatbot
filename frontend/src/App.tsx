import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, useAuth, useUser } from '@clerk/clerk-react';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import WorkspacePage from './pages/WorkspacePage';
import ThreadPage from './pages/ThreadPage';
import SettingsPage from './pages/SettingsPage';
import GenerationsPage from './pages/GenerationsPage';
import ModelsPage from './pages/ModelsPage';
import BillingPage from './pages/BillingPage';
import AdminPage from './pages/AdminPage';
import AdminUsagePage from './pages/AdminUsagePage';
import AdminStitchTestPage from './pages/AdminStitchTestPage';
import AdminMockPage from './pages/AdminMockPage';
import AdminMigrationsPage from './pages/AdminMigrationsPage';
import AuthGuard from './components/AuthGuard';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';

const SUPER_ADMIN_EMAILS = [
  'zaibchahal@gmail.com',
  'nadirhussain03000@gmail.com',
  'troy.paige@globalsolutionsmanagement.net',
].map((e) => e.toLowerCase());

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  if (!isLoaded) return null;
  if (!isSignedIn) return <RedirectToSignIn />;

  const email = user?.primaryEmailAddress?.emailAddress?.toLowerCase();
  if (!email || !SUPER_ADMIN_EMAILS.includes(email)) return <Navigate to='/' replace />;

  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path='/' element={<LandingPage />} />
        <Route path='/home' element={<LandingPage noRedirect />} />
        <Route path='/terms' element={<TermsPage />} />
        <Route path='/privacy' element={<PrivacyPage />} />

        {/* Auth-required */}
        <Route
          path='/onboarding'
          element={
            <SignedIn>
              <OnboardingPage />
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug'
          element={
            <SignedIn>
              <AuthGuard>
                <WorkspacePage />
              </AuthGuard>
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug/threads/:threadId'
          element={
            <SignedIn>
              <AuthGuard>
                <ThreadPage />
              </AuthGuard>
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug/settings'
          element={
            <SignedIn>
              <AuthGuard>
                <SettingsPage />
              </AuthGuard>
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug/generations'
          element={
            <SignedIn>
              <AuthGuard>
                <GenerationsPage />
              </AuthGuard>
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug/models'
          element={
            <SignedIn>
              <AuthGuard>
                <ModelsPage />
              </AuthGuard>
            </SignedIn>
          }
        />
        <Route
          path='/workspaces/:slug/billing'
          element={
            <SignedIn>
              <AuthGuard>
                <BillingPage />
              </AuthGuard>
            </SignedIn>
          }
        />

        {/* Redirect signed-out users to sign-in */}
        <Route
          path='/workspaces/*'
          element={
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          }
        />

        {/* Super admin panel */}
        <Route
          path='/admin'
          element={
            <SuperAdminRoute>
              <AdminPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path='/admin/usage'
          element={
            <SuperAdminRoute>
              <AdminUsagePage />
            </SuperAdminRoute>
          }
        />
        <Route
          path='/admin/stitch'
          element={
            <SuperAdminRoute>
              <AdminStitchTestPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path='/admin/migrations'
          element={
            <SuperAdminRoute>
              <AdminMigrationsPage />
            </SuperAdminRoute>
          }
        />
        <Route
          path='/admin/mock'
          element={
            <SuperAdminRoute>
              <AdminMockPage />
            </SuperAdminRoute>
          }
        />

        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </BrowserRouter>
  );
}
