#!/usr/bin/env node
// cli.ts — composition root delgado: parsea --root/args y despacha a commands.ts.
import { resolve } from "node:path";
import { flagNum, flagStr, cmdInit, cmdSpec, cmdPlan, cmdTasks, cmdVerify, cmdDecide, cmdRun, cmdStatus, cmdMemory, cmdValidate, cmdCheck, cmdUi, cmdServe, cmdValidateTokens, cmdValidateOpenApi, cmdCycle, cmdEvalComp, cmdRemoveComp, cmdDiffComp, cmdCompareComp, cmdBatterySet, cmdBatteryShow, cmdBatteryList, cmdBatteryClear, cmdSpawn, cmdExperiencia, cmdProponerHarness, cmdPropuestasHarness, cmdVerPropuesta, cmdDecidirPropuesta, cmdSnapshot, cmdModuloDatos, cmdModuloCrear, cmdModuloRegen, cmdCompat, crear, rollback, marcarEstable, listar } from "./commands.js";
import { statusText, notifyApproval, handleCallback, bloqueosText, consumoText, allowChatId, unallowChatId, setExpiracion, setEnabled as tgEnabled, configText, notifyChat, runPolling, tokenFromEnv, setWebhook, sendMessage } from "./telegram.js";
import { getSecret } from "./secrets.js";
const tgToken = (root: string): string | undefined => getSecret(root, "AXIOM_TELEGRAM_BOT_TOKEN") ?? tokenFromEnv();
import { agentsText, addAgente, pausarAgente, skill as agentSkill, enlazar as agentLink, definirAgente, handoff as agentHandoff, textoHandoffs } from "./agents.js";
import { configText as adaptersConfig, usarProveedor, ponerModelo, ponerUrl, ponerTimeoutMs, ponerMaxChars, spawn as adaptersSpawn, formatSpawn } from "./adapters.js";
import { sandboxRun, sandboxSpec } from "./sandbox.js";
import { listarModulos, moduloActivo, setModulo, setVista, textoModulos, textoSuperficie } from "./modulos.js";
import { textoSkills, leerSkill, borrarSkill } from "./skills.js";
void listarModulos;

const rawArgs = process.argv.slice(2);
const rootIdx = rawArgs.indexOf("--root");
const root = resolve(rootIdx >= 0 ? rawArgs[rootIdx + 1] : process.cwd());
const args = rootIdx >= 0 ? rawArgs.filter((_, i) => i !== rootIdx && i !== rootIdx + 1) : rawArgs.slice();

const [cmd, ...rest] = args;
if ((cmd === "telegram" || cmd === "adapters") && !moduloActivo(root, cmd)) { console.error(`módulo ${cmd} deshabilitado (fail closed): habilítalo con \`axiom module on ${cmd}\``); process.exit(2); }
if (cmd === "module" && rest[0] === "list") console.log(textoModulos(root));
else if (cmd === "module" && (rest[0] === "on" || rest[0] === "off")) { const m = setModulo(root, rest[1], rest[0]); console.log(m); if (/uso: axiom|inválido|desconocido/.test(m)) process.exit(2); }
else if (cmd === "module" && rest[0] === "new") cmdModuloCrear(root, rest[1], rest[2], rest.slice(3).join(" ") || undefined);
else if (cmd === "module" && rest[0] === "regen") cmdModuloRegen(root, rest[1]);
else if (cmd === "module" && rest[0] === "compat") cmdCompat(root, rest[1]);
else if (cmd === "module" && rest[0] === "datos") await cmdModuloDatos(root, rest[1]);
else if (cmd === "speckit" && rest[0] === "converge") {
  if (!moduloActivo(root, "speckit")) { console.error("módulo speckit deshabilitado (fail closed): habilítalo con `axiom module on speckit`"); process.exit(2); }
  const { datosSpeckit } = await import("./modules/speckit/index.js");
  const d = datosSpeckit(root);
  if (d.vacio) console.log("speckit: sin specs ni tareas todavía (usa `axiom spec` y `axiom tasks`)");
  else {
    console.log(`speckit converge: ${d.resumen.convergen}/${d.resumen.specs} specs convergen · ${d.resumen.verificadas}/${d.resumen.tareas} tareas verificadas`);
    for (const s of d.specs) console.log(`  ${s.converge ? "✔" : "·"} ${s.id} v${s.ver} ${s.titulo} (${s.verificadas}/${s.tareas})`);
    for (const t of d.pendientes) console.log(`  pendiente ${t.id} (spec ${t.spec}): ${t.titulo}`);
  }
}
else if (cmd === "grafos" && rest[0] === "ver") {
  if (!moduloActivo(root, "grafos")) { console.error("módulo grafos deshabilitado (fail closed): habilítalo con `axiom module on grafos`"); process.exit(2); }
  const { datosGrafos } = await import("./modules/grafos/index.js");
  const d = datosGrafos(root);
  if (d.vacio) console.log("grafos: sin handoffs ni evidencias todavía (usa `axiom agents handoff` y `axiom verify`)");
  else {
    console.log("=== INTENDED (agents.config.json) ===");
    console.log(`Centro: ${d.intended.centro}`);
    for (const n of d.intended.nodos) console.log(`  Nodo: ${n.id} [${n.tipo}] ${n.nota}`);
    for (const a of d.intended.aristas) console.log(`  ${a.de} ──${a.nota}──▶ ${a.a}`);
    console.log("\n=== EXECUTED (handoff_log + evidences) ===");
    console.log(`Centro: ${d.executed.centro}`);
    for (const n of d.executed.nodos) console.log(`  Nodo: ${n.id} [${n.tipo}] ${n.nota}`);
    for (const a of d.executed.aristas) console.log(`  ${a.de} ──${a.nota}──▶ ${a.a}`);
  }
}
else if (cmd === "browser") {
  if (!moduloActivo(root, "browser")) { console.error("módulo browser deshabilitado (fail closed): habilítalo con `axiom module on browser`"); process.exit(2); }
  const { estadoBrowser, capturar } = await import("./modules/browser/index.js");
  const url = rest.filter((a) => a !== "--dom")[0];
  if (!url) { console.log(estadoBrowser(root)); }
  else if (!/^https?:\/\//.test(url)) { console.error("uso: axiom browser [<url> [--dom]]"); process.exit(2); }
  else {
    const r = capturar(root, url, rest.includes("--dom") ? "dom" : "png");
    if (!r.ok) { console.error(r.error); process.exit(1); }
    console.log(`captura OK [${r.motor}] ${r.bytes} B → ${r.ruta}${r.errorPagina ? ` · PÁGINA DE ERROR: ${r.errorPagina}` : ""}${r.timeoutMs ? ` · TIMEOUT DE RED: ${r.timeoutMs} ms (parte de timeout, la URL no quedó cargada)` : ""}`);
  }
}
else if (cmd === "module" && rest[0] === "check") { const m = textoSuperficie(rest[1]); console.log(m); if (/FALLO/.test(m)) process.exit(2); }
else if (cmd === "module" && rest[0] === "vista") { const m = setVista(root, rest[1], rest[2]); console.log(m); if (/uso: axiom|inválido|inválida|desconocido/.test(m)) process.exit(2); }
else if (cmd === "module") { console.log(textoModulos(root)); }
else if (cmd === "init") cmdInit(root);
else if (cmd === "spec") cmdSpec(root, rest[0], ...rest.slice(1));
else if (cmd === "plan") cmdPlan(root, rest[0]);
else if (cmd === "tasks") cmdTasks(root, rest[0]);
else if (cmd === "verify") { const t = flagNum(rest, "--tokens", 100); const c = flagNum(t.resto, "--calls", 1); const d = flagStr(c.resto, "--detalle"); const a = flagStr(d.resto, "--archivos"); const u = flagStr(a.resto, "--url"); cmdVerify(root, u.resto[0], u.resto[1], t.valor, c.valor, d.valor, "humano", a.valor, u.valor, u.resto.includes("--dom") ? "dom" : "png"); }
else if (cmd === "run") { const r = flagNum(rest, "--rondas", 3); const t = flagNum(r.resto, "--tokens", 50); const c = flagNum(t.resto, "--calls", 1); const pos = c.resto.filter((x) => x !== "--dry-run" && x !== "--agente"); await cmdRun(root, pos[0], r.valor, t.valor, c.valor, c.resto.includes("--dry-run"), c.resto.includes("--agente")); }
else if (cmd === "memory") { const a = flagStr(rest, "--keep"); const dry = a.resto.includes("--dry-run"); const limpio = a.resto.filter((x) => x !== "--dry-run"); cmdMemory(root, limpio[0], a.valor, dry); }
else if (cmd === "status" && rest[0] === "--trace") cmdStatus(root, rest[1], true);
else if (cmd === "status") cmdStatus(root);
else if (cmd === "validate-spec") cmdValidate(root);
else if (cmd === "ui") cmdUi(root);
else if (cmd === "check") { const a = flagStr(rest, "--agente"); cmdCheck(root, a.resto[0], a.valor); }
else if (cmd === "approve") cmdDecide(root, rest[0], true);
else if (cmd === "reject") cmdDecide(root, rest[0], false);
else if (cmd === "telegram" && rest[0] === "notify") { const chat = rest[2]; if (chat) { console.log(await notifyChat(root, rest[1] ?? "publish", chat, tgToken(root))); } else { console.log(notifyApproval(root, rest[1] ?? "publish")); } }
else if (cmd === "telegram" && rest[0] === "send") { const chat = rest[1]; const text = rest.slice(2).join(" "); if (!chat || !text) { console.error("uso: axiom telegram send <chat-id> <texto>"); process.exit(2); } const t = tgToken(root); if (!t) { console.error("sin token (fail closed): guarda el token en Configuración o define AXIOM_TELEGRAM_BOT_TOKEN"); process.exit(1); } const r = await sendMessage(t, chat, text); console.log(r.ok ? `enviado a ${chat}` : `Bot API error: ${r.description ?? "desconocido"}`); if (!r.ok) process.exit(1); }
else if (cmd === "telegram" && rest[0] === "bot") { const once = rest.includes("--once"); console.log(await runPolling(root, { once, token: tgToken(root) })); }
else if (cmd === "telegram" && rest[0] === "webhook") { const url = rest[1]; if (!url || !/^https:\/\//.test(url)) { console.error("uso: axiom telegram webhook <https-url> [--secret S]"); process.exit(2); } const si = rest.indexOf("--secret"); const sec = si >= 0 ? rest[si + 1] : undefined; const t = tgToken(root); if (!t) { console.error("sin token (fail closed): guarda el token en Configuración o define AXIOM_TELEGRAM_BOT_TOKEN"); process.exit(1); } const r = await setWebhook(t, url, sec); console.log(r.ok ? `webhook: ${url}` : `Bot API error: ${r.description ?? "desconocido"}`); if (!r.ok) process.exit(1); }
else if (cmd === "telegram" && rest[0] === "approve") { const m = handleCallback(root, rest[1] ?? "", "approve"); console.log(m); if (/ya |no existe|expirada|no autorizado|denegada/i.test(m)) process.exit(2); }
else if (cmd === "telegram" && rest[0] === "reject") { const m = handleCallback(root, rest[1] ?? "", "reject"); console.log(m); if (/ya |no existe|expirada|no autorizado/i.test(m)) process.exit(2); }
else if (cmd === "telegram" && rest[0] === "bloqueos") { console.log(bloqueosText(root)); }
else if (cmd === "telegram" && rest[0] === "consumo") { console.log(consumoText(root)); }
else if (cmd === "telegram" && rest[0] === "allow") { const m = allowChatId(root, rest[1]); console.log(m); if (/uso: axiom|inválido|inválida/.test(m)) process.exit(2); }
else if (cmd === "telegram" && rest[0] === "unallow") { const m = unallowChatId(root, rest[1]); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/no estaba|inválida/.test(m)) process.exit(1); }
else if (cmd === "telegram" && rest[0] === "expira") { const m = setExpiracion(root, rest[1]); console.log(m); if (/uso: axiom|inválidos|inválida/.test(m)) process.exit(2); }
else if (cmd === "telegram" && rest[0] === "config") { const m = configText(root); console.log(m); if (/inválido|ilegible/.test(m)) process.exit(1); }
else if (cmd === "telegram" && (rest[0] === "on" || rest[0] === "off")) { const m = tgEnabled(root, rest[0]); console.log(m); if (/uso: axiom|inválida/.test(m)) process.exit(2); }
else if (cmd === "telegram") { console.log(statusText(root)); }
else if (cmd === "skills") {
  if (!moduloActivo(root, "skills")) { console.error("módulo skills deshabilitado (fail closed): habilítalo con `axiom module on skills`"); process.exit(2); }
  if (rest[0] === "ver") {
    const r = leerSkill(root, rest[1] ?? "");
    if (!r.ok) { console.error(r.error); process.exit(2); }
    console.log(`${r.skill.id} [${r.skill.origen}] ${r.skill.descripcion}\n${r.skill.ruta}\n\n${r.skill.cuerpo}`);
  } else if (rest[0] === "borrar") {
    const r = borrarSkill(root, rest[1] ?? "");
    console.log(r.ok ? r.msg : r.error);
    if (!r.ok) process.exit(2);
  } else if (rest[0] && rest[0] !== "list") {
    console.error("uso: axiom skills [ver|borrar <id>]"); process.exit(2);
  } else {
    console.log(textoSkills(root));
  }
}
else if (cmd === "agents" && rest[0] === "add") { const m = addAgente(root, rest[1], rest[2]); console.log(m); if (/uso: axiom|inválido|ya existe|inválida/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "pause") { const m = pausarAgente(root, rest[1], rest[2]); console.log(m); if (/uso: axiom|inválido|no existe|inválida/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "skill") { const m = agentSkill(root, rest[1], rest[2]); console.log(m); if (/uso: axiom|no existe|inválida/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "link") { const m = agentLink(root, rest[1], rest[2], rest[3]); console.log(m); if (/uso: axiom|inválido|inexistente|inválida/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "define") { const m = definirAgente(root, rest[1], rest[2], rest.slice(3).join(" ") || undefined); console.log(m); if (/uso: axiom|no existe|inválido|no estaba|máximo/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "handoff") { const m = agentHandoff(root, rest[1], rest[2], rest.slice(3).join(" ")); console.log(m); if (/uso: axiom|inexistente|sin arista|no está activo|denegado|inválido|ilegible/.test(m)) process.exit(2); }
else if (cmd === "agents" && rest[0] === "handoffs") { console.log(textoHandoffs(root)); }
else if (cmd === "agents" && rest[0] === "experience") cmdExperiencia(root, rest[1]);
else if (cmd === "agents" && rest[0] === "proponer") cmdProponerHarness(root, rest[1]);
else if (cmd === "agents" && rest[0] === "propuestas") cmdPropuestasHarness(root);
else if (cmd === "agents" && rest[0] === "ver-propuesta") cmdVerPropuesta(root, rest[1]);
else if (cmd === "agents" && rest[0] === "aprobar-propuesta") cmdDecidirPropuesta(root, rest[1], true);
else if (cmd === "agents" && rest[0] === "rechazar-propuesta") cmdDecidirPropuesta(root, rest[1], false);
else if (cmd === "agents" && rest[0] === "snapshot") cmdSnapshot(root, rest[1]);
else if (cmd === "agents") { console.log(agentsText(root)); }
else if (cmd === "adapters" && rest[0] === "config") { if (moduloActivo(root, "adapters")) { console.log(adaptersConfig(root)); } else { console.log("adapters está deshabilitado"); } if (moduloActivo(root, "adapters") && /inválido|ilegible/.test(adaptersConfig(root))) process.exit(1); }
else if (cmd === "adapters" && rest[0] === "use") { const m = usarProveedor(root, rest[1]); console.log(m); if (/uso: axiom|inválido|inválida/.test(m)) process.exit(2); }
else if (cmd === "adapters" && rest[0] === "model") { const m = ponerModelo(root, rest[1]); console.log(m); if (/uso: axiom|inválida/.test(m)) process.exit(2); }
else if (cmd === "adapters" && rest[0] === "url") { const m = ponerUrl(root, rest[1]); console.log(m); if (/uso: axiom|inválida/.test(m)) process.exit(2); }
else if (cmd === "adapters" && rest[0] === "spawn") { const ti = rest.indexOf("--timeout"); const to = ti >= 0 ? parseInt(rest[ti + 1] ?? "", 10) : undefined; if (ti >= 0 && (!Number.isInteger(to) || (to as number) < 100)) { console.error("uso: axiom adapters spawn <tarea...> [--timeout MS>=100]"); process.exit(2); } const task = rest.filter((_, i) => i !== 0 && i !== ti && i !== ti + 1).join(" "); if (!task) { console.error("uso: axiom adapters spawn <tarea...> [--timeout MS>=100]"); process.exit(2); } const m = await cmdSpawn(root, task, to); console.log(m); if (/ERROR/.test(m)) process.exit(1); }
else if (cmd === "adapters" && rest[0] === "timeout") { const m = ponerTimeoutMs(root, rest[1]); console.log(m); if (/uso: axiom|inválido|inválida/.test(m)) process.exit(2); }
else if (cmd === "adapters" && rest[0] === "maxchars") { const m = ponerMaxChars(root, rest[1]); console.log(m); if (/uso: axiom|inválido|inválida/.test(m)) process.exit(2); }
else if (cmd === "adapters") { console.log(adaptersConfig(root)); }
else if (cmd === "comp" && rest[0] === "create") { console.log(crear(root, rest[1] ?? "sin-nombre", (rest[2] as any) ?? "temporal")); }
else if (cmd === "comp" && rest[0] === "eval") { const skip = new Set<number>(); let cmdStr: string | undefined; let img: string | undefined; for (const [flag, set] of [["--cmd", (v: string) => cmdStr = v], ["--image", (v: string) => img = v]] as const) { const i = rest.indexOf(flag); if (i >= 0) { set(rest[i + 1] ?? ""); skip.add(i); skip.add(i + 1); } } const pos = rest.filter((_, i) => i !== 0 && !skip.has(i)); const m = await cmdEvalComp(root, pos[0], pos[1], pos[2] === "pass" || pos[2] === "fail" ? pos[2] : undefined, cmdStr, img); console.log(m); if (/no permitida|exige aprobación|no existe|uso: axiom/.test(m)) process.exit(2); }
else if (cmd === "comp" && rest[0] === "remove") { const m = cmdRemoveComp(root, rest[1], rest[2]); console.log(m); if (/denegado|uso: axiom/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "diff") { const m = cmdDiffComp(root, rest[1]); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/no existe|sin (estable|candidata|versiones)/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "compare") { const skip = new Set<number>(); let cmdStr: string | undefined; let img: string | undefined; for (const [flag, set] of [["--cmd", (v: string) => cmdStr = v], ["--image", (v: string) => img = v]] as const) { const i = rest.indexOf(flag); if (i >= 0) { set(rest[i + 1] ?? ""); skip.add(i); skip.add(i + 1); } } const pos = rest.filter((_, i) => i !== 0 && !skip.has(i)); const m = await cmdCompareComp(root, pos[0], cmdStr, img); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/no permitida|exige aprobación/.test(m)) process.exit(2); else if (/no existe|sin (estable|candidata|versiones)/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "battery" && rest[1] === "set") { const skip = new Set<number>([0, 1]); let cmdStr: string | undefined; let img: string | undefined; for (const [flag, set] of [["--cmd", (v: string) => cmdStr = v], ["--image", (v: string) => img = v]] as const) { const i = rest.indexOf(flag); if (i >= 0) { set(rest[i + 1] ?? ""); skip.add(i); skip.add(i + 1); } } const pos = rest.filter((_, i) => !skip.has(i)); const m = cmdBatterySet(root, pos[0], cmdStr, img); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/no permitida/.test(m)) process.exit(2); else if (/no existe/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "battery" && rest[1] === "show") { const m = cmdBatteryShow(root, rest[2]); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/no existe|sin batería/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "battery" && rest[1] === "list") { console.log(cmdBatteryList(root)); }
else if (cmd === "comp" && rest[0] === "battery" && rest[1] === "clear") { const m = cmdBatteryClear(root, rest[2]); console.log(m); if (/uso: axiom/.test(m)) process.exit(2); else if (/sin batería/.test(m)) process.exit(1); }
else if (cmd === "comp" && rest[0] === "stable") { console.log(marcarEstable(root, rest[1] ?? "", rest[2] ?? "")); }
else if (cmd === "comp" && rest[0] === "rollback") { console.log(rollback(root, rest[1] ?? "")); }
else if (cmd === "comp") { console.log(listar(root)); }
else if (cmd === "sandbox" && rest[0] === "spec") { console.log(sandboxSpec()); }
else if (cmd === "serve") { cmdServe(root, rest[0]); }
else if (cmd === "validate-tokens") { cmdValidateTokens(rest[0]); }
else if (cmd === "validate-openapi") { cmdValidateOpenApi(rest[0]); }
else if (cmd === "sandbox") { const ii = rest.indexOf("--image"); const img = ii >= 0 ? rest[ii + 1] : undefined; const userCmd = ii >= 0 ? rest.filter((_, i) => i !== ii && i !== ii + 1) : rest.slice(); const out = await sandboxRun(root, userCmd.length ? userCmd : ["echo", "sandbox-ok"], img ? { image: img } : {}); console.log(out.out); process.exit(out.code); }
else if (cmd === "cycle") { cmdCycle(root, rest[0]); }
else { console.log("uso: axiom [--root <dir>] <init|spec|plan|tasks|verify|run|check|approve|reject|cycle|comp|telegram|module|ui|status|validate-spec|serve|validate-tokens|validate-openapi|sandbox> (verify: pass|fail|error [--detalle] [--archivos]) (run: [--dry-run] [--agente]) (check: [<tool>] [--agente <id>]) (telegram: notify|approve|reject|bloqueos|consumo|allow|unallow|expira|config|send|bot [--once]|webhook|on|off) (adapters: config|use|model|url|timeout|maxchars|spawn) (skills: list|ver|borrar <id>) (agents: list|add|pause|skill|link|define|handoff|handoffs|experience|proponer|propuestas|ver-propuesta|aprobar-propuesta|rechazar-propuesta|snapshot) (secrets: solo via web Configuración)"); process.exit(cmd ? 1 : 0); }
