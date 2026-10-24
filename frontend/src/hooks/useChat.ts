import useSWR from 'swr';
import { api, Sesion, Mensaje } from '@/lib/api';

export type { ModoChat } from '@/lib/api';

export interface ChatSesionesResponse {
  ok: true;
  sesiones: Sesion[];
}

export interface ChatMensajesResponse {
  ok: true;
  mensajes: Mensaje[];
}

export function useChatSesiones() {
  return useSWR<ChatSesionesResponse>('/api/chat/sesiones', () => 
    api.getChatSesiones().then(r => {
      if (!r.ok) throw new Error('Error loading sessions');
      return r;
    }), {
    refreshInterval: 10000,
    revalidateOnFocus: true,
  });
}

export function useChatMensajes(sesionId: string) {
  return useSWR<ChatMensajesResponse>(
    sesionId ? `/api/chat/sesiones/${encodeURIComponent(sesionId)}/mensajes` : null, 
    () => 
      api.getChatMensajes(sesionId).then(r => {
        if (!r.ok) throw new Error('Error loading messages');
        return r;
      }), 
    { 
      refreshInterval: 3000,
      revalidateOnFocus: true,
    }
  );
}