// Guardia de vocabulario (ADR-0007): lo que falla es afirmar que Axiom es un
// swarm. Citar AutoGen u OpenAI Swarm, o nombrar la topología para negarla, es
// legítimo — si la guardia no distingue eso, se desactiva a la semana.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { documentosDelRepo, revisarDocumento, revisarVocabulario } from "../dist/vocabulario.js";

// dist-test/<archivo>.js → la raíz del repo es su directorio padre.
const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");

test("falla la afirmación de que Axiom es un swarm", () => {
  const casos = [
    "Axiom es un swarm de agentes que negocian entre sí.",
    "La orquestación de Axiom funciona como un enjambre sin coordinador.",
    "Nuestros agentes forman un swarm que se auto-organiza.",
    "Nuestro sistema es un enjambre de agentes.",
    "Axiom es un swarm, no un supervisor.", // la negación después no salva la frase
  ];
  for (const texto of casos) {
    assert.equal(revisarVocabulario(texto).length, 1, `debería fallar: ${texto}`);
  }
});

test("pasa la topología nombrada para negarla", () => {
  const casos = [
    "La orquestación de Axiom es un supervisor jerárquico con handoffs, no un swarm.",
    "Axiom no es un swarm: el siguiente agente sale de una arista declarada.",
    "Axiom es jerárquico, a diferencia de un enjambre que se auto-organiza.",
    "Lejos de un swarm, cada delegación la decide el broker.",
  ];
  for (const texto of casos) {
    assert.deepEqual(revisarVocabulario(texto), [], `no debería fallar: ${texto}`);
  }
});

test("pasa citar terceros o definir el enjambre sin hablar de Axiom", () => {
  const casos = [
    "El equipo `Swarm` de AutoGen elige el siguiente agente por handoff.",
    "Un enjambre se define por control descentralizado y auto-organización.",
    "| Criterio | Swarm | Supervisor jerárquico |",
    "OpenAI Swarm es un recurso educativo; el equipo Swarm de AutoGen decide localmente.",
  ];
  for (const texto of casos) {
    assert.deepEqual(revisarVocabulario(texto), [], `no debería fallar: ${texto}`);
  }
});

test("ve la afirmación aunque el párrafo venga envuelto en dos líneas", () => {
  const texto = "La orquestación\nde Axiom es un\nswarm con agentes que se eligen solos.";
  const fallos = revisarVocabulario(texto);
  assert.equal(fallos.length, 1);
  assert.match(fallos[0].oracion, /swarm con agentes/);
});

test("los docs del repo no describen Axiom como swarm", () => {
  const archivos = documentosDelRepo(raiz);
  assert.ok(archivos.length >= 2, `esperaba docs que revisar, encontré ${archivos.length}`);
  const fallos: string[] = [];
  for (const ruta of archivos) {
    for (const v of revisarDocumento(ruta)) fallos.push(`${ruta}:${v.linea} — ${v.oracion}`);
  }
  assert.deepEqual(fallos, []);
});
