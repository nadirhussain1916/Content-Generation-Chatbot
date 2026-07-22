import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider } from '@clerk/clerk-react';
import { dark } from '@clerk/themes';
import App from './App';
import './index.css';

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!PUBLISHABLE_KEY) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      afterSignOutUrl='/'
      signInUrl='/'
      signUpUrl='/'
      appearance={{ baseTheme: dark }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>
);
