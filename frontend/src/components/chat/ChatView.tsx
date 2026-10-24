import { useState, useEffect } from 'react';
import { useChatSesiones, useChatMensajes, ModoChat } from '@/hooks/useChat';
import { api } from '@/lib/api';

export function ChatView() {
  const { data: sesionesData } = useChatSesiones();
  const [activeSesionId, setActiveSesionId] = useState<string | null>(null);
  const [modo, setModo] = useState<ModoChat>('build');
  const [inputValue, setInputValue] = useState('');
  const [mensajes, setMensajes] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Load messages when session is active
  const { data: mensajesData } = useChatMensajes(activeSesionId || '');
  useEffect(() => {
    if (mensajesData?.mensajes) {
      setMensajes([...mensajes, ...mensajesData.mensajes]);
    }
  }, [mensajesData]);

  const handleEnviar = async () => {
    if (!activeSesionId || !inputValue.trim()) return;
    
    setLoading(true);
    try {
      await api.enviarMensaje(activeSesionId, inputValue, modo, '');
      setInputValue('');
      // Refresh mensajes
      const newMsgs = await api.getChatMensajes(activeSesionId);
      if (newMsgs.ok && newMsgs.mensajes) {
        setMensajes(prev => [...prev, ...newMsgs.mensajes]);
      }
    } catch (e) {
      console.error('Error enviando mensaje:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCrearSesion = async () => {
    const titulo = prompt('Título de la sesión (opcional):') || '';
    if (titulo.trim()) {
      try {
        const result = await api.crearSesion(titulo.trim(), 'build');
        if (result.ok && result.id) {
          setActiveSesionId(result.id);
        }
      } catch (e) {
        console.error('Error creando sesión:', e);
      }
    }
  };

  if (!sesionesData?.sesiones || sesionesData.sesiones.length === 0) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-3 border-b border-line flex items-center justify-between">
          <h3 className="text-xl font-bold">CHAT</h3>
        </div>
        <div className="flex-1 p-6 flex flex-col items-center justify-center text-muted">
          <p className="mb-4">No hay sesiones. Crea una nueva para comenzar.</p>
          <button 
            onClick={handleCrearSesion}
            className="btn btn-primary"
          >
            Nueva sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Session list or active chat */}
      {!activeSesionId ? (
        <>
          <div className="p-3 border-b border-line flex items-center justify-between">
            <h3 className="font-bold">Chat</h3>
            <button 
              onClick={handleCrearSesion}
              className="btn btn-sm btn-secondary"
            >
              Nueva sesión
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            <div className="mb-4">
              <h4 className="text-sm text-muted mb-3">SECCIONES</h4>
              <div className="space-y-1">
                {sesionesData.sesiones?.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSesionId(s.id)}
                    className="w-full text-left px-3 py-2 hover:bg-bg-tertiary text-sm flex items-center justify-between"
                  >
                    <span className="truncate font-medium text-text">{s.titulo || 'Nuevo chat'}</span>
                    <span className="text-xs px-2 py-0.5 chip chip-success">
                      {s.modo.toUpperCase()}
                    </span>
                  </button>
                ))}
              </div>

              {/* New session form */}
              <div className="mt-6 pt-4 border-t border-line">
                <input
                  type="text"
                  placeholder="Título de la sesión"
                  className="input w-full mb-2"
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      handleCrearSesion();
                    }
                  }}
                />
                <button 
                  className="btn btn-primary w-full"
                  onClick={handleCrearSesion}
                >
                  Crear sesión
                </button>
              </div>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Active session header */}
          <div className="p-3 border-b border-line flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h4 className="font-semibold">Active session</h4>
              <span className="text-xs px-2 py-0.5 chip chip-success">
                {modo.toUpperCase()}
              </span>
            </div>
            <div className="flex gap-2">
              <select 
                value={modo} 
                onChange={e => setModo(e.target.value as ModoChat)}
                className="select"
              >
                <option value="ask">Ask</option>
                <option value="plan">Plan</option>
                <option value="build">Build</option>
              </select>
              <button 
                onClick={() => setActiveSesionId(null)}
                className="btn btn-sm btn-ghost"
              >
                Close
              </button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {mensajes.length === 0 ? (
              <div className="text-center py-8 text-muted">
                Select a session or create a new one
              </div>
            ) : (
              mensajes.map(msg => (
                <div key={msg.id} className="flex gap-3">
                  <div className="flex-1 max-w-[80%]">
                    <div className={`px-3 py-2 rounded text-sm ${
                      msg.rol === 'usuario' 
                        ? 'bg-accent/20 text-accent ml-auto'
                        : 'bg-bg-tertiary border border-line text-text'
                    }`}>
                      {msg.texto}
                    </div>
                    {msg.proveedor && (
                      <div className="text-xs text-muted mt-1">
                        {msg.proveedor} / {msg.model} {msg.ms && `${msg.ms}ms`}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="text-center text-muted">Thinking...</div>
            )}
          </div>

          {/* Input */}
          <div className="p-3 border-t border-line">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type your message..."
                className="input flex-1"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleEnviar();
                  }
                }}
              />
              <button 
                onClick={handleEnviar}
                disabled={loading || !inputValue.trim()}
                className="btn btn-primary"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}