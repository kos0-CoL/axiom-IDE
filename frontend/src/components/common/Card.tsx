import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  subtitle?: string;
}

export function Card({ children, className, title, subtitle }: CardProps) {
  return (
    <div className={`bg-gray-900 border border-gray-700 ${className || ''}`}>
      {(title || subtitle) && (
        <div className="px-4 py-3 border-b border-gray-700">
          {title && <h3 className="text-lg font-bold text-white uppercase tracking-wider">{title}</h3>}
          {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function CardGrid({ children, className, columns = 2 }: { children: React.ReactNode; className?: string; columns?: number }) {
  return <div className={`grid grid-cols-${columns} gap-4 ${className || ''}`}>{children}</div>;
}

export function CardField({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-xs text-gray-400 uppercase tracking-wider">{label}</div>
      <div className="text-lg font-mono text-white mt-1">{value}</div>
    </div>
  );
}
