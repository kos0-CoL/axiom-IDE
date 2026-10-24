---PROY---
function proynuevo() {
  fetch("api/proyecto").then(function(r) { return r.json(); }).then(function(d) {
    var caja = document.getElementById("proyrecmodal");
    if (caja) {
      caja.innerHTML = "";
      (d.recientes || []).forEach(function(ruta) {
        var f = document.createElement("div"); f.className = "tfold";
        f.textContent = ruta.split("/").filter(Boolean).pop() || ruta;
        f.onclick = (function(ru) { return function() { proyusar(ru); }; })(ruta);
        caja.appendChild(f);
      });
      if (!d.recientes || !d.recientes.length) caja.textContent = "Sin recientes.";
    }
    var m = document.getElementById("proymodal");
    if (m) {
      m.style.display = "flex";
      var nb = document.getElementById("proynombre"); if (nb) nb.focus();
      var bs = document.getElementById("proybase"); if (bs && d.home) bs.value = d.home;
    }
  });
}
function proycerrar() { var m = document.getElementById("proymodal"); if (m) m.style.display = "none"; }
function proymsg(t) { var el = document.getElementById("proymsg"); if (el) el.textContent = t; }
function proycrear() {
  var n = document.getElementById("proynombre").value.trim();
  if (!n) { proymsg("Escribe el nombre de la carpeta."); return; }
  fetch("api/proyecto/crear", { method: "POST", body: JSON.stringify({ nombre: n, base: document.getElementById("proybase").value.trim() }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (!d.ok) { proymsg(d.error || "no se pudo crear"); return; }
      proycerrar(); recargarProyecto(d.root || d.path, "Proyecto creado y en uso: " + (d.root || d.path));
    });
}
function proyusarbtn() {
  var p = document.getElementById("proyruta").value.trim();
  if (!p) { proymsg("Escribe la ruta absoluta de la carpeta."); return; }
  proyusar(p, true);
}
function proyusar(ruta, oculto) {
  fetch("api/proyecto/usar", { method: "POST", body: JSON.stringify({ path: ruta }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      if (!d.ok) { if (oculto) sysline("ERROR — " + (d.error || "no se pudo usar")); else proymsg(d.error || "no se pudo usar"); return; }
      proycerrar(); recargarProyecto(d.root || ruta, "Proyecto en uso: " + (d.root || ruta));
    });
}
function recargarProyecto(root, mensaje) {
  sesactual = ""; sestitulo = ""; chatlimpia();
  proy(); seslist(); modload(); modnav(); allowload(); secpres(); chatprov(); cfgmodelos(); skilload(); handoffsload(); load();
  sysline(mensaje);
}
---SEC---
function secolvidar(k) {
  if (!confirm("¿Borrar " + k + " del servidor? El módulo que la use no podrá actuar hasta que vuelvas a ponerla.")) return;
  fetch("api/secrets/olvidar", { method: "POST", body: JSON.stringify({ key: k }) })
    .then(function(r) { return r.json(); }).then(function(d) { sysline(d.msg || d.error || ""); secpres(); });
}
---TG---
function tgdetectar() {
  fetch("api/telegram/detectar").then(function(r) { return r.json(); }).then(function(d) {
    var box = document.getElementById("tgdet"); if (!box) return;
    if (!d.ok) { box.innerHTML = "<div class=\"hint\">ERROR — " + esc(d.error || "?") + "</div>"; return; }
    box.innerHTML = "";
    (d.chats || []).forEach(function(c) {
      var s = document.createElement("span"); s.className = "chip";
      s.textContent = String(c.id) + (c.nombre ? " (" + c.nombre + ")" : "");
      var b = document.createElement("button"); b.textContent = "autorizar"; b.title = "Añade " + c.id + " a la allowlist";
      b.onclick = (function(id) { return function() { tgdetectarUsar(String(id)); }; })(c.id);
      s.appendChild(b); box.appendChild(s);
    });
    if (!d.chats || !d.chats.length) box.textContent = d.nota || "Sin mensajes nuevos: escribe /start al bot y pulsa Detectar otra vez.";
  });
}
function tgdetectarUsar(id) {
  fetch("api/telegram/config", { method: "POST", body: JSON.stringify({ action: "allow", chat: id }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("tgnote").textContent = d.msg || d.error || "";
      tgcfg();
      var box = document.getElementById("tgdet"); if (box) box.innerHTML = "";
    });
}
---AYUDA---
function mostrarAyuda(btn) {
  var clave = btn.getAttribute("data-ayuda") || "";
  var hip = document.getElementById("agtip"); if (!hip) return;
  hip.textContent = AYUDAS[clave] || "Sin ayuda para \"" + clave + "\" todavía.";
  var r = btn.getBoundingClientRect();
  if (r) { hip.style.left = (r.right + 10) + "px"; hip.style.top = (r.bottom + 10) + "px"; }
  hip.style.display = "block";
}
---GRAFO---
function grafoSVG(titulo, subtitulo, etiqueta, gv) {
  var caja = "<div class=\"redbox\"><h3>" + esc(titulo) + "</h3><div class=\"hint\">" + esc(etiqueta) + " — " + esc(subtitulo) + "</div>";
  if (!gv || (!(gv.nodos || []).length && !(gv.aristas || []).length)) return caja + "<div class=\"hint\">Vacío: se dibuja cuando haya conexiones.</div></div>";
  var lista = (gv.nodos || []).slice();
  var cid = String(gv.centro || "");
  var ya = false; lista.forEach(function(n) { if (n.id === cid) ya = true; });
  if (cid && !ya) lista.unshift({ id: cid, tipo: "agente", nota: "centro" });
  var hijo = {}; (gv.aristas || []).forEach(function(e) { (hijo[e.de] = hijo[e.de] || []).push(e); });
  var nivel = {}; var orden = []; var visto = {};
  var cola = []; if (cid) cola.push([cid, 0]);
  lista.forEach(function(n) { if (!visto[n.id]) cola.push([n.id, 0]); });
  while (cola.length) {
    var it = cola.shift();
    if (visto[it[0]]) continue;
    visto[it[0]] = 1; nivel[it[0]] = it[1]; orden.push(it[0]);
    (hijo[it[0]] || []).forEach(function(e) { if (!visto[e.a]) cola.push([e.a, it[1] + 1]); });
  }
  var maxN = 0; orden.forEach(function(id) { if (nivel[id] > maxN) maxN = nivel[id]; });
  var NW = 150, NH = 50, GX = 28, GY = 84;
  var porNiv = {};
  orden.forEach(function(id) { (porNiv[nivel[id]] = porNiv[nivel[id]] || []).push(id); });
  var ancho = 200;
  Object.keys(porNiv).forEach(function(k) { var w = porNiv[k].length * (NW + GX) + GX; if (w > ancho) ancho = w; });
  var alto = 50 + (maxN + 1) * (NH + GY);
  var pos = {};
  Object.keys(porNiv).forEach(function(k) {
    var arr = porNiv[k]; var ini = (ancho - arr.length * (NW + GX)) / 2 + GX / 2;
    arr.forEach(function(id, i) { pos[id] = [ini + i * (NW + GX), 20 + nivel[id] * (NH + GY)]; });
  });
  var h = "<svg viewBox=\"0 0 " + ancho + " " + alto + "\" width=\"100%\" style=\"max-width:" + ancho + "px\" role=\"img\" aria-label=\"" + esc(etiqueta) + "\">";
  h += "<defs><marker id=\"garrow\" markerWidth=\"8\" markerHeight=\"8\" refX=\"7\" refY=\"4\" orient=\"auto\"><path d=\"M0,0L8,4L0,8z\" style=\"fill:var(--dim)\"/></marker></defs>";
  (gv.aristas || []).forEach(function(e) {
    var p = pos[e.de]; var q = pos[e.a]; if (!p || !q) return;
    var x1 = p[0] + NW / 2, y1 = p[1] + NH, x2 = q[0] + NW / 2, y2 = q[1];
    h += "<path d=\"M" + x1 + "," + y1 + " C" + x1 + "," + (y1 + 26) + " " + x2 + "," + (y2 - 26) + " " + x2 + "," + (y2 - 6) + "\" style=\"fill:none;stroke:var(--panel-line);stroke-width:1.5\" marker-end=\"url(#garrow)\"/>";
    if (e.nota) h += "<text x=\"" + ((x1 + x2) / 2) + "\" y=\"" + ((y1 + y2) / 2) + "\" text-anchor=\"middle\" style=\"fill:var(--dim);font-size:var(--fs-xs)\">" + esc(e.nota) + "</text>";
  });
  orden.forEach(function(id) {
    var p = pos[id]; if (!p) return;
    var nota = ""; var esEvento = false;
    lista.forEach(function(x) { if (x.id === id) { nota = x.nota || ""; if (x.tipo === "evento") esEvento = true; } });
    var esCentro = id === cid;
    h += "<rect x=\"" + p[0] + "\" y=\"" + p[1] + "\" width=\"" + NW + "\" height=\"" + NH + "\" rx=\"8\" style=\"fill:var(--panel-bg);stroke:" + (esCentro ? "var(--accent)" : "var(--panel-line)") + ";stroke-width:1.5" + (esEvento ? ";stroke-dasharray:5,4" : "") + "\"/>";
    h += "<text x=\"" + (p[0] + 10) + "\" y=\"" + (p[1] + 20) + "\" style=\"fill:var(--fg);font-size:var(--fs-md)\">" + esc(id) + (esCentro ? " (centro)" : "") + "</text>";
    if (nota) h += "<text x=\"" + (p[0] + 10) + "\" y=\"" + (p[1] + 38) + "\" style=\"fill:var(--dim);font-size:var(--fs-sm)\">" + esc(String(nota).slice(0, 40)) + "</text>";
  });
  return caja + h + "</svg></div>";
}
---MOD---
function modload() {
  fetch("api/modulos").then(function(r) { return r.json(); }).then(function(d) {
    var box = document.getElementById("modlist"); if (!box) return;
    if (!d.ok) { box.innerHTML = "<div class=\"hint\">ERROR — " + esc(d.error || "?") + "</div>"; return; }
    if (!d.modulos.length) { box.innerHTML = "<div class=\"hint\">Sin módulos: crea uno abajo.</div>"; return; }
    box.innerHTML = "";
    d.modulos.forEach(function(m) {
      var mal = m.compat && m.compat.indexOf("DESACTUALIZADO") >= 0;
      var card = document.createElement("div"); card.className = "modcard";
      card.innerHTML = "<div class=\"trl\"><strong>" + esc(m.nombre) + "</strong> v" + esc(m.version) +
        " <span class=\"pill " + (m.enabled ? "on" : "off") + "\">" + (m.enabled ? "on" : "off") + "</span>" +
        " <span class=\"hint\">" + (m.cableado ? "cableado" : "esqueleto, sin cablear") + "</span></div>" +
        "<div class=\"hint\">" + esc(m.descripcion) + "</div>" +
        "<div class=\"hint\">Config: <code>" + esc(m.configFile) + "</code> · Superficie: " + ((m.superficie || []).map(function(s) { return esc(s); }).join(", ") || "—") + "</div>" +
        "<div class=\"trl\"><span class=\"pill " + (mal ? "off" : "on") + "\">" + esc(m.compat) + "</span> · panel: " + esc(m.panel || "texto") + " · vista: " + esc(m.vista) + "</div>" +
        (mal ? "<div class=\"hint\">desactualizado: reedítalo (Reeditar hace module regen).</div>" : "");
      var fila = document.createElement("div"); fila.className = "row";
      var toggle = document.createElement("button");
      toggle.textContent = m.enabled ? "Apagar" : "Encender";
      toggle.title = (m.enabled ? "Apaga " : "Enciende ") + m.nombre + " (apagar cierra sus rutas web y su CLI; no borra config)";
      toggle.onclick = (function(n, on) { return function() { modset(n, on ? "off" : "on"); }; })(m.nombre, m.enabled);
      fila.appendChild(toggle);
      var vsel = document.createElement("select"); vsel.title = "Dónde se ve esta vista del módulo";
      ["columna", "barra", "solo"].forEach(function(v) {
        var o = document.createElement("option"); o.value = v; o.textContent = "vista: " + v;
        if (m.vista === v) o.selected = true; vsel.appendChild(o);
      });
      vsel.onchange = (function(n) { return function() { modvista(n, vsel.value); }; })(m.nombre);
      fila.appendChild(vsel);
      if (!m.cableado) {
        var re = document.createElement("button"); re.className = "mini"; re.textContent = "Reeditar";
        re.title = "Regenera el esqueleto de " + m.nombre + " sin borrar su config";
        re.onclick = (function(n) { return function() { modregen(n); }; })(m.nombre);
        fila.appendChild(re);
      }
      var ver = document.createElement("button"); ver.className = "mini"; ver.textContent = "Ver";
      ver.title = "Abrir la vista del módulo";
      ver.onclick = (function(n) { return function() { modir(n); }; })(m.nombre);
      fila.appendChild(ver);
      card.appendChild(fila);
      box.appendChild(card);
    });
  });
}
function modset(nombre, accion) {
  fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: accion, nombre: nombre }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("modnote").textContent = d.msg || d.error || "";
      modload(); modnav();
    });
}
function modvista(nombre, vista) {
  fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: "vista", nombre: nombre, vista: vista }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("modnote").textContent = d.msg || d.error || "";
      modload(); modnav();
    });
}
function modnew() {
  var nombre = document.getElementById("modnew").value.trim(); if (!nombre) return;
  fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: "new", nombre: nombre, disabled: true }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("modnote").textContent = d.msg || d.error || "";
      document.getElementById("modnew").value = "";
      modload(); modnav();
    });
}
function modcrear() {
  var nombre = document.getElementById("modnombre").value.trim();
  var tipo = document.getElementById("modtipo").value;
  var desc = document.getElementById("moddesc").value.trim();
  if (!nombre) { modcrearnota("Ponle un nombre (a-z, sin espacios)."); return; }
  fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: "new", nombre: nombre, tipo: tipo, descripcion: desc, disabled: true }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      modcrearnota(d.msg || d.error || "");
      if (!d.ok) return;
      document.getElementById("modnombre").value = ""; document.getElementById("moddesc").value = "";
      document.getElementById("modcrear").style.display = "none";
      sysline("Esqueleto " + nombre + " creado (apagado): revísalo, compila (npx tsc) y enciéndelo en Configuración → Módulos.");
      modload(); modnav();
    });
}
function modcrearnota(t) { var el = document.getElementById("modcrearnota"); if (el) el.textContent = t; }
function modcrearchat() {
  var fila = document.getElementById("modcrear");
  if (!fila) return;
  fila.style.display = fila.style.display === "none" ? "flex" : "none";
  sysline("Crear un módulo es cosa de Axiom: genera src/modules/<nombre>/ (manifiesto + index + config) sin tocar el núcleo; queda apagado hasta que lo implementes.");
  var n = document.getElementById("modnombre"); if (n) n.focus();
}
function modcard(p) {
  if (!p || !p.nombre) return;
  var log = document.getElementById("chatlog");
  var c = document.createElement("div"); c.className = "modcard";
  var h = document.createElement("div"); h.className = "trl";
  h.innerHTML = "<strong>Módulo propuesto: " + esc(p.nombre) + "</strong> · panel: " + esc(p.tipo || "texto") + (p.descripcion ? " — " + esc(p.descripcion) : "");
  c.appendChild(h);
  var nota = document.createElement("div"); nota.className = "hint";
  nota.textContent = "Se crea apagado: compila (npx tsc) y enciéndelo en Configuración → Módulos.";
  c.appendChild(nota);
  var fila = document.createElement("div"); fila.className = "row";
  var si = document.createElement("button"); si.textContent = "Crear módulo";
  si.onclick = function() {
    fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: "new", nombre: p.nombre, tipo: p.tipo, descripcion: p.descripcion, disabled: true }) })
      .then(function(r) { return r.json(); }).then(function(d) { sysline(d.msg || d.error || ""); si.disabled = true; modload(); modnav(); });
  };
  fila.appendChild(si);
  c.appendChild(fila);
  log.appendChild(c); chatscroll();
}
function modregen(nombre) {
  if (!confirm("¿Regenerar el esqueleto de " + nombre + "? Regenera manifest + archivos de ejemplo; no toca su config.")) return;
  fetch("api/modulos", { method: "POST", body: JSON.stringify({ action: "regen", nombre: nombre }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      modcrearnota(d.msg || d.error || "");
      document.getElementById("modnote").textContent = d.msg || d.error || "";
      modload();
    });
}
function allowload() {
  fetch("api/staging").then(function(r) { return r.json(); }).then(function(d) {
    var box = document.getElementById("allowchips"); if (!box) return;
    if (!d.ok) { box.innerHTML = "<div class=\"hint\">ERROR — " + esc(d.error || "?") + "</div>"; return; }
    box.innerHTML = "";
    d.allow.forEach(function(p) {
      var s = document.createElement("span"); s.className = "chip"; s.textContent = p;
      var b = document.createElement("button"); b.textContent = "quitar"; b.title = "Quita el patrón " + p;
      b.onclick = (function(q) { return function() { allowquitar(q); }; })(p);
      s.appendChild(b); box.appendChild(s);
    });
    if (!d.allow.length) box.textContent = "(sin cambios: rigen los de defecto)";
    if (d.defecto && d.defecto.length) {
      var n = document.createElement("div"); n.className = "hint";
      n.textContent = "Defecto: " + d.defecto.join(", ");
      box.appendChild(n);
    }
    if (d.fuera && d.fuera.length) {
      var f = document.createElement("div"); f.className = "hint";
      f.textContent = "Fuera (no sirven como evidencia hoy): " + d.fuera.slice(0, 24).join(", ") + (d.fuera.length > 24 ? "…" : "");
      box.appendChild(f);
    }
  });
}
function allowagregar() {
  var p = document.getElementById("allowadd").value.trim(); if (!p) return;
  fetch("api/staging", { method: "POST", body: JSON.stringify({ action: "add", patron: p }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("allownote").textContent = d.msg || d.error || "";
      document.getElementById("allowadd").value = ""; allowload();
    });
}
function allowquitar(p) {
  fetch("api/staging", { method: "POST", body: JSON.stringify({ action: "remove", patron: p }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("allownote").textContent = d.msg || d.error || "";
      allowload();
    });
}
function allowreset() {
  if (!confirm("¿Restablecer la allowlist de staging a la de defecto?")) return;
  fetch("api/staging", { method: "POST", body: JSON.stringify({ action: "reset" }) })
    .then(function(r) { return r.json(); }).then(function(d) {
      document.getElementById("allownote").textContent = d.msg || d.error || "";
      allowload();
    });
}
