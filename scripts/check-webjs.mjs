// check-webjs — el <script> de web.ts se genera con escapes TS; un "" de más
// lo deja muerto (CARGANDO... eterno) sin que tsc proteste. Lo compila con vm.
import { Script } from "node:vm";
import { PAGE } from "../dist/web.js";

const m = PAGE.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error("check-webjs: no se encontró <script> en PAGE"); process.exit(1); }
// HTML bien formado alrededor del script: si la etiqueta anterior quedó sin cerrar
// (p. ej. class="agt sin >), el navegador traga <script> como atributo y la página
// entera queda sin JS aunque el <script> exista en el string.
const iScript = PAGE.indexOf("<script>");
const pre = PAGE.slice(0, iScript);
if (pre.lastIndexOf("<") > pre.lastIndexOf(">")) {
  console.error("check-webjs: hay una etiqueta HTML sin cerrar justo antes de <script> (el navegador no ejecutaría el script)");
  process.exit(1);
}
if (!PAGE.includes("</script>")) { console.error("check-webjs: falta </script>"); process.exit(1); }
const js = m[1];
try {
  new Script(js);
} catch (e) {
  console.error(`check-webjs: sintaxis inválida: ${e.message}`);
  process.exit(1);
}
for (const marca of ["Telegram lab", "data-tgcb", "tgsend", "api/telegram/webhook", 'role="status"', "Sesiones", "Configuración — módulos", "card-build", "api/adapters/config", "api/telegram/config", "chatprov", "tgcfg", "sesactual", "setmodo", "chatskill", "tgdetectar", "mostrarAyuda", "Detectar mi chat", "tgaccion", "api/telegram/detectar", "api/secrets/olvidar", "api/chat/enviar", "api/chat/sesiones", "api/chat/skills", "slashbox", "api/proyecto", "api/proyecto/crear", "api/proyecto/usar", "proynuevo", "Nuevo proyecto", "api/modulos", "modload", "modvista", "modnav", "modir", "modgrafo", "modtablero", "grafoSVG", "api/modulos/datos", "El grafo ejecutado", "modbar", "modcol", "modpanel", "v-mod", "Mostrar:", "Módulos", "modcreachat", "card-mod", "modsallir", "MÓDULO", "modcard", "modcrea", "propuesta_modulo", "api/modulos/propuestas/generar", "sendModuleSearch", "cablearModulo", "cableoPintar", "Cableando", "progpasos", "Aprobar e instalar ", "vdatos", "vtabla", "vbuscar", "moddetalle", "api/modulos/detalle", "Modo avanzado", "Guardar campos", "detjson", "modmeta", "Qué expone", "datosModulo", "EXA_API_KEY", "renderModuleProposal", "Módulo generado y validado", "Modo creador", "Aprobar e instalar deshabilitado", "Revalidar", "Crear esqueleto", "Módulo", "compat", "Red en vivo", "api/agents/handoff", "api/agents/define", "handoffsload", "handoffenviar", "api/agents/experience", "api/agents/propuestas", "Memoria del harness", "memload", "api/run", "rundry", "Dry-run", "archivo", "api/staging", "allowload", "Staging allowlist", "usos", "Últimos usos", "runagente", "Run (agente)", "Agentes", "agmig", "api/agents", "api/secrets", "nav(", "Telegram: ", "openrouter", "st-prov", "st-techo", "st-tg", "Techo: ", "cfgaviso", "cfgkeyaviso", "cfgkeypill", "data-guardado", "Clave API",  "cfgprobar", "cfgprueba", "Probar conexión", "api/verify", "data-verificar", "data-est", "api/trazas", "trazasload", "v-trz", "Trazas de tool calls", 'data-view="trz"', "trazacuando", "el filtro las excluye", "con-detalle", "Clic en un nodo", "gnodo", "hashchange", "modnavrow", "← Módulos"]) {
  if (!PAGE.includes(marca)) { console.error(`check-webjs: falta marcador: ${marca}`); process.exit(1); }
}
console.log(`check-webjs OK (${js.length} bytes de script, sintaxis válida)`);
