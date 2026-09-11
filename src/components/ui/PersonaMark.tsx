import type { Persona } from '@/config/personas';

/** Generated logo: the persona's initial inside a small jar, in its accent colour. */
export function PersonaMark({ persona, className = 'h-14 w-14' }: { persona: Persona; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} role="img" aria-label={`${persona.mascot} logo`}>
      <rect x="1" y="1" width="62" height="62" rx="13" fill="#0b1118" stroke={persona.accent.base} strokeOpacity="0.6" strokeWidth="1.5" />
      <rect x="21" y="9" width="22" height="5" rx="2" fill="#6b7686" />
      <path d="M17 17h30v29a8 8 0 0 1-8 8H25a8 8 0 0 1-8-8z" fill="none" stroke="#d4e0ee" strokeOpacity="0.35" strokeWidth="2" />
      <path d="M19.5 38h25v8a6 6 0 0 1-6 6h-13a6 6 0 0 1-6-6z" fill={persona.accent.base} fillOpacity="0.85" />
      <text x="32" y="36" textAnchor="middle" fontFamily="Fraunces Variable, Georgia, serif" fontWeight="700" fontSize="19" fill="#f1f6fa">
        {persona.mascot[0]}
      </text>
    </svg>
  );
}
