// Type definitions from OpenAPI spec
// Generated from openapi.json

export interface Orquestacion {
  techo: { rondas: number; tokens: number; calls: number };
  consumo: { tokens: number; calls: number };
  usos: UsoView[];
  tareas: { estado: string; n: number }[];
  aprobaciones: AprobacionView[];
}

export interface UsoView {
  prompt: number;
  respuesta: number;
  total: number;
  fuente: string;
  created_at: string;
}

export interface AprobacionView {
  id: string;
  tool: string;
  riesgo: 'bajo' | 'medio' | 'alto';
  estado: 'pendiente' | 'aprobada' | 'rechazada' | 'usada' | 'expirada' | 'denegada-por-politica' | 'denegada-por-agente' | 'denegada-sin-agente';
  created_at: string;
  decided_by: string;
  decided_at: string;
  /** Cuándo se gastó la concesión (ISO); vacío si sigue disponible o no se aprobó. */
  usada_at: string;
  /** Corrida que gastó la concesión (ej. run spec/tarea); vacío en bases viejas. */
  usada_por: string;
  /** Agente que pidió la herramienta; vacío si el check no tuvo agente. */
  agente: string;
  /** Declaración vigente del agente para esa herramienta ('' si no la declara). */
  declaracion: 'allow' | 'ask' | 'deny' | '';
  /** Resumen legible (ej. editar=ask) o el motivo por el que no se resuelve. */
  declaracionTexto: string;
}

export interface Trabajo {
  specs: SpecConverge[];
}

export interface SpecConverge {
  id: string;
  ver: string;
  title: string;
  status: string;
  tareas: TaskView[];
}

export interface TaskView {
  id: string;
  ver: string;
  estado: 'implementado' | 'verificado' | 'aceptado' | 'bloqueado' | 'rechazado';
  archivos: number;
}

export interface Agente {
  id: string;
  rol: 'orquestador' | 'nodo' | 'especializado' | 'subagente';
  modelo: string;
  estado: 'activo' | 'pausado' | 'archivado';
  skills: string[];
  instrucciones: string;
  herramientas: HerramientaAgente[];
  presupuesto?: { tokens: number; calls: number };
}

export interface HerramientaAgente {
  tool: string;
  acceso: 'allow' | 'ask' | 'deny';
}

export interface Arista {
  de: string;
  a: string;
  tipo: 'delega' | 'comunica' | 'escala';
}

export interface AgentsResponse {
  ok: boolean;
  agentes: Agente[];
  aristas: Arista[];
  grafo: string;
}

export interface ModeloInfo {
  id: string;
  free?: boolean;
  recomendado?: boolean;
  nota?: string;
}

export interface ModelosResponse {
  ok: boolean;
  modelos: ModeloInfo[];
  proveedorGlobal?: string;
  modeloGlobal?: string;
}

export interface AgenteModeloResponse {
  ok: boolean;
  agente: string;
  modelo: string;
  proveedorGlobal: string;
  modeloGlobal: string;
}

export interface AdaptersConfig {
  proveedor: 'off' | 'ollama' | 'litellm' | 'openai' | 'anthropic' | 'google' | 'openrouter';
  model: string;
  baseUrl?: string;
  timeoutMs: number;
  maxChars: number;
}

export interface SpawnRequest {
  task: string;
  timeoutMs?: number;
  maxChars?: number;
  key?: string;
}

export interface SpawnResult {
  ok: boolean;
  text?: string;
  error?: string;
  ms: number;
  proveedor: string;
  model: string;
  truncada?: boolean;
  uso?: { prompt: number; respuesta: number; total: number; fuente: string };
}

export interface SecretsPresencia {
  OPENAI_API_KEY: boolean;
  ANTHROPIC_API_KEY: boolean;
  GOOGLE_API_KEY: boolean;
  OPENROUTER_API_KEY: boolean;
  AXIOM_LITELLM_KEY: boolean;
  AXIOM_TELEGRAM_BOT_TOKEN: boolean;
  AXIOM_TELEGRAM_WEBHOOK_SECRET: boolean;
}

export interface SecretsSetResult {
  saved: string[];
  cleared: string[];
  error?: string;
}

export interface TelegramConfig {
  enabled: boolean;
  allowlist: string[];
  expiracionMin: number;
}

export interface TelegramDetectarResponse {
  ok: boolean;
  allowed: boolean;
  chatId: string;
}

export interface ModuloInfo {
  nombre: string;
  version: string;
  descripcion: string;
  configFile: string;
  estado: 'esqueleto' | 'datos' | 'completo';
  cableado: boolean;
  enabled: boolean;
  vista: 'solo' | 'columna' | 'barra';
  superficie: string[];
  panel: string | null;
  compat: string;
}

export interface ModuloDatos {
  nombre: string;
  datos: unknown;
}

export interface ProyectoInfo {
  ok: boolean;
  texto: string;
}

export interface ProyectoCrearRequest {
  nombre: string;
  plantilla?: string;
}

export interface ProyectoCrearResponse {
  ok: boolean;
  msg: string;
  path?: string;
}

export interface ProyectoUsarRequest {
  nombre: string;
}

export interface DecideRequest {
  id: string;
  ok: boolean;
  quien?: string;
}

export interface DecideResponse {
  ok: boolean;
  msg: string;
}

export interface RunRequest {
  id: string;
  maxRondas?: number;
  tokens?: number;
  calls?: number;
  dryRun?: boolean;
  conAgente?: boolean;
}

export interface RunResponse {
  ok: boolean;
  code: number;
  msg: string;
}

export interface ChatSesion {
  id: string;
  titulo: string;
  modo: 'ask' | 'plan' | 'build';
  archivada: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatMensaje {
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

export interface ChatEnviarRequest {
  sesionId: string;
  texto: string;
  proveedor?: string;
  model?: string;
  skill?: string;
  modo?: 'ask' | 'plan' | 'build';
}

export interface ChatEnviarResponse {
  ok: boolean;
  msg: string;
}

export interface SkillInfo {
  id: string;
  descripcion: string;
}

export interface StagingResponse {
  ok: boolean;
  fuera: string[];
  texto: string;
}

export interface AllowRequest {
  patron: string;
}

export interface StagingActionResponse {
  ok: boolean;
  msg: string;
}

export interface PlanAprobarRequest {
  id: string;
  ok: boolean;
}

export interface PlanAprobarResponse {
  ok: boolean;
  msg: string;
}

export interface HandoffRequest {
  de: string;
  a: string;
  tarea: string;
}

export interface HandoffResponse {
  ok: boolean;
  msg: string;
}

export interface AgenteAddRequest {
  id: string;
  rol: 'orquestador' | 'nodo' | 'especializado' | 'subagente';
}

export interface AgentePauseRequest {
  id: string;
  estado?: 'activo' | 'pausado';
}

export interface AgenteSkillRequest {
  id: string;
  skill: string;
}

export interface AgenteDefineRequest {
  id: string;
  campo: 'instrucciones' | 'herramienta' | 'noherramienta' | 'presupuesto' | 'nopresupuesto';
  valor?: string;
}

export interface AgenteModeloRequest {
  modelo: string;
}

export interface HandoffLog {
  id: number;
  de: string;
  a: string;
  tarea: string;
  decision: string;
  approval_id: string;
  created_at: string;
}

export interface ExperienceEntry {
  fecha: string;
  taskId: string;
  verdict: string;
  juez: string;
  harness: string;
  nota?: string;
}

export interface Propuesta {
  id: string;
  texto: string;
  estado: 'propuesta' | 'aprobada' | 'rechazada';
  created_at: string;
  decided_at: string;
}

export interface AgentesHandoffsResponse {
  ok: boolean;
  handoffs: HandoffLog[];
  texto: string;
}

export interface AgentesExperienceResponse {
  ok: boolean;
  texto: string;
}

export interface AgentesPropuestasResponse {
  ok: boolean;
  texto: string;
}

export interface AgentesSnapshotResponse {
  ok: boolean;
  texto: string;
}