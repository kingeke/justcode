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

export function PencilIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M4 20h4l10-10a2 2 0 0 0-4-4L4 16v4zM13.5 6.5l4 4" />
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

export function ChevronDownIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M5 12l5 5L19 7" />
    </svg>
  );
}

export function UndoIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M9 7L4 12l5 5" />
      <path d="M4 12h11a5 5 0 0 1 5 5v1" />
    </svg>
  );
}

/** Curly braces — used for "view chat log" (the raw chat.json). */
export function JsonIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M8 4a3 3 0 0 0-3 3v2a2 2 0 0 1-2 2 2 2 0 0 1 2 2v2a3 3 0 0 0 3 3" />
      <path d="M16 4a3 3 0 0 1 3 3v2a2 2 0 0 0 2 2 2 2 0 0 0-2 2v2a3 3 0 0 1-3 3" />
    </svg>
  );
}

/** Circular arrows — used for a manual model-list refresh. */
export function RefreshIcon({ size = 16 }: IconProps): React.JSX.Element {
  return (
    <svg {...svgProps(size)} aria-hidden="true">
      <path d="M20 11a8 8 0 0 0-14-4.5L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14 4.5L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}
