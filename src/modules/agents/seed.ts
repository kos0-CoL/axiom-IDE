// Roster semilla: ÚNICA fuente del grafo por defecto.
// Lo consume el loader del módulo (proyecto sin agents.config.json) y el
// esqueleto de proyecto (src/proyectos.ts). Antes cada uno tenía su propia
// lista y las dos divergían: un proyecto nuevo nacía con otros agentes que un
// proyecto sin config. Datos puros, sin lógica: se clonan al entregarlos.

export type RolSemilla = "orquestador" | "nodo" | "especializado" | "subagente";
export type EstadoSemilla = "activo" | "pausado" | "archivado";
export type AccesoSemilla = "allow" | "ask" | "deny";
export type TipoAristaSemilla = "delega" | "comunica" | "escala";

export interface HerramientaSemilla {
  tool: string;
  acceso: AccesoSemilla;
}

export interface AgenteSemilla {
  id: string;
  rol: RolSemilla;
  modelo: string;
  estado: EstadoSemilla;
  skills: string[];
  instrucciones: string;
  herramientas: HerramientaSemilla[];
}

export interface AristaSemilla {
  de: string;
  a: string;
  tipo: TipoAristaSemilla;
}

// Oleada 1 del roster (docs/harness-2.0-agentes.md): orquestador, planificador,
// explorador, implementador, verificador, revisor, revisor de seguridad,
// documentador, especialista de datos y los dos especialistas que ya existían.
// Cada agente declara qué herramientas puede usar y con qué acceso. El broker
// cruza esa lista con la política (deny > ask > allow): lo no declarado se
// deniega, así que declarar nunca concede por encima de la política. `delega`
// es la herramienta del handoff y la declara quien tiene aristas salientes.
export const AGENTES_SEMILLA: readonly AgenteSemilla[] = [
  {
    id: "orquestador",
    rol: "orquestador",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["plan", "broker"],
    instrucciones: "Divide el trabajo por skill, delega y consolida. No ejecuta tareas especializadas por sí mismo; pide aprobación antes de acciones sensibles.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "allow" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "planificador",
    rol: "nodo",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["plan", "broker"],
    instrucciones: "Convierte el pedido en criterios de aceptación y un plan numerado con dependencias. No toca archivos.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "allow" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "explorador",
    rol: "nodo",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["explorar", "minimal-diff"],
    instrucciones: "Mapea los puntos de entrada, el flujo real y las pruebas existentes antes de que alguien edite. Solo lectura: devuelve rutas, líneas y datos leídos.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "allow" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "implementador",
    rol: "nodo",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["implementar", "minimal-diff"],
    instrucciones: "Ejecuta el plan en el workspace con el cambio mínimo; anuncia cada archivo tocado y ejecuta las verificaciones disponibles.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "editar", acceso: "ask" },
      { tool: "ejecutar", acceso: "ask" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "verificador",
    rol: "nodo",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["verify", "testing", "evidence"],
    instrucciones: "Ejecuta pruebas, tipos y checks reales; registra comando y resultado. Sin evidencia observable no hay verificado.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "ejecutar", acceso: "ask" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "revisor",
    rol: "nodo",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["review", "evidence"],
    instrucciones: "Revisa el diff completo, incluidos archivos inesperados, en dos ejes: Standards del repo y Spec pedida. No aprueba sin evidencia.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "delega", acceso: "allow" },
    ],
  },
  {
    id: "revisor-seguridad",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["policy", "sandbox", "seguridad"],
    instrucciones: "Revisa secretos, permisos, validación de entrada, dependencias nuevas y cambios de CI/configuración. Mínimo privilegio y aislamiento.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "ask" },
    ],
  },
  {
    id: "documentador",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["docs", "minimal-diff"],
    instrucciones: "Actualiza solo la documentación que el cambio deja obsoleta y verifica cada afirmación contra el código o una ejecución.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "editar", acceso: "ask" },
    ],
  },
  {
    id: "especialista-datos",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["datos-esquema", "verify"],
    instrucciones: "Prepara migraciones con impacto, compatibilidad y rollback. No ejecuta cambios productivos: deja el script y la verificación local.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "ejecutar", acceso: "ask" },
    ],
  },
  {
    id: "cazador-fallos",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["silent-failures", "error-propagation"],
    instrucciones: "Caza fallos silenciosos: catches vacíos, fallbacks peligrosos, errores no propagados. Reporta ubicación + fallo concreto.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "allow" },
    ],
  },
  {
    id: "reparador-build",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["build-fix", "minimal-diff"],
    instrucciones: "Arregla errores de build/tipos con cambios mínimos; sin refactors ni cambios arquitectónicos.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "editar", acceso: "ask" },
      { tool: "ejecutar", acceso: "ask" },
    ],
  },
  // Oleada 2 (docs/harness-2.0-agentes.md): capacidades de producción que se
  // activan según el riesgo del cambio, no en cada tarea.
  {
    id: "rendimiento",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["rendimiento", "verify"],
    instrucciones: "Mide con umbral y línea base antes de afirmar una mejora; reporta número, comando y entorno. Sin medición no hay mejora.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "ejecutar", acceso: "ask" },
    ],
  },
  {
    id: "accesibilidad",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["accesibilidad", "verify"],
    instrucciones: "Revisa semántica, teclado, etiquetas y contraste; automatiza lo posible y marca explícitamente lo que exige revisión manual.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "ejecutar", acceso: "ask" },
    ],
  },
  {
    id: "release",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["release", "docs"],
    instrucciones: "Prepara notas, checks previos, rollout gradual y rollback. No publica ni despliega: la aprobación es humana.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "editar", acceso: "ask" },
      { tool: "ejecutar", acceso: "ask" },
    ],
  },
  {
    id: "incidentes",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["incidentes", "evidence"],
    instrucciones: "Ordena evidencia de logs, métricas y trazas: impacto, cronología y causa probable. No modifica producción.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "allow" },
    ],
  },
  {
    id: "dependencias",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["dependencias", "seguridad"],
    instrucciones: "Justifica cada alta, revisa licencia y mantenimiento, elige la versión mínima y comprueba lockfile y build.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "buscar", acceso: "ask" },
      { tool: "editar", acceso: "ask" },
    ],
  },
  {
    id: "evaluador-harness",
    rol: "especializado",
    modelo: "hereda-proveedor",
    estado: "activo",
    skills: ["evaluacion", "verify"],
    instrucciones: "Compara candidatos del harness por resultado, trayectoria, coste y latencia; convierte fallos reales en casos de regresión.",
    herramientas: [
      { tool: "leer", acceso: "allow" },
      { tool: "ejecutar", acceso: "ask" },
      { tool: "delega", acceso: "allow" },
    ],
  },
];

export const ARISTAS_SEMILLA: readonly AristaSemilla[] = [
  { de: "orquestador", a: "planificador", tipo: "delega" },
  { de: "orquestador", a: "implementador", tipo: "delega" },
  { de: "orquestador", a: "verificador", tipo: "delega" },
  { de: "orquestador", a: "revisor", tipo: "delega" },
  { de: "planificador", a: "orquestador", tipo: "comunica" },
  { de: "implementador", a: "explorador", tipo: "delega" },
  { de: "explorador", a: "implementador", tipo: "comunica" },
  { de: "implementador", a: "verificador", tipo: "delega" },
  { de: "verificador", a: "revisor", tipo: "comunica" },
  { de: "revisor", a: "orquestador", tipo: "comunica" },
  { de: "implementador", a: "revisor-seguridad", tipo: "escala" },
  { de: "implementador", a: "reparador-build", tipo: "escala" },
  { de: "verificador", a: "cazador-fallos", tipo: "escala" },
  { de: "revisor", a: "documentador", tipo: "delega" },
  { de: "implementador", a: "especialista-datos", tipo: "escala" },
  // Oleada 2: se escala al especialista cuando el cambio lo justifica.
  { de: "verificador", a: "rendimiento", tipo: "escala" },
  { de: "revisor", a: "accesibilidad", tipo: "escala" },
  { de: "revisor", a: "dependencias", tipo: "escala" },
  { de: "implementador", a: "dependencias", tipo: "escala" },
  { de: "orquestador", a: "release", tipo: "delega" },
  { de: "orquestador", a: "incidentes", tipo: "escala" },
  { de: "orquestador", a: "evaluador-harness", tipo: "delega" },
  { de: "evaluador-harness", a: "orquestador", tipo: "comunica" },
];

export interface RosterSemilla {
  agentes: AgenteSemilla[];
  aristas: AristaSemilla[];
}

// Copia profunda: los llamadores mutan el config (agents define/link) y no
// deben tocar la constante del módulo.
export function rosterSemilla(): RosterSemilla {
  return {
    agentes: AGENTES_SEMILLA.map((a) => ({
      ...a,
      skills: [...a.skills],
      herramientas: a.herramientas.map((h) => ({ ...h })),
    })),
    aristas: ARISTAS_SEMILLA.map((e) => ({ ...e })),
  };
}
