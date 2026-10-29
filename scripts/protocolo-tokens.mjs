// Medición del protocolo de turno: cuántos tokens ahorra la variante de dos
// líneas frente a la completa, sobre los turnos reales guardados en un proyecto.
//
// No inventa conversaciones: toma los mensajes de usuario de `axiom.db`, les
// aplica el mismo `promptPara` que arma el prompt de verdad (con su historial y
// su baseline) y compara el prompt tal como sale hoy contra el mismo prompt con
// el bloque completo. El delta es exacto (se cambia un único bloque); el valor
// absoluto en tokens es estimado a 4 caracteres por token, el mismo criterio que
// usa el harness cuando el proveedor no reporta `usage`.
//
// Uso: node scripts/protocolo-tokens.mjs [--root <dir>]
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { esTrivial, promptPara } from "../dist/sessions.js";
import { PROTOCOLO_CHAT, PROTOCOLO_CHAT_CORTO } from "../dist/modules/agents/defensa.js";
import { estimarTokens } from "../dist/modules/adapters/litellm.js";

const i = process.argv.indexOf("--root");
const root = resolve(i >= 0 ? process.argv[i + 1] ?? "." : ".");
const dbPath = join(root, "axiom.db");
if (!existsSync(dbPath)) {
  console.error(`protocolo-tokens: no hay ${dbPath}`);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
let filas;
try {
  filas = db.prepare(
    "SELECT m.texto, s.modo FROM chat_messages m JOIN chat_sessions s ON s.id = m.session_id WHERE m.rol = 'usuario' ORDER BY m.id",
  ).all();
} catch (e) {
  console.error(`protocolo-tokens: no se pudieron leer los turnos: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
} finally {
  db.close();
}
if (!filas.length) {
  console.error("protocolo-tokens: no hay turnos de usuario que medir");
  process.exit(1);
}

const largoCompleto = PROTOCOLO_CHAT.length;
const largoCorto = PROTOCOLO_CHAT_CORTO.length;
const deltaChars = largoCompleto - largoCorto;
if (deltaChars <= 0) {
  console.error("protocolo-tokens: la variante corta no es más corta que la completa");
  process.exit(1);
}

let simples = 0;
let charsActuales = 0;
let charsCompletos = 0;
const ejemplos = [];
for (const { texto, modo } of filas) {
  const t = typeof texto === "string" ? texto : "";
  const actual = promptPara(modo, "", t, {});
  const simple = esTrivial(t);
  if (simple) simples++;
  charsActuales += actual.length;
  charsCompletos += actual.length + (simple ? deltaChars : 0);
  const muestra = t.replace(/\s+/g, " ").trim().slice(0, 60);
  // Ejemplos distintos: tres «hola» seguidos miden lo mismo y no informan nada.
  if (simple && muestra && !ejemplos.includes(muestra) && ejemplos.length < 3) ejemplos.push(muestra);
}

const tokActuales = estimarTokens("x".repeat(charsActuales));
const tokCompletos = estimarTokens("x".repeat(charsCompletos));
const ahorroChars = charsCompletos - charsActuales;
const ahorroTok = tokCompletos - tokActuales;
const pctProtocolo = Math.round((deltaChars / largoCompleto) * 100);
const pctTotal = tokCompletos ? Math.round((ahorroTok / tokCompletos) * 100) : 0;

console.log("Protocolo de turno — medición sobre turnos reales");
console.log(`fuente: ${dbPath} · ${filas.length} turno(s) de usuario · ${simples} simple(s)`);
console.log(`completo: ${largoCompleto} chars ≈ ${estimarTokens(PROTOCOLO_CHAT)} tok`);
console.log(`corto:    ${largoCorto} chars ≈ ${estimarTokens(PROTOCOLO_CHAT_CORTO)} tok`);
console.log(`ahorro por turno simple: ${deltaChars} chars ≈ ${estimarTokens("x".repeat(deltaChars))} tok (${pctProtocolo} % del bloque)`);
console.log(`prompt con variante corta (tal como sale hoy): ${charsActuales} chars ≈ ${tokActuales} tok`);
console.log(`prompt con bloque completo (hipotético):       ${charsCompletos} chars ≈ ${tokCompletos} tok`);
console.log(`ahorro medido: ${ahorroChars} chars ≈ ${ahorroTok} tok en ${filas.length} turno(s) (${pctTotal} % del prompt total)`);
if (ejemplos.length) console.log(`turnos simples medidos: ${ejemplos.map((e) => `«${e}»`).join(", ")}`);
