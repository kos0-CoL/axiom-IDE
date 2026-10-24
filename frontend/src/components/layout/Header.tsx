import { useOrquestacion } from '@/hooks/useOrquestacion';
import { useAdaptersConfig } from '@/hooks/useAdapters';

interface HeaderProps {
  activeView?: 'orquestacion' | 'trabajo' | 'chat';
  onViewChange?: (view: 'orquestacion' | 'trabajo' | 'chat') => void;
}

export function Header({ activeView = 'orquestacion', onViewChange }: HeaderProps) {
  const { data: orqData } = useOrquestacion();
  const { data: adaptersData } = useAdaptersConfig();

  return (
    <header className="h-12 bg-sidebar-bg border-b border-line flex items-center justify-between px-4">
      {/* Navigation Tabs */}
      <nav className="flex items-center gap-1">
        <button
          onClick={() => onViewChange?.('orquestacion')}
          className={`px-3 py-1 text-sm rounded-t transition-colors ${
            activeView === 'orquestacion' 
              ? 'border-b-2 border-accent text-accent' 
              : 'text-muted hover:text-text'
          }`}
        >
          Orquestación
        </button>
        <button
          onClick={() => onViewChange?.('trabajo')}
          className={`px-3 py-1 text-sm rounded-t transition-colors ${
            activeView === 'trabajo' 
              ? 'border-b-2 border-accent text-accent' 
              : 'text-muted hover:text-text'
          }`}
        >
          Trabajo
        </button>
        <button
          onClick={() => onViewChange?.('chat')}
          className={`px-3 py-1 text-sm rounded-t transition-colors ${
            activeView === 'chat' 
              ? 'border-b-2 border-accent text-accent' 
              : 'text-muted hover:text-text'
          }`}
        >
          Chat
        </button>
      </nav>

      {/* Status / Tokens */}
      {orqData && (
        <div className="text-xs text-muted hidden sm:flex items-center gap-4">
          <span>Techo: {orqData.techo.rondas}r / {orqData.techo.tokens?.toLocaleString() || 0}t</span>
          <span>Usado: {orqData.consumo.tokens?.toLocaleString() || 0} / {orqData.techo.tokens?.toLocaleString() || 0}</span>
        </div>
      )}

      {/* Connection Status */}
      <div className="flex items-center gap-3 text-xs text-muted">
        {adaptersData?.config?.proveedor && (
          <span className="font-mono hidden sm:inline">
            {adaptersData.config.proveedor}
            {adaptersData.config.model && ` / ${adaptersData.config.model}`}
          </span>
        )}
        <span className="w-2 h-2 bg-success rounded-full" />
        <span className="hidden sm:inline">Live</span>
      </div>
    </header>
  );
}