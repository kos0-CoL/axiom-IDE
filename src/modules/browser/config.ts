// Módulo browser — config (opcional: el módulo funciona sin archivo de config).
import { z } from "zod";

export const Config = z.object({
  // Binario del navegador; si falta, se auto-detecta (Playwright cache > sistema).
  executablePath: z.string().min(1).optional(),
  // Timeout de la captura en ms (default 20000).
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  // Pasar --no-sandbox al Chromium (solo para entornos aislados/contenedores).
  noSandbox: z.boolean().optional(),
});
