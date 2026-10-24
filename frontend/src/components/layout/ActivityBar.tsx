import { useOrquestacion } from '@/hooks/useOrquestacion';
import { Button } from '@/components/common';

export function ActivityBar() {
  const { data: orq } = useOrquestacion();

  if (!orq) return null;

  return (
    <div className="h-6 bg-panel-bg border-t border-line flex items-center px-4 gap-4 text-xs">
      {/* Techo info */}
      <div className="flex items-center gap-3">
        <span className="text-muted">Techo:</span>
        <span className="font-mono text-text">
          {orq.techo.tokens?.toLocaleString()} tokens
        </span>
        <span className="text-muted">|</span>
        <span className="font-mono text-text">{orq.techo.rondas} rondas</span>
        <span className="text-muted">|</span>
        <span className="font-mono text-text">{orq.techo.calls} calls</span>
      </div>

      {/* Consumo info */}
      <div className="flex items-center gap-3">
        <span className="text-muted">Consumo:</span>
        <span className="font-mono text-text">
          {orq.consumo.tokens?.toLocaleString()} tokens
        </span>
        <span className="text-muted">|</span>
        <span className="font-mono text-text">{orq.consumo.calls} calls</span>
      </div>

      {/* Tareas */}
      {orq.tareas && (
        <div className="flex items-center gap-2">
          <span className="text-muted">Tareas:</span>
          <span className="font-mono text-text">
            {orq.tareas.reduce((s: number, t: any) => s + t.n, 0)} total
          </span>
        </div>
      )}

      {/* Aprovaciones */}
      {orq.aprobaciones && orq.aprobaciones.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-muted">Aprobaciones:</span>
          <span className="font-mono text-warning">
            {orq.aprobaciones.filter((a: any) => a.estado === 'pendiente').length} pendientes
          </span>
        </div>
      )}

      {/* Progress bar */}
      {orq.techo.tokens && orq.consumo.tokens && (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted whitespace-nowrap">Uso</span>
          <div className="w-24 h-1.5 bg-line rounded-full overflow-hidden">
            <div 
              className="h-full transition-all"
              style={{ 
                width: `${Math.min(100, (orq.consumo.tokens / orq.techo.tokens) * 100)}%`,
                backgroundColor: orq.consumo.tokens > orq.techo.tokens * 0.8 
                  ? '#f7768e' 
                  : '#7aa2f7'
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}