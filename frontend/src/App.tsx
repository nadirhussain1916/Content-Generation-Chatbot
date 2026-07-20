import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SignedIn, SignedOut, RedirectToSignIn } from '@clerk/clerk-react';
import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import WorkspacePage from './pages/WorkspacePage';
import ThreadPage from './pages/ThreadPage';
import SettingsPage from './pages/SettingsPage';
import GenerationsPage from './pages/GenerationsPage';
import AuthGuard from './components/AuthGuard';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path='/' element={<LandingPage />} />

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

        {/* Redirect signed-out users to sign-in */}
        <Route
          path='/workspaces/*'
          element={
            <SignedOut>
              <RedirectToSignIn />
            </SignedOut>
          }
        />

        <Route path='*' element={<Navigate to='/' replace />} />
      </Routes>
    </BrowserRouter>
  );
}
