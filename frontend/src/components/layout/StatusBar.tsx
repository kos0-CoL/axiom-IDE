import { useAdaptersConfig } from '@/hooks/useAdapters';
import { useTelegramConfig } from '@/hooks/useTelegram';

export function StatusBar() {
  const { data: adaptersData } = useAdaptersConfig();
  const { data: tgData } = useTelegramConfig();

  return (
    <div className="h-6 bg-panel-bg border-t border-line flex items-center justify-between px-4 text-xs text-muted">
      {/* Left: Provider info */}
      <div className="flex items-center gap-3">
        {adaptersData?.config?.proveedor && (
          <span className="font-mono">
            {adaptersData.config.proveedor}
            {adaptersData.config.model && ` / ${adaptersData.config.model}`}
          </span>
        )}
        {!adaptersData?.config?.proveedor && (
          <span>Proveedor no configurado</span>
        )}
      </div>

      {/* Right: Status indicators */}
      <div className="flex items-center gap-4">
        {/* Telegram status */}
        <div className="flex items-center gap-1">
          {tgData?.config?.enabled ? (
            <>
              <span className="w-2 h-2 bg-success rounded-full animate-pulse" />
              <span>TG: activo</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 bg-error rounded-full" />
              <span>TG: inactivo</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}