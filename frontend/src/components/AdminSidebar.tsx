import { Link, useLocation, useNavigate } from 'react-router-dom';
import { UserButton } from '@clerk/clerk-react';
import { ShieldCheck, Users, CreditCard, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import ThemeToggle from './ThemeToggle';

const NAV: { to: string; label: string; icon: React.ElementType; exact?: boolean }[] = [
  { to: '/admin', label: 'Users', icon: Users, exact: true },
  { to: '/admin/usage', label: 'Usage & Billing', icon: CreditCard },
];

/**
 * Navigation sidebar for the super-admin section — mirrors the user-facing
 * Sidebar chrome (translucent glass panel, footer with account + theme) so
 * the admin area feels like part of the same app.
 */
export default function AdminSidebar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <aside className='w-64 flex-shrink-0 bg-surface/70 backdrop-blur-xl border-r border-border-soft/60 flex flex-col h-full'>
      {/* Brand */}
      <div className='p-4 border-b border-border-soft'>
        <div className='flex items-center gap-2 p-2'>
          <div className='w-7 h-7 rounded-lg bg-ink flex items-center justify-center flex-shrink-0'>
            <ShieldCheck size={14} className='text-on-ink' />
          </div>
          <div className='min-w-0'>
            <p className='text-message font-semibold text-text-primary leading-tight'>Super Admin</p>
            <p className='text-meta text-text-muted leading-tight'>Control panel</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className='flex-1 overflow-y-auto p-3 space-y-1'>
        {NAV.map(({ to, label, icon: Icon, exact }) => {
          const active = exact ? pathname === to : pathname.startsWith(to);
          return (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-xl text-message font-medium transition-colors',
                active
                  ? 'bg-surface-card text-text-primary'
                  : 'text-text-secondary hover:bg-surface-card/60 hover:text-text-primary'
              )}
            >
              <Icon size={16} className={active ? 'text-brand' : 'text-text-muted'} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Back to app */}
      <div className='p-3'>
        <button
          onClick={() => navigate('/')}
          className='w-full flex items-center gap-2 px-3 py-2 rounded-xl text-message text-text-secondary hover:bg-surface-card/60 hover:text-text-primary transition-colors'
        >
          <ArrowLeft size={15} /> Back to app
        </button>
      </div>

      {/* Footer */}
      <div className='p-3 border-t border-border-soft flex items-center justify-between'>
        <UserButton />
        <ThemeToggle />
      </div>
    </aside>
  );
}
