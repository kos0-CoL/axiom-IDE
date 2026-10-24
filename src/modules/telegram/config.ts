// Módulo telegram — configuración propia del módulo. Fail closed: sin config válida no hay remoto.
// El CLI la gestiona con `telegram allow|unallow|expira|config`; no se edita a mano.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

export const TelegramConfig = z.object({
  enabled: z.boolean().default(false),
  allowlist: z.array(z.string().min(1).max(64)).default([]),
  expiracionMin: z.number().int().min(1).max(1440).default(30),
});
export type TelegramConfig = z.infer<typeof TelegramConfig>;

export const CONFIG_FILE = "telegram.config.json";
const LEGACY_FILE = "telegram.allowlist.json";

export function configPath(root: string): string {
  return join(root, CONFIG_FILE);
}

export function loadConfig(root: string): { ok: true; config: TelegramConfig; migrated: boolean } | { ok: false; error: string } {
  const p = configPath(root);
  if (!existsSync(p)) {
    // Sin archivo no hay remoto (allowlist vacía). Se adopta el legado una vez, sin borrarlo.
    let allowlist: string[] = [];
    let migrated = false;
    try {
      const lp = join(root, LEGACY_FILE);
      if (existsSync(lp)) {
        const raw = JSON.parse(readFileSync(lp, "utf8"));
        if (Array.isArray(raw)) {
          allowlist = raw.filter((x) => typeof x === "string" && x.length > 0 && x.length <= 64);
          migrated = true;
        }
      }
    } catch { /* legado ilegible: se ignora, fail closed igual */ }
    return { ok: true, config: { enabled: false, allowlist, expiracionMin: 30 }, migrated };
  }
  try {
    const r = TelegramConfig.safeParse(JSON.parse(readFileSync(p, "utf8")));
    if (!r.success) return { ok: false, error: `telegram.config.json inválido: ${r.error.issues.map((i) => i.message).join("; ")}` };
    return { ok: true, config: r.data, migrated: false };
  } catch (e) {
    return { ok: false, error: `telegram.config.json ilegible: ${e instanceof Error ? e.message : e}` };
  }
}

export function saveConfig(root: string, cfg: TelegramConfig): void {
  writeFileSync(configPath(root), JSON.stringify(cfg, null, 2) + "\n");
}
