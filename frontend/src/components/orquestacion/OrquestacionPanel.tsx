import { useOrquestacion } from '@/hooks/useOrquestacion';
import { Card } from '@/components/common';
import { cn, formatTokens } from '@/lib/utils';

export function OrquestacionPanel() {
  const { data, isLoading, error } = useOrquestacion();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center text-muted">Cargando...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center text-error">
        Error al cargar datos
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card p-6 text-center">
        <div className="text-muted mb-2">Sin datos</div>
      </div>
    );
  }

  const utilization = data.techo.tokens && data.consumo.tokens 
    ? Math.min(100, (data.consumo.tokens / data.techo.tokens) * 100) 
    : 0;

  return (
    <div className="space-y-4">
      {/* TECHO */}
      <Card 
        title="TECHO" 
        subtitle={`Rondas: ${data.techo.rondas} • Tokens: ${formatTokens(data.techo.tokens)}`}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-muted mb-1">Rondas</div>
            <div className="font-mono text-text">{data.techo.rondas}</div>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Tokens</div>
            <div className="font-mono text-text">{data.techo.tokens?.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Calls</div>
            <div className="font-mono text-text">{data.techo.calls}</div>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Reserva 20%</div>
            <div className="font-mono text-text">{Math.floor((data.techo.tokens || 0) * 0.8).toLocaleString()}</div>
          </div>
        </div>
      </Card>

      {/* CONSUMO */}
      <Card 
        title="CONSUMO" 
        subtitle="Tokens medidos"
      >
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <div className="text-xs text-muted mb-1">Tokens</div>
            <div className="font-mono text-text">{formatTokens(data.consumo.tokens || 0)}</div>
          </div>
          <div>
            <div className="text-xs text-muted mb-1">Calls</div>
            <div className="font-mono text-text">{data.consumo.calls}</div>
          </div>
        </div>
        
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted">Uso: {utilization.toFixed(1)}%</span>
            <div className="flex-1 h-1.5 bg-line rounded-full overflow-hidden">
              <div 
                className="h-full transition-all"
                style={{ 
                  width: `${utilization}%`,
                  backgroundColor: utilization > 80 
                    ? '#f7768e' 
                    : utilization > 60 
                      ? '#e0af68' 
                      : '#9ece6a'
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* TAREAS */}
      <Card 
        title="TAREAS" 
        subtitle={`Total: ${data.tareas?.reduce((s: number, t: any) => s + t.n, 0) || 0}`}
      >
        <div className="grid grid-cols-4 gap-2">
          {data.tareas?.map((t: any) => (
            <div key={t.estado} className="text-center">
              <div className="text-xs text-muted uppercase">{t.estado}</div>
              <div className="font-mono text-text text-lg">{t.n}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* APROBACIONES */}
      <Card 
        title="APROBACIONES" 
        subtitle={data.aprobaciones?.length > 0 
          ? `${data.aprobaciones.length} pendientes` 
          : 'Sin aprobaciones'}
      >
        {data.aprobaciones && data.aprobaciones.length > 0 ? (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {data.aprobaciones.slice(0, 5).map((a: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2 bg-bg-tertiary rounded">
                <div>
                  <span className="font-mono text-xs text-muted">{a.id}</span>
                  <span className="text-xs text-muted mx-2">({a.tool})</span>
                  <span className={cn(
                    'px-2 py-0.5 text-xs rounded font-mono',
                    a.riesgo === 'alto' ? 'bg-error/10 text-error border border-error/30' 
                    : a.riesgo === 'medio' ? 'bg-warning/10 text-warning border border-warning/30' 
                    : 'bg-success/10 text-success border border-success/30'
                  )}>
                    {a.riesgo.toUpperCase()}
                  </span>
                </div>
                <span className="text-xs text-muted">{a.estado}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-4 text-muted">
            Sin aprobaciones pendientes
          </div>
        )}
      </Card>
    </div>
  );
}