// Coder con LLM real — reutiliza el módulo adapters (spawn). Si la config no
// tiene proveedor, usa openrouter por defecto; si lo tiene, manda el suyo.
// Techo de tokens = maxChars de la config (reintento con el doble, tope del
// schema), timeout = timeoutMs de la config. Ante `truncada` reintenta UNA
// vez pidiendo el archivo completo; si sigue truncado, lanza error para que
// el orquestador lo cuente como fallo. El prompt sigue siendo raw.
import { loadConfig, type Proveedor } from "../modules/adapters/config.js";
import { spawn } from "../modules/adapters/index.js";
import { promptCoder } from "./coder.js";

const SUFIJO_REINTENTO =
  "\n\nTu respuesta anterior se truncó a mitad. Devuelve el archivo COMPLETO otra vez, solo código, sin markdown ni explicaciones.";

const TOPE_MAXCHARS = 100000;

export interface OpcionesCoderLLM {
  model?: string;
  key?: string;
  proveedor?: Proveedor;
  maxChars?: number;
  timeoutMs?: number;
  reintentosTruncado?: number;
}

export async function generarCodigoLLM(
  root: string,
  ruta: string,
  spec: string,
  opts: OpcionesCoderLLM = {},
): Promise<string> {
  const cfg = loadConfig(root);
  if (!cfg.ok) throw new Error(`coder LLM: ${cfg.error}`);
  const prov: Proveedor | undefined =
    opts.proveedor ?? (cfg.config.proveedor === "off" ? "openrouter" : undefined);
  const cap0 = opts.maxChars ?? cfg.config.maxChars;
  const timeout = opts.timeoutMs ?? cfg.config.timeoutMs;
  const reintentos = opts.reintentosTruncado ?? 1;
  const { system, user } = promptCoder(ruta, spec);
  const base = `${system}\n\n${user}`;
  let cap = cap0;
  for (let intento = 0; intento <= reintentos; intento++) {
    const r = await spawn(root, intento === 0 ? base : base + SUFIJO_REINTENTO, {
      maxChars: cap,
      timeoutMs: timeout,
      model: opts.model,
      proveedor: prov,
      key: opts.key,
    });
    if (!r.ok) throw new Error(`coder LLM (${r.proveedor}/${r.model}): ${r.error}`);
    if (!r.truncada) return r.text ?? "";
    cap = Math.min(cap * 2, TOPE_MAXCHARS);
  }
  throw new Error(`coder LLM: respuesta truncada aun tras reintento (techo ${cap})`);
}
