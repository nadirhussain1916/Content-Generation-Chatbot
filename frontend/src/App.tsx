import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn, useAuth, useUser } from '@clerk/clerk-react';
import { useImpersonation } from './context/ImpersonationContext';
import { ImpersonationBanner } from './components/ImpersonationBanner';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import WorkspacePage from './pages/WorkspacePage';
import ThreadPage from './pages/ThreadPage';
import SettingsPage from './pages/SettingsPage';
import GenerationsPage from './pages/GenerationsPage';
import ModelsPage from './pages/ModelsPage';
import AdminPage from './pages/AdminPage';
import AuthGuard from './components/AuthGuard';
import TermsPage from './pages/TermsPage';
import PrivacyPage from './pages/PrivacyPage';

const SUPER_ADMIN_EMAIL = 'zaibchahal@gmail.com';

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();

  if (!isLoaded) return null;
  if (!isSignedIn) return <RedirectToSignIn />;

  const email = user?.primaryEmailAddress?.emailAddress;
  if (email !== SUPER_ADMIN_EMAIL) return <Navigate to='/' replace />;

  return <>{children}</>;
}

function ImpersonationSpacer() {
  const { isImpersonating } = useImpersonation();
  if (!isImpersonating) return null;
  // Reserves space equal to the banner height so sticky headers stay below it.
  return <div className='h-10 w-full shrink-0' aria-hidden />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ImpersonationBanner />
      <ImpersonationSpacer />
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

        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </BrowserRouter>
  );
}
