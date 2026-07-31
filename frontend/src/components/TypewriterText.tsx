import { useEffect, useState } from 'react';

interface TypewriterTextProps {
  lines: string[];
  typingSpeedMs?: number;
  deletingSpeedMs?: number;
  pauseMs?: number;
  className?: string;
}

/** Cycles through `lines`, typing each one out, pausing, then deleting it before moving to the next — loops forever. */
export default function TypewriterText({
  lines,
  typingSpeedMs = 45,
  deletingSpeedMs = 25,
  pauseMs = 1800,
  className,
}: TypewriterTextProps) {
  const [lineIndex, setLineIndex] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const current = lines[lineIndex] ?? '';
    let timeout: ReturnType<typeof setTimeout>;

    if (!isDeleting && charCount === current.length) {
      timeout = setTimeout(() => setIsDeleting(true), pauseMs);
    } else if (isDeleting && charCount === 0) {
      setIsDeleting(false);
      setLineIndex((i) => (i + 1) % lines.length);
    } else {
      timeout = setTimeout(() => {
        setCharCount((c) => c + (isDeleting ? -1 : 1));
      }, isDeleting ? deletingSpeedMs : typingSpeedMs);
    }

    return () => clearTimeout(timeout);
  }, [charCount, isDeleting, lineIndex, lines, typingSpeedMs, deletingSpeedMs, pauseMs]);

  return (
    <span className={className}>
      {(lines[lineIndex] ?? '').slice(0, charCount)}
      <span className='inline-block w-[2px] h-[0.9em] bg-current ml-1 align-middle animate-pulse' aria-hidden='true' />
    </span>
  );
}
