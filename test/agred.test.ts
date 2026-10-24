// El grafo de agentes no es un dibujo estatico: agred() pinta nodos y flechas y
// agload() lo redibuja con cada cambio de configuracion. Estos tests ejercitan el
// script real de la pagina (PAGE) en un contexto vm con un DOM minimo.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { PAGE } from "../dist/web.js";

interface El {
  id: string;
  style: Record<string, string>;
  value: string;
  textContent: string;
  innerHTML: string;
  className: string;
  oyentes: Record<string, unknown>;
  addEventListener(tipo: string, fn: unknown): void;
  focus(): void;
  setAttribute(): void;
  getAttribute(): string | null;
  appendChild(): void;
  querySelector(): null;
  querySelectorAll(): unknown[];
  classList: { add(): void; remove(): void; toggle(): void };
}

const DATOS = {
  ok: true,
  agentes: [
    { id: "orquestador", rol: "orquestador", estado: "activo", skills: ["plan"], instrucciones: "coordina el trabajo", herramientas: [] },
    { id: "nodo-code", rol: "nodo", estado: "activo", skills: ["implementar"], instrucciones: "", herramientas: [{ tool: "fs", acceso: "ask" }] },
    { id: "nodo-review", rol: "nodo", estado: "pausado", skills: ["review"], instrucciones: "", herramientas: [] },
    { id: "esp-seguridad", rol: "especializado", estado: "activo", skills: ["policy"], instrucciones: "", herramientas: [] },
  ],
  aristas: [
    { de: "orquestador", a: "nodo-code", tipo: "delega" },
    { de: "orquestador", a: "nodo-review", tipo: "delega" },
    { de: "nodo-code", a: "esp-seguridad", tipo: "escala" },
    { de: "nodo-review", a: "orquestador", tipo: "comunica" },
  ],
};

// Arranca el script real de la pagina sobre un DOM minimo: solo "api/agents"
// devuelve datos; el resto responde ok:false y cada vista se retira. La linea de
// auto-arranque se quita porque el stub no puede servir toda la pagina; los
// tests disparan las funciones a mano.
function arrancar(datos: () => unknown) {
  const els = new Map<string, El>();
  const mk = (id: string): El => {
    let e = els.get(id);
    if (!e) {
      e = {
        id,
        style: {},
        value: "",
        textContent: "",
        innerHTML: "",
        className: "",
        oyentes: {},
        addEventListener(tipo: string, fn: unknown) {
          this.oyentes[tipo] = fn;
        },
        focus() {},
        setAttribute() {},
        getAttribute: () => null,
        appendChild() {},
        querySelector: () => null,
        querySelectorAll: () => [],
        classList: { add() {}, remove() {}, toggle() {} },
      };
      els.set(id, e);
    }
    return e;
  };
  const fetchStub = (url: string) =>
    Promise.resolve({ json: () => Promise.resolve(url === "api/agents" ? datos() : { ok: false }) });
  const ctx: Record<string, unknown> = {
    console,
    fetch: fetchStub,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: {
      hidden: false,
      getElementById: mk,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      createElement: () => mk("tmp-" + Math.random()),
      body: { appendChild() {}, classList: { toggle() {} } },
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const ini = PAGE.lastIndexOf("<script>") + "<script>".length;
  const fin = PAGE.lastIndexOf("</script>");
  const js = PAGE.slice(ini, fin)
    .split("\n")
    .filter((l) => !l.includes("redauto(); agwire();"))
    .join("\n");
  try {
    new vm.Script(js).runInContext(ctx);
  } catch {
    // con el DOM stub algo del arranque puede fallar; las funciones ya quedan
    // declaradas en el contexto.
  }
  return { ctx, els };
}

const espera = () => new Promise((r) => setImmediate(r));
const fn = (ctx: Record<string, unknown>, nombre: string) => ctx[nombre] as (...a: unknown[]) => unknown;

test("agred dibuja nodos, flechas con punta y tooltips HTML sin title nativo", () => {
  const { ctx } = arrancar(() => ({ ok: false }));
  const svg = String(fn(ctx, "agred")(DATOS));
  assert.ok(svg.startsWith("<svg"), "empieza con <svg>");
  assert.equal(svg.split('class="agnodo"').length - 1, 4, "cuatro nodos");
  assert.equal(svg.split('marker-end="url(#agarrow)"').length - 1, 4, "cuatro flechas con punta");
  assert.ok(svg.includes('data-ag="esp-seguridad"'), "nodos con data-ag para el clic");
  assert.ok(svg.includes('data-tip="'), "tooltips como atributo data-tip");
  assert.ok(!svg.includes("<title>"), "ya no usa el title nativo del navegador");
  assert.ok(svg.includes("instrucciones: coordina el trabajo"), "el tooltip trae las instrucciones");
  assert.ok(svg.includes("delega"), "las aristas etiquetan su tipo");
});

test("agload redibuja el grafo cuando cambia la configuracion", async () => {
  let datos: unknown = DATOS;
  const { ctx, els } = arrancar(() => datos);
  fn(ctx, "agload")();
  await espera();
  let html = els.get("orq-agentes")!.innerHTML;
  assert.ok(html.includes('data-ag="nodo-code"'));
  assert.equal(html.split('class="agnodo"').length - 1, 4);

  // se anade un agente y el dibujo se actualiza solo (sin recargar la pagina)
  datos = {
    ok: true,
    agentes: [
      ...DATOS.agentes,
      { id: "nuevo-agente", rol: "subagente", estado: "activo", skills: [], instrucciones: "", herramientas: [] },
    ],
    aristas: [...DATOS.aristas, { de: "orquestador", a: "nuevo-agente", tipo: "delega" }],
  };
  fn(ctx, "agload")();
  await espera();
  html = els.get("orq-agentes")!.innerHTML;
  assert.ok(html.includes('data-ag="nuevo-agente"'), "el agente nuevo aparece sin recargar");
  assert.equal(html.split('class="agnodo"').length - 1, 5);
});

test("agwire cablea el tooltip y el clic en el contenedor del grafo", () => {
  const { ctx, els } = arrancar(() => ({ ok: false }));
  fn(ctx, "agwire")();
  const oyentes = els.get("orq-agentes")!.oyentes;
  assert.ok(oyentes.mousemove, "mousemove para el tooltip");
  assert.ok(oyentes.mouseleave, "mouseleave para ocultarlo");
  assert.ok(oyentes.click, "click para abrir edicion");
});

test("hacer clic en un nodo abre el modo Editar con ese agente", () => {
  const { ctx, els } = arrancar(() => ({ ok: false }));
  fn(ctx, "agwire")();
  const evento = {
    target: {
      closest: (sel: string) => (sel === "[data-ag]" ? { getAttribute: () => "nodo-review" } : null),
    },
  };
  (els.get("orq-agentes")!.oyentes.click as (e: unknown) => void)(evento);
  assert.equal(els.get("agform")!.style.display, "flex", "se muestra el formulario de edicion");
  assert.equal(els.get("agedid")!.value, "nodo-review", "con el id del nodo pulsado");
  assert.equal(els.get("v-cfg")!.className, "view on", "en la vista de Configuracion");

  fn(ctx, "agabrir")("esp-seguridad");
  assert.equal(els.get("agedid")!.value, "esp-seguridad");
});

test("los tooltips son una capa HTML que sigue al cursor", () => {
  const { ctx, els } = arrancar(() => ({ ok: false }));
  const nodo = { closest: () => ({ getAttribute: () => "nodo-code [nodo] · activo" }) };
  fn(ctx, "agtipmove")({ target: nodo, clientX: 10, clientY: 20 });
  const tip = els.get("agtip")!;
  assert.equal(tip.style.display, "block", "visible al pasar el cursor");
  assert.equal(tip.textContent, "nodo-code [nodo] · activo");
  assert.equal(tip.style.left, "24px", "colocado junto al cursor");
  fn(ctx, "agtipout")();
  assert.equal(tip.style.display, "none", "oculto al salir");
});

test("un fetch que falla deja estado de error visible y ninguna caja en Cargando...", async () => {
  // ok:false ya dispara la rama de errbox en agload; errbox directo cubre las demás cajas.
  const { ctx, els } = arrancar(() => ({ ok: false }));
  fn(ctx, "agload")();
  await espera();
  assert.ok(els.get("orq-agentes")!.innerHTML.includes("NO SE PUDO CARGAR"), "dragcfg muestra estado de error");
  assert.ok(!els.get("orq-agentes")!.innerHTML.includes("Cargando"), "no queda Cargando en el grafo");

  fn(ctx, "errbox")("tra", "simulado: servidor sin respuesta");
  assert.ok(els.get("tra")!.innerHTML.includes("NO SE PUDO CARGAR"), "Trabajo muestra el error");
  assert.ok(els.get("tra")!.innerHTML.includes("simulado: servidor sin respuesta"), "con la causa");

  // el guardián convierte cualquier caja rezagada en Cargando... en estado de error
  fn(ctx, "errbox")("apr", "toque inicial"); // crea la caja en el DOM virtual
  const caja = els.get("apr")!;
  caja.textContent = "Cargando...";
  fn(ctx, "guardacargando")();
  assert.ok(caja.innerHTML.includes("NO SE PUDO CARGAR"), "el guardián rescata apr");
});
