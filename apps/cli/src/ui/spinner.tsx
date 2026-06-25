import React, { useEffect, useState } from 'react';

// Braille "dots" frames — the same animation ink-spinner used by default.
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const INTERVAL_MS = 80;

export interface SpinnerProps {
  readonly fg?: string;
}

/**
 * Minimal animated spinner rendered as an OpenTUI <text>, replacing ink-spinner.
 */
export function Spinner({ fg }: SpinnerProps): React.ReactNode {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setFrame((previous) => (previous + 1) % FRAMES.length);
    }, INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return <text fg={fg ?? 'cyan'}>{FRAMES[frame]}</text>;
}
