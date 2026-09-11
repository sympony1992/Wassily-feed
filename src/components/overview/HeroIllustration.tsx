import type { Persona } from '@/config/personas';

/** Static fallback for the hero media panel when no video is available. */
export function HeroIllustration({ persona, jar }: { persona: Persona; jar: number }) {
  const liquid = 62 * jar;
  return (
    <svg
      viewBox="0 0 800 450"
      preserveAspectRatio="xMidYMid slice"
      className="block size-full"
      role="img"
      aria-label={`${persona.mascot} at a desk; ${persona.mathematician}'s bound on a chalkboard; the jar is ${Math.round(jar * 100)}% full`}
    >
      <defs>
        <radialGradient id="heroLamp">
          <stop offset="0%" stopColor={persona.accent.base} stopOpacity="0.28" />
          <stop offset="100%" stopColor={persona.accent.base} stopOpacity="0" />
        </radialGradient>
        <clipPath id="heroJarClip">
          <path d="M4 10h52v52a10 10 0 0 1-10 10H14A10 10 0 0 1 4 62z" />
        </clipPath>
      </defs>

      <rect width="800" height="450" fill="#0b0f14" />
      <rect x="560" y="40" width="200" height="220" fill="#0f1823" stroke="#1f2b3a" strokeWidth="4" />
      <path d="M660 40v220M560 150h200" stroke="#1f2b3a" strokeWidth="3" />

      <rect x="40" y="44" width="480" height="220" rx="8" fill="#3a2a1c" />
      <rect x="50" y="54" width="460" height="200" rx="3" fill="#10231c" />
      <g fontFamily="JetBrains Mono Variable, monospace" fontSize="20" fill="#e6efe8">
        {persona.board.map((line, i) => (
          <text key={i} x="72" y={106 + i * 50} opacity="0.92">
            {line}
          </text>
        ))}
      </g>
      <text x="72" y="238" fontFamily="JetBrains Mono Variable, monospace" fontSize="11" fill="#8fae99">
        {persona.mathematician} · {persona.life}
      </text>

      <circle cx="620" cy="270" r="210" fill="url(#heroLamp)" />
      <rect x="0" y="346" width="800" height="104" fill="#140f0a" />
      <rect x="0" y="344" width="800" height="6" fill="#2b2016" />

      <ellipse cx="700" cy="346" rx="26" ry="5" fill="#20262e" />
      <path d="M700 344 674 276 622 246" stroke="#2b333d" strokeWidth="5" fill="none" strokeLinecap="round" />
      <path d="M598 236 650 220l10 34-50 12z" fill="#1b222a" stroke={persona.accent.base} strokeWidth="1.5" />

      <g transform="translate(150 272)">
        <rect x="10" y="0" width="40" height="8" rx="2" fill="#6b7686" />
        <path d="M4 10h52v52a10 10 0 0 1-10 10H14A10 10 0 0 1 4 62z" fill="#0b1118" fillOpacity="0.7" />
        <g clipPath="url(#heroJarClip)">
          <rect x="4" y={72 - liquid} width="52" height={liquid} fill={persona.accent.base} fillOpacity="0.85" />
        </g>
        <path d="M4 10h52v52a10 10 0 0 1-10 10H14A10 10 0 0 1 4 62z" fill="none" stroke="#d4e0ee" strokeOpacity="0.35" strokeWidth="2" />
      </g>

      <g transform="translate(400 276)">
        <rect x="24" y="-44" width="84" height="56" fill="#e9e4d6" opacity="0.92" />
        <rect x="10" y="4" width="112" height="10" rx="5" fill="#0e1318" />
        <rect x="0" y="12" width="132" height="60" rx="10" fill="#1e252e" stroke="#2e3945" />
      </g>
      <path d="M270 350c0-62 32-86 78-86s78 24 78 86z" fill="#0b1016" />
      <path d="M408 314c26 0 38-10 50-20" stroke="#0b1016" strokeWidth="16" strokeLinecap="round" fill="none" />
      <circle cx="348" cy="228" r="32" fill="#0b1016" />
    </svg>
  );
}
