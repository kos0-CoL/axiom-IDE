import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  position?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export function Tooltip({ content, children, position = 'top', delay = 200 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const childRef = useRef<HTMLElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const show = () => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  };

  const hide = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  };

  useEffect(() => {
    const el = childRef.current;
    if (!el) return;
    el.addEventListener('mouseenter', show);
    el.addEventListener('focus', show);
    el.addEventListener('mouseleave', hide);
    el.addEventListener('blur', hide);
    return () => {
      el.removeEventListener('mouseenter', show);
      el.removeEventListener('focus', show);
      el.removeEventListener('mouseleave', hide);
      el.removeEventListener('blur', hide);
    };
  }, []);

  const positions = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrows = {
    top: 'top-full left-1/2 -translate-x-1/2 border-t-border border-transparent border-r-transparent border-l-transparent',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-b-border border-transparent border-r-transparent border-l-transparent',
    left: 'right-full top-1/2 -translate-y-1/2 border-l-border border-transparent border-t-transparent border-b-transparent',
    right: 'left-full top-1/2 -translate-y-1/2 border-r-border border-transparent border-t-transparent border-b-transparent',
  };

  return (
    <>
      <span ref={childRef} tabIndex={0}>
        {children}
      </span>
      {visible && (
        <div
          ref={tooltipRef}
          className={cn(
            'tooltip absolute z-50 px-2 py-1 text-micro-sm font-micro whitespace-nowrap',
            'bg-substrate-elevated border border-card-border text-fg-primary',
            positions[position]
          )}
          role="tooltip"
        >
          {content}
          <div className={cn('absolute w-0 h-0 border-4 border-solid', arrows[position])} />
        </div>
      )}
    </>
  );
}