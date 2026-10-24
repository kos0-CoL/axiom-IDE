import { cn } from '@/lib/utils';

interface ChipProps {
  children: React.ReactNode;
  removable?: boolean;
  onRemove?: () => void;
  className?: string;
}

export function Chip({ children, className }: ChipProps) {
  return (
    <span className={cn('chip', className || '')}>
      {children}
    </span>
  );
}