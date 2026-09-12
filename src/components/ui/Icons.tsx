type IconProps = { className?: string };

const svg = (className = 'size-4') => ({
  className: `inline-block shrink-0 ${className}`,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
});

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const IconGitHub = ({ className }: IconProps) => (
  <svg {...svg(className)} fill="currentColor">
    <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
  </svg>
);

export const IconX = ({ className }: IconProps) => (
  <svg {...svg(className)} fill="currentColor">
    <path d="M18.9 2H22l-6.8 7.8L23 22h-6.2l-4.8-6.3L6.4 22H3.3l7.3-8.3L1 2h6.3l4.4 5.8L18.9 2Zm-1.1 18h1.7L6.3 3.9H4.5L17.8 20Z" />
  </svg>
);

export const IconCopy = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const IconCheck = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke} strokeWidth={2.5}>
    <path d="M5 12.5 10 17 19 7" />
  </svg>
);

export const IconWarning = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    <path d="M12 9v4M12 17h.01" />
  </svg>
);

export const IconDownload = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
  </svg>
);

export const IconFileCode = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6M10 13l-2 2 2 2M14 13l2 2-2 2" />
  </svg>
);

export const IconFastForward = ({ className }: IconProps) => (
  <svg {...svg(className)} fill="currentColor">
    <path d="M13 19l9-7-9-7v14ZM2 19l9-7-9-7v14Z" />
  </svg>
);

export const IconReset = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M1 4v6h6" />
    <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
  </svg>
);

export const IconSync = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M21 12a9 9 0 0 1-15.4 6.4L3 16M3 12a9 9 0 0 1 15.4-6.4L21 8M21 3v5h-5M3 21v-5h5" />
  </svg>
);

export const IconSliders = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
  </svg>
);

export const IconShield = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

export const IconBars = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconClose = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export const IconGrid = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);

export const IconTerminal = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <rect x="2" y="4" width="20" height="16" rx="2" />
    <path d="m6 9 3 3-3 3M12 15h6" />
  </svg>
);

export const IconSparkles = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.4l-1.8-4.9L5 9.7l5.2-1.8z" />
    <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
  </svg>
);

export const IconInfo = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 11v6M12 7.5h.01" />
  </svg>
);

export const IconFlask = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M9 3h6M10 3v6.5L4.6 18.6A1.6 1.6 0 0 0 6 21h12a1.6 1.6 0 0 0 1.4-2.4L14 9.5V3" />
    <path d="M7.5 15h9" />
  </svg>
);

export const IconBot = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <rect x="4" y="8" width="16" height="12" rx="3" />
    <path d="M12 8V4.5M9 13.5h.01M15 13.5h.01M9.5 17h5M2 13v3M22 13v3" />
  </svg>
);

export const IconSun = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);

export const IconMoon = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
  </svg>
);

export const IconMonitor = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export const IconMenu = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
);

export const IconChevronDown = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

export const IconArrowRight = ({ className }: IconProps) => (
  <svg {...svg(className)} {...stroke}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconPause = ({ className }: IconProps) => (
  <svg {...svg(className)} fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const IconPlay = ({ className }: IconProps) => (
  <svg {...svg(className)} fill="currentColor">
    <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5Z" />
  </svg>
);
