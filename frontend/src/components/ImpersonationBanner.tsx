import { ShieldAlert, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useImpersonation } from '../context/ImpersonationContext';

export function ImpersonationBanner() {
  const { isImpersonating, impersonatedUser, stopImpersonation } = useImpersonation();
  const navigate = useNavigate();

  if (!isImpersonating || !impersonatedUser) return null;

  const handleExit = () => {
    stopImpersonation();
    navigate('/admin');
  };

  const displayName = impersonatedUser.name ?? impersonatedUser.email ?? impersonatedUser.id;
  const subLabel = impersonatedUser.name && impersonatedUser.email ? impersonatedUser.email : null;

  return (
    <div className='fixed top-0 inset-x-0 z-[9999] flex items-center justify-between gap-3 bg-red-600 px-4 py-2 text-white shadow-lg'>
      <div className='flex items-center gap-2 min-w-0'>
        <ShieldAlert className='w-4 h-4 shrink-0' />
        <span className='text-sm font-semibold truncate'>
          Impersonating{' '}
          <span className='font-bold'>{displayName}</span>
          {subLabel && (
            <span className='hidden sm:inline font-normal opacity-80 ml-1'>({subLabel})</span>
          )}
        </span>
      </div>
      <button
        onClick={handleExit}
        className='flex items-center gap-1.5 shrink-0 rounded-lg bg-white/20 px-3 py-1 text-xs font-bold hover:bg-white/30 transition-colors'
      >
        <X className='w-3.5 h-3.5' />
        Exit
      </button>
    </div>
  );
}
