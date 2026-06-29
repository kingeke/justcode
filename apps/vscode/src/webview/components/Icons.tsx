import * as React from 'react';

/**
 * Inline SVG icons drawn with `currentColor`, so they inherit text color and
 * VSCode theming without shipping an icon font (which would need a relaxed CSP
 * font-src and an extra asset). Sized 16px by default.
 */

type IconProps = { size?: number };

function svgProps(size: number): React.SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };
}

export function PlusIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function TrashIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" />
    </svg>
  );
}

export function CodeIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" />
    </svg>
  );
}

export function SlidersIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M5 8h9M18 8h1M5 16h1M10 16h9" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="8" cy="16" r="2" />
    </svg>
  );
}

export function SendIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M19 7v3a3 3 0 0 1-3 3H6" />
      <path d="M9 9l-4 4 4 4" />
    </svg>
  );
}

export function StopIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
    </svg>
  );
}

export function MonitorIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

export function ShieldIcon({ size = 14 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M12 3l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V6l7-3z" />
    </svg>
  );
}

export function CogIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" />
    </svg>
  );
}

export function ChevronLeftIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}
