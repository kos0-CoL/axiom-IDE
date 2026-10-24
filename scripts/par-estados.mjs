// par-estados: estados de error visibles por vista en web.ts.
// Inserta errbox() + guardacargando() y añade .catch a cada cadena de carga.
// Trabaja por anclas exactas y aborta si cualquier precondición falla.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const p = fileURLToPath(new URL("../src/web.ts", import.meta.url));
const lines = readFileSync(p, "utf8").split("\n");
const n0 = lines.length;
const msgs = [];

function assert(cond, msg) {
  if (!cond) { console.error("par-estados FALLO: " + msg); process.exit(1); }
}

function matches(s) { return lines.map((l, i) => [i, l]).filter(([, l]) => l.includes(s)).map(([i]) => i); }
function count(s) { return matches(s).length; }

function replaceAt(i, nuev) {
  lines[i] = nuev;
}

// ── 1) reemplaza el bloque errload viejo (mensajeRed/retryTimer) por errbox + guardacargando ──
const iCom = matches("// Muestra un error de carga");
assert(iCom.length === 1 && count("// Muestra un error") === 1, "comentario errload único");
const a = iCom[0];
let b = -1;
for (let i = a; i < lines.length; i++) if (lines[i].includes("String(e)) : ")) { b = i; break; }
assert(b > a, "cierre mensajeRed encontrado");
let c = -1;
for (let i = b; i < lines.length; i++) if (lines[i] === "'}',") { c = i; break; }
assert(c > b, "'}', de mensajeRed");
const BLOCK_ERR = `// Estados de error por vista: si un fetch falla o no responde, la caja lo
// dice en rojo y no se queda en Cargando... como si estuviera trabajando.
'function errbox(id, causa) {',
'  var box = document.getElementById(id); if (!box) return;',
'  var m = String(causa && causa.message ? causa.message : (causa || "fetch fallido")).slice(0, 180);',
'  box.innerHTML = "<div class=errorbox><strong>NO SE PUDO CARGAR</strong> — " + esc(m) + "<div class=hint>El servidor no respondió: revisa que axiom siga corriendo y pulsa Actualizar (o Ctrl+R).</div></div>";',
'}',
'function guardacargando() {',
'  var ids = ["orq-techo", "orq-tareas", "orq-agentes", "orq-timeline", "red", "memoria", "tra", "apr", "modlist", "allowchips", "holog", "dagcfg", "modpanel"];',
'  ids.forEach(function(id) {',
'    var e = document.getElementById(id);',
'    if (e && String(e.textContent || "").indexOf("Cargando") >= 0) errbox(id, "el servidor no respondió (timeout de carga)");',
'  });',
'}',`;
lines.splice(a, c - a + 1, BLOCK_ERR);
msgs.push(`errbox+guardacargando insertados (${c - a + 1} líneas sustituidas)`);

// ── 2) CSS errorbox sin hex fuera de :root ──
const iCss = matches(".errorbox{border:1px solid #b3402f");
assert(iCss.length === 1, "línea CSS errorbox");
replaceAt(iCss[0], "'.errorbox{border:1px solid var(--bad);color:var(--bad);border-radius:8px;padding:10px;margin-top:8px;font-size:var(--fs-md)}',");

// ── 3) redload reescrito con catch en ambas cadenas ──
function span(fn) {
  const inicio = matches(`'function ${fn}() {',`);
  assert(inicio.length === 1, `inicio único de ${fn}`);
  const i = inicio[0];
  let j = -1;
  for (let k = i + 1; k < lines.length; k++) if (lines[k] === "'}',") { j = k; break; }
  assert(j > i, `cierre de ${fn}`);
  return [i, j];
}
function rewrite(fn, nuevas) {
  const [i, j] = span(fn);
  const viejo = lines.slice(i, j + 1);
  lines.splice(i, j - i + 1, ...nuevas);
  msgs.push(`${fn}: ${j - i + 1} → ${nuevas.length}`);
  return viejo;
}
rewrite("redload", [
  "'function redload() {',",
  "'  fetch(\"api/agents\").then(function(r) { return r.json(); }).then(function(d) {',",
  "'    if (!d.ok) { errbox(\"red\", \"el nodo respondió sin ok\"); return; }',",
  "'    fetch(\"api/agents/handoffs\").then(function(r) { return r.json(); }).then(function(h) {',",
  "'      redpinta(d, h.ok ? h.handoffs : []);',",
  "'      var br = document.getElementById(\"orq-agentes\");',",
  "'      if (br) br.innerHTML = agred(d);',",
  "'      var s = document.getElementById(\"redcuando\");',",
  "'      if (s) s.textContent = \"Actualizado \" + new Date().toLocaleTimeString() + \" · auto cada 5s\";',",
  "'    }).catch(function(h2) { errbox(\"red\", h2); });',",
  "'  }).catch(function(e) { errbox(\"red\", e); });',",
  "'}',",
]);
rewrite("memload", [
  "'function memload() {',",
  "'  fetch(\"api/agents/experience?n=3\").then(function(r) { return r.json(); }).then(function(e) {',",
  "'    return fetch(\"api/agents/propuestas\").then(function(r) { return r.json(); }).then(function(p) {',",
  "'      return fetch(\"api/agents/snapshot\").then(function(r) { return r.json(); }).then(function(s) {',",
  "'        mempinta(e.ok ? e.lecciones : \"\", p.ok ? p.propuestas : [], s.ok ? s : null);',",
  "'        var m = document.getElementById(\"memcuando\");',",
  "'        if (m) m.textContent = \"Actualizado \" + new Date().toLocaleTimeString() + \" · auto cada 5s\";',",
  "'      });',",
  "'    });',",
  "'  }).catch(function(e) { errbox(\"memoria\", e); });',",
  "'}',",
]);
rewrite("agload", [
  "'function agload() {',",
  "'  fetch(\"api/agents\").then(function(r) { return r.json(); }).then(function(d) {',",
  "'    if (!d.ok) { errbox(\"orq-agentes\", \"el nodo respondió sin ok\"); return; }',",
  "'    var nl = String.fromCharCode(10);',",
  "'    var txt = d.agentes.map(function(a) { return \"[\" + a.rol + \"] \" + a.id + \" (\" + a.estado + \") skills: \" + (a.skills.join(\", \") || \"—\"); }).join(nl);',",
  "'    txt += nl + d.aristas.map(function(e) { return \"  \" + e.de + \" ──\" + e.tipo + \"──▶ \" + e.a; }).join(nl);',",
  "'    document.getElementById(\"dagcfg\").textContent = txt;',",
  "'    var box = document.getElementById(\"orq-agentes\");',",
  "'    if (box) { box.innerHTML = agred(d); return; }',",
  "'  }).catch(function(e) { errbox(\"orq-agentes\", e); errbox(\"dagcfg\", e); });',",
  "'}',",
]);

// ── 4) .catch en load(): cadena orquestacion (línea anterior a api/trabajo) ──
const itra = matches("api/trabajo").filter((i) => !lines[i].includes("/api/trabajo"));
assert(itra.length === 1, "fetch api/trabajo único");
assert(lines[itra[0] - 1] === "'  });',", `ancla previa a api/trabajo (recibido: ${lines[itra[0] - 1]})`);
replaceAt(itra[0] - 1, "'  }).catch(function(e) { errbox(\"orq-tareas\", e); errbox(\"orq-timeline\", e); errbox(\"orq-techo\", e); errbox(\"apr\", e); });',");
// cadena trabajo: línea siguiente a "Sin specs: usa /init"
const ispec = matches("Sin specs: usa /init");
assert(ispec.length === 1, "Sin specs único");
assert(lines[ispec[0] + 1] === "'  });',", "ancla db trabajo");
replaceAt(ispec[0] + 1, "'  }).catch(function(e) { errbox(\"tra\", e); });',");

// ── 5) modload, allowload, handoffsload: añade catch al cierre de su única cadena ──
function catchAt(fn, targets) {
  const [i, j] = span(fn);
  const dentro = lines.slice(i + 1, j);
  const cierres = [];
  dentro.forEach((l, k) => { if (l === "'  });',") cierres.push(i + 1 + k); });
  assert(cierres.length === 1, `${fn}: una cadena de cierre  }); (recibido ${cierres.length})`);
  replaceAt(cierres[0], "'  }).catch(function(e) { " + targets + " });',");
  msgs.push(`${fn}: catch a manera de ${targets}`);
}
catchAt("modload", "errbox(\"modlist\", e)");
catchAt("allowload", "errbox(\"allowchips\", e)");
catchAt("handoffsload", "errbox(\"holog\", e)");

// ── 6) modir/modgrafo: catch y mostrar el panel con error ──
const inav = matches("'    nav(\"mod\");',");
assert(inav.length === 2, `nav("mod") dos, recibido ${inav.length}`);
inav.sort((x, y) => y - x).forEach((i) => {
  assert(lines[i + 1] === "'  });',", "ancla cerrada tras nav(mod)");
  replaceAt(i + 1, "'  }).catch(function(e) { errbox(\"modpanel\", e); nav(\"mod\"); });',");
});

// ── 7) chatprov: catch al cierre de su cadena (antes de var sesactual) ──
const ises = matches("'var sesactual = \"\";',");
assert(ises.length === 1, "var sesactual único");
let icp = -1;
for (let k = ises[0] - 1; k > 0; k--) if (lines[k] === "'  });',") { icp = k; break; }
assert(icp > 0 && lines[icp + 1] === "'}',", "ancla chatprov (cierre de cadena dos líneas antes)");
replaceAt(icp, "'  }).catch(function(e) { var elchat = document.getElementById(\"chatprov\"); if (elchat) { elchat.textContent = \"Proveedor: sin respuesta\"; elchat.className = \"pill off\"; } var spx = document.getElementById(\"st-prov\"); if (spx) spx.textContent = \"Proveedor: sin respuesta\"; });',");

// ── 8) cfgmodelos: catch en la rama no openrouter ──
const ictx = matches("then(pintar); return; }");
assert(ictx.length === 1, "rama no openrouter única");
replaceAt(ictx[0], "'  if (p !== \"openrouter\") { fetch(url).then(function(r) { return r.json(); }).then(pintar).catch(function(e) { document.getElementById(\"cfgnote\").textContent = \"ERROR — \" + String(e && e.message ? e.message : e); }); return; }',");

// ── 9) boot: append del guardián en la misma línea filtrada por tests ──
const iboot = matches("redauto(); agwire();");
assert(iboot.length === 1, "línea de arranque única");
replaceAt(iboot[0], "'load(); chatprov(); tgcfg(); agload(); secpres(); cfgmodelos(); proy(); seslist(); skilload(); modload(); modnav(); handoffsload(); allowload(); redload(); redauto(); agwire(); setInterval(guardacargando, 20000);',");

// ── saneos ──
assert(lines.join("\n").includes("function errbox("), "errbox presente");
assert(!lines.join("\n").includes("mensajeRed"), "sin referencias a mensajeRed");
assert(!lines.join("\n").includes("retryTimer"), "sin referencias a retryTimer");
assert(count("NO SE PUDO CARGAR") === 1, "una sola plantilla de error");
msgs.push(`total líneas: ${n0} → ${lines.length}`);
msgs.push("catches en 8 cadenas; boot con guardacargando");

writeFileSync(p, lines.join("\n"));
console.log("par-estados OK\n" + msgs.join("\n"));
