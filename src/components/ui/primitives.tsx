import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('min-w-0 rounded-xl border border-border bg-surface shadow-xs', className)} {...props} />;
}

export function CardHeader({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-border px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-balance text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-pretty text-muted">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

type Tone = 'neutral' | 'positive' | 'negative' | 'accent';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg',
  positive: 'text-positive',
  negative: 'text-negative',
  accent: 'text-accent',
};

export function Stat({ label, value, hint, tone = 'neutral', className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cn('min-w-0 rounded-xl border border-border bg-surface px-4 py-3 shadow-xs', className)}>
      <div className="truncate text-xs text-muted">{label}</div>
      <div className={cn('mt-1 truncate font-mono text-xl font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-subtle">{hint}</div>}
    </div>
  );
}

const BADGE: Record<Tone, string> = {
  neutral: 'border border-border text-muted',
  positive: 'bg-positive-soft text-positive',
  negative: 'bg-negative-soft text-negative',
  accent: 'bg-accent-soft text-accent',
};

export function Badge({ tone = 'neutral', className, children, ...props }: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap', BADGE[tone], className)} {...props}>
      {children}
    </span>
  );
}

const BUTTON_VARIANT = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'border border-border bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-muted hover:bg-surface-2 hover:text-fg',
} as const;

const BUTTON_SIZE = {
  sm: 'h-8 px-2.5 text-xs',
  md: 'h-9 px-3 text-sm',
  icon: 'size-9',
} as const;

export const buttonClass = (variant: keyof typeof BUTTON_VARIANT = 'secondary', size: keyof typeof BUTTON_SIZE = 'md', className?: string) =>
  cn(
    'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50',
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  );

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  type = 'button',
  ...props
}: ComponentProps<'button'> & { variant?: keyof typeof BUTTON_VARIANT; size?: keyof typeof BUTTON_SIZE }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:opacity-50',
        BUTTON_VARIANT[variant],
        BUTTON_SIZE[size],
        className,
      )}
      {...props}
    />
  );
}

export function StatusDot({ tone }: { tone: 'positive' | 'negative' | 'accent' | 'neutral' }) {
  const color = { positive: 'bg-positive', negative: 'bg-negative', accent: 'bg-accent', neutral: 'bg-subtle' }[tone];
  return <span className={cn('inline-block size-2 shrink-0 rounded-full', color)} aria-hidden />;
}

/** Horizontal bar; the fill moves with transform only. */
export function Meter({ value, className, label }: { value: number; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-2', className)} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-label={label}>
      <div className="h-full w-full origin-left rounded-full bg-accent transition-transform duration-200 ease-out" style={{ transform: `scaleX(${v})` }} />
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-xs font-medium text-muted">{children}</div>;
}
