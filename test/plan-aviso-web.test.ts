// El motivo de la falta de búsqueda externa no se queda escondido dentro del
// prompt: en modo Plan el chat lo recibe como aviso_busqueda y lo muestra como
// línea de sistema (falta de clave, aprobación pendiente, política en contra).
// Se prueba de punta a punta contra el servidor real y un proveedor simulado
// local, sin red.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PAGE, startWeb } from "../dist/web.js";
import { crearSesion, mensajesDe } from "../dist/sessions.js";
import { saveConfig } from "../dist/modules/adapters/config.js";

test("el Plan avisa en el chat por qué no hubo búsqueda externa", async () => {
  const base = mkdtempSync(join(tmpdir(), "axiom-aviso-"));
  const mock = createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "## Plan\n\n- paso uno\n" } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    });
  });
  await new Promise<void>((ok) => mock.listen(0, "127.0.0.1", ok));
  const puertoMock = (mock.address() as AddressInfo).port;
  // El driver exige una key aunque el proveedor sea local: fail closed.
  process.env.OPENAI_API_KEY = "test-key";
  try {
    writeFileSync(join(base, "axiom.json"), "{}");
    writeFileSync(join(base, "axiom.db"), "");
    saveConfig(base, { proveedor: "openai", model: "mock", baseUrl: `http://127.0.0.1:${puertoMock}`, timeoutMs: 10_000, maxChars: 8_000 });
    const srv = startWeb(base, 0);
    try {
      const s = crearSesion(base, "aviso", "plan");
      assert.equal(s.ok, true);
      if (!s.ok) return;
      const r = await fetch(`http://127.0.0.1:${srv.port}/api/chat/enviar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: s.sesion.id, modo: "plan", texto: "un dashboard de kiosco con productos, ventas y reportes", stream: false }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; aviso_busqueda?: string };
      assert.equal(d.ok, true, d.error);
      assert.ok(d.aviso_busqueda, "el aviso viaja con la respuesta del Plan");
      assert.match(String(d.aviso_busqueda), /b[uú]squeda|referencias|aprobaci|clave/i);
      // Y queda en el historial: recargar el chat lo sigue mostrando.
      const msgs = mensajesDe(base, s.sesion.id);
      assert.equal(msgs.ok, true);
      if (!msgs.ok) return;
      const sistema = msgs.mensajes.filter((m) => m.rol === "sistema").map((m) => m.texto);
      assert.ok(sistema.some((t) => t === d.aviso_busqueda), `el aviso se persiste: ${JSON.stringify(sistema)}`);
    } finally {
      srv.close();
    }
  } finally {
    await new Promise<void>((ok) => mock.close(() => ok()));
    delete process.env.OPENAI_API_KEY;
    rmSync(base, { recursive: true, force: true });
  }
});

// El aviso con id pendiente se puede resolver sin salir del chat: el botón
// aprueba por /api/decide y reenvía el mismo pedido para que el plan salga con
// referencias. Sin id (política cerrada, sin clave) no hay botón que prometer.
test("el aviso con aprobación pendiente trae botón para aprobar y reintentar", () => {
  assert.match(PAGE, /function avisoBoton\(d,t,textoPlan\)/);
  assert.match(PAGE, /axiom approve \(\[0-9a-f\]\{8\}\)/);
  // El id viaja con el reintento: el servidor concede la aprobación para esa
  // corrida y la revoca al terminar si la búsqueda no la gastó.
  assert.match(PAGE, /sendChat\(textoPlan,undefined,m\[1\]\)/);
  assert.match(PAGE, /aprobacion:aprobacion\|\|''/);
  // Se usa tanto en vivo (avisoLinea) como al reabrir el chat (chatmessage).
  assert.match(PAGE, /avisoLinea\(d\.aviso_busqueda,text\)/);
  assert.match(PAGE, /if\(m\.rol==='sistema'\)avisoBoton\(d,m\.texto,lastUsuario\)/);
});
