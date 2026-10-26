// Migración de configs anteriores a la cota del agente: el esqueleto viejo no
// declaraba herramientas, así que un handoff pasaba solo con la arista. Ahora la
// herramienta `delega` debe estar declarada por quien delega; al cargar un config
// que la omitía se añade `delega=allow` (una vez, persistido) en lugar de obligar
// a editar cada proyecto a mano.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asegurarProyecto } from "../dist/proyectos.js";
import { loadAgents } from "../dist/modules/agents/config.js";
import { handoff } from "../dist/modules/agents/handoff.js";

function conProyecto(fn: (root: string) => void): void {
  const base = mkdtempSync(join(tmpdir(), "axiom-migracion-"));
  const root = join(base, "p");
  try {
    assert.deepEqual(asegurarProyecto(root), { ok: true });
    // La política sigue siendo el techo: se permite a propósito para que la única
    // variable del test sea la declaración del agente.
    writeFileSync(join(root, "policies.global.json"), JSON.stringify({ tools: { delega: true }, techo: { rondas: 3, tokens: 100000, calls: 500 } }, null, 2) + "\n");
    writeFileSync(join(root, "project.json"), JSON.stringify({ tools: { delega: true }, presupuesto: { tokens: 50000, calls: 200 } }, null, 2) + "\n");
    fn(root);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function configVieja(root: string, extra?: (cfg: any) => void): void {
  const cfg: any = {
    nombre: "proyecto-viejo",
    agentes: [
      { id: "orquestador", rol: "orquestador", herramientas: [] },
      { id: "implementador", rol: "nodo", herramientas: [] },
      { id: "verificador", rol: "nodo" },
      { id: "revisor", rol: "nodo", herramientas: [] },
    ],
    aristas: [
      { de: "orquestador", a: "implementador", tipo: "delega" },
      { de: "implementador", a: "verificador", tipo: "escala" },
      { de: "revisor", a: "orquestador", tipo: "comunica" },
    ],
  };
  if (extra) extra(cfg);
  writeFileSync(join(root, "agents.config.json"), JSON.stringify(cfg, null, 2) + "\n");
}

test("un config anterior recibe delega=allow solo en quien delega, y una sola vez", () => {
  conProyecto((root) => {
    configVieja(root);
    const carga = loadAgents(root);
    assert.ok(carga.ok, `no cargó: ${!carga.ok ? carga.error : ""}`);
    if (!carga.ok) return;
    assert.equal(carga.reparado, true, "la migración debe reportarse como reparación");
    const porId = new Map(carga.config.agentes.map((a) => [a.id, a]));
    const delega = (id: string) => porId.get(id)?.herramientas.find((h) => h.tool === "delega");
    // Delega por arista (delega o escala): se le devuelve el permiso que tenía antes.
    assert.equal(delega("orquestador")?.acceso, "allow");
    assert.equal(delega("implementador")?.acceso, "allow");
    // Sin aristas de delegación salientes no se inventa nada.
    assert.equal(delega("verificador"), undefined);
    assert.deepEqual(porId.get("verificador")?.herramientas, []);
    // Comunica no es delegar.
    assert.equal(delega("revisor"), undefined);

    // El handoff vuelve a funcionar sin tocar el archivo a mano.
    const h = handoff(root, "orquestador", "implementador", "revisar el plan");
    assert.doesNotMatch(h, /denegado/);
    assert.match(h, /registrado|pendiente de aprobación/);

    // Se persiste una vez y conserva las claves que zod no modela (`nombre`).
    const enDisco = JSON.parse(readFileSync(join(root, "agents.config.json"), "utf8"));
    assert.equal(enDisco.nombre, "proyecto-viejo");
    assert.equal(enDisco.config_version, 2, "queda sellado: la migración no se repite");
    const orq = enDisco.agentes.find((a: any) => a.id === "orquestador");
    assert.deepEqual(orq.herramientas, [{ tool: "delega", acceso: "allow" }]);
    const segunda = loadAgents(root);
    assert.ok(segunda.ok);
    assert.ok(segunda.ok && !segunda.reparado, "la segunda carga no debe reportar reparación");
  });
});

test("un deny explícito de delega no se migra ni se aprueba", () => {
  conProyecto((root) => {
    configVieja(root, (cfg) => {
      cfg.agentes[0].herramientas = [{ tool: "delega", acceso: "deny" }];
      // El otro delegante ya declara: así la única variable es el deny explícito.
      cfg.agentes[1].herramientas = [{ tool: "delega", acceso: "allow" }];
    });
    const carga = loadAgents(root);
    assert.ok(carga.ok);
    if (!carga.ok) return;
    assert.ok(!carga.reparado, "una declaración explícita no se toca");
    const orq = carga.config.agentes.find((a) => a.id === "orquestador");
    assert.deepEqual(orq?.herramientas, [{ tool: "delega", acceso: "deny" }]);
    const h = handoff(root, "orquestador", "implementador", "revisar el plan");
    assert.match(h, /denegado/);
    assert.match(h, /declara delega=deny/);
  });
});

test("un config ya sellado no se migra: sin declaración sigue denegando", () => {
  conProyecto((root) => {
    configVieja(root, (cfg) => {
      cfg.config_version = 2;
    });
    const carga = loadAgents(root);
    assert.ok(carga.ok);
    if (!carga.ok) return;
    assert.ok(!carga.reparado);
    const orq = carga.config.agentes.find((a) => a.id === "orquestador");
    assert.deepEqual(orq?.herramientas, [], "en un config actual no se inventa delega");
    assert.match(handoff(root, "orquestador", "implementador", "revisar el plan"), /denegado/);
  });
});

test("un config ya migrado no se reescribe aunque falten otras claves", () => {
  conProyecto((root) => {
    configVieja(root, (cfg) => {
      cfg.config_version = 2;
      cfg.agentes[0].herramientas = [{ tool: "delega", acceso: "ask" }];
      cfg.agentes[1].herramientas = [{ tool: "delega", acceso: "allow" }];
    });
    const antes = readFileSync(join(root, "agents.config.json"), "utf8");
    const carga = loadAgents(root);
    assert.ok(carga.ok);
    if (!carga.ok) return;
    assert.ok(!carga.reparado);
    assert.equal(readFileSync(join(root, "agents.config.json"), "utf8"), antes, "no debe tocar el archivo");
  });
});
