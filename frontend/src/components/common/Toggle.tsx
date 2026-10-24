import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export const Toggle = forwardRef<HTMLInputElement, ToggleProps>(
  ({ checked, onChange, label, disabled, className }, ref) => {
    return (
      <label className={cn('toggle inline-flex items-center gap-2 cursor-pointer', className)}>
        <input
          ref={ref}
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <span className={cn(
          'toggle-slider w-10 h-6 border transition-colors duration-150 relative',
          checked 
            ? 'bg-accent-red border-accent-red' 
            : 'bg-card-border border-card-border'
        )}>
          <span className={cn(
            'absolute w-5 h-5 bg-fg-primary transition-transform duration-150 rounded-none',
            checked ? 'translate-x-[24px]' : 'translate-x-[1px]'
          )} />
        </span>
        {label && <span className="font-micro text-micro-base text-fg-primary">{label}</span>}
      </label>
    );
  }
);

Toggle.displayName = 'Toggle';