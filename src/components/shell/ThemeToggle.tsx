import { useTheme, type ThemePref } from '@/hooks/useTheme';
import { cn } from '@/lib/cn';
import { IconMonitor, IconMoon, IconSun } from '../ui/Icons';

const OPTIONS: { value: ThemePref; label: string; Icon: typeof IconSun }[] = [
  { value: 'system', label: 'Use system theme', Icon: IconMonitor },
  { value: 'light', label: 'Light theme', Icon: IconSun },
  { value: 'dark', label: 'Dark theme', Icon: IconMoon },
];

export function ThemeToggle({ className }: { className?: string }) {
  const { pref, setPref } = useTheme();
  return (
    <div className={cn('inline-flex rounded-lg border border-border bg-surface-2 p-0.5', className)} role="group" aria-label="Theme">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => setPref(value)}
          aria-label={label}
          aria-pressed={pref === value}
          title={label}
          className={cn(
            'grid size-7 cursor-pointer place-items-center rounded-md transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-accent',
            pref === value ? 'bg-surface text-fg shadow-xs' : 'text-muted hover:text-fg',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
