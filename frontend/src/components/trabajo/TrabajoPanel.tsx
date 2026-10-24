import { useTrabajo } from '@/hooks/useTrabajo';
import { Card, Button } from '@/components/common';
import { cn } from '@/lib/utils';

export function TrabajoPanel() {
  const { data, isLoading, error } = useTrabajo();

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
        Error al cargar
      </div>
    );
  }

  if (!data?.specs || data.specs.length === 0) {
    return (
      <div className="card p-6 text-center">
        <div className="text-muted mb-2">No hay specs</div>
        <button className="btn btn-secondary">Crear nuevo spec</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {data.specs.map(spec => (
        <Card 
          key={spec.id} 
          title={`[ ${spec.id}:${spec.ver} ] ${spec.title}`} 
          subtitle={`tareas: ${spec.tareas.length} • ${spec.status || 'activo'}`}
        >
          <div className="mb-4 flex gap-2">
            <Button variant="secondary" size="sm">
              Dry-run
            </Button>
            <Button variant="primary" size="sm">
              Run (agente)
            </Button>
          </div>

          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left">
                <th className="px-3 py-2 text-muted uppercase tracking-wide">ID</th>
                <th className="px-3 py-2 text-muted uppercase tracking-wide">ESCENARIO</th>
                <th className="px-3 py-2 text-muted uppercase tracking-wide">ESTADO</th>
                <th className="px-3 py-2 text-muted uppercase tracking-wide">ARCHIVOS</th>
              </tr>
            </thead>
            <tbody>
              {spec.tareas.map((task: any, i: number) => {
                const estadoClass = task.estado === 'verificado' 
                  ? 'chip-success'
                  : task.estado === 'bloqueado' 
                    ? 'chip-error' 
                    : 'chip-warning';
                return (
                  <tr key={task.id} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-muted">
                      {task.id || `t-${i+1}`}
                    </td>
                    <td className="px-3 py-2 text-muted max-w-xs truncate">
                      {spec.tareas[i]?.id || '—'}
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn('chip', estadoClass)}>
                        {task.estado.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {task.archivos > 0 ? `${task.archivos} archivo${task.archivos > 1 ? 's' : ''}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}