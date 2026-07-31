import { GRAIN_TEXTURE } from '../lib/textures';

/**
 * Full-bleed app chrome wrapper: sidebar + main fill the entire viewport,
 * edge to edge, sitting on a light greenish glass gradient that glows from
 * the bottom-left corner, with a fine grain overlay so it reads as frosted
 * glass rather than a flat gradient. Sidebar/main panels are translucent +
 * blurred (see bg-surface/NN + backdrop-blur usage in Sidebar/ThreadPage/etc)
 * so the textured gradient shows through as "glass". Used by every
 * authenticated page that renders the sidebar + main layout.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className='h-screen w-full relative overflow-hidden'
      style={{
        background: 'radial-gradient(140% 130% at 0% 100%, var(--color-glass-a) 0%, var(--color-glass-b) 55%, var(--color-glass-c) 100%)',
      }}
    >
      <div
        className='absolute inset-0 opacity-[0.05] dark:opacity-[0.08] mix-blend-overlay dark:mix-blend-soft-light pointer-events-none'
        style={{ backgroundImage: GRAIN_TEXTURE, backgroundSize: '180px 180px' }}
      />
      <div className='relative h-full w-full flex'>
        {children}
      </div>
    </div>
  );
}
