import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'base' | 'lg';
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'base', loading, disabled, children, ...props }, ref) => {
    const variants = {
      primary: 'bg-red-500 text-white hover:bg-red-600',
      secondary: 'bg-gray-800 text-white border border-gray-700 hover:bg-gray-700',
      danger: 'bg-red-600 text-white hover:bg-red-700',
      ghost: 'bg-transparent text-gray-300 hover:bg-gray-800',
    };
    const sizes = { sm: 'px-2 py-1 text-xs', base: 'px-3 py-2 text-sm', lg: 'px-4 py-3 text-base' };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-mono text-xs font-medium rounded-none transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          variants[variant],
          { sm: 'px-2 py-1 text-xs', base: 'px-3 py-2 text-sm', lg: 'px-4 py-3 text-base' }[size],
          className
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M12 2C12 2 12 2 12 2"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite" /></path></svg>
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
