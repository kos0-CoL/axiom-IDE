/// <reference types="vite/client" />

const API_BASE = import.meta.env.VITE_API_BASE || '';

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function fetcher<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `API error: ${response.status}` }));
    throw new Error(error.error || `API error: ${response.status}`);
  }

  const data = await response.json();
  return data as T;
}

// Types
export type ModoChat = 'ask' | 'plan' | 'build';

export interface Sesion {
  id: string;
  titulo: string;
  modo: ModoChat;
  archivada: boolean;
  created_at: string;
  updated_at: string;
}

export interface Mensaje {
  id: number;
  session_id: string;
  rol: 'usuario' | 'asistente' | 'sistema';
  texto: string;
  proveedor: string;
  model: string;
  skill: string;
  ms: number;
  created_at: string;
}

export const api = {
  // Chat sessions
  getChatSesiones: (): Promise<{ ok: true; sesiones: Sesion[] }> => 
    fetcher('/api/chat/sesiones'),
  getChatMensajes: (sesionId: string): Promise<{ ok: true; mensajes: Mensaje[] }> => 
    fetcher(`/api/chat/sesiones/${sesionId}/mensajes`),

  // Orquestación
  getOrquestacion: () => fetcher<any>('/api/orquestacion'),

  // Trabajo
  getTrabajo: () => fetcher<{ specs: any[] }>('/api/trabajo'),

  // Adapters
  getAdaptersConfig: () => fetcher<any>('/api/adapters/config'),
  setAdaptersConfig: (config: any) => fetcher<any>('/api/adapters/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),
  getModelos: (filtro?: string) => fetcher<any>(`/api/adapters/modelos${filtro ? `?filtro=${filtro}` : ''}`),
  spawn: (task: string, timeoutMs?: number) => fetcher<any>('/api/adapters/spawn', {
    method: 'POST',
    body: JSON.stringify({ task, timeoutMs }),
  }),

  // Telegram
  getTelegramConfig: () => fetcher<any>('/api/telegram/config'),
  setTelegramConfig: (config: any) => fetcher<any>('/api/telegram/config', {
    method: 'POST',
    body: JSON.stringify(config),
  }),
  detectarChat: (chatId: string) => fetcher<any>('/api/telegram/detectar', {
    method: 'POST',
    body: JSON.stringify({ chatId }),
  }),

  // Agents
  getAgents: () => fetcher<any>('/api/agents'),

  // Secrets
  getSecretPresence: () => fetcher<{ ok: true; presencia: Record<string, boolean> }>('/api/secrets/presencia'),
  forgetSecret: (keys: string[]) => fetcher<any>('/api/secrets/olvidar', {
    method: 'POST',
    body: JSON.stringify({ keys }),
  }),

  // Proyectos
  getProyecto: () => fetcher<any>('/api/proyecto'),
  crearProyecto: (nombre: string, plantilla?: string) => fetcher<any>('/api/proyecto/crear', {
    method: 'POST',
    body: JSON.stringify({ nombre, plantilla }),
  }),
  usarProyecto: (nombre: string) => fetcher<any>('/api/proyecto/usar', {
    method: 'POST',
    body: JSON.stringify({ nombre }),
  }),

  // Modules
  getModulos: () => fetcher<any>('/api/modulos'),
  setModulo: (nombre: string, accion: 'on' | 'off') => fetcher<any>('/api/modulos', {
    method: 'POST',
    body: JSON.stringify({ nombre, accion }),
  }),
  getModulosDatos: (nombre: string) => fetcher<any>(`/api/modulos/datos?nombre=${nombre}`),

  // Chat
  getChatSkills: () => fetcher<{ ok: true; skills: string[] }>('/api/chat/skills'),
  enviarMensaje: (sesionId: string, texto: string, modo: ModoChat, skill: string) => 
    fetcher<{ ok: true; texto: string }>('/api/chat/enviar', {
      method: 'POST',
      body: JSON.stringify({ sesionId, texto, modo, skill }),
    }),
  crearSesion: (titulo: string, modo: ModoChat) => 
    fetcher<{ ok: true; id: string }>('/api/chat/sesiones', {
      method: 'POST',
      body: JSON.stringify({ titulo, modo }),
    }),

  // Run
  run: (id: string, maxRondas?: number, tokens?: number, calls?: number, dryRun?: boolean, agente?: boolean) => 
    fetcher<any>('/api/run', {
      method: 'POST',
      body: JSON.stringify({ id, maxRondas, tokens, calls, dryRun, agente }),
    }),
  runStatus: () => fetcher<any>('/api/run/status'),

  // Broker/Decide
  decide: (id: string, ok: boolean, quien?: string) => fetcher<any>('/api/decide', {
    method: 'POST',
    body: JSON.stringify({ id, ok, quien }),
  }),

  // Staging
  getStaging: () => fetcher<any>('/api/staging'),
};