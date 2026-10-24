# fix-orq — dos averias de la vista Orq:
#  1) #orq-techo y #orq-tareas nunca se rellenaban (quedaban en Cargando...).
#  2) el BFS de agred() aplastaba todos los nodos en nivel 0 porque la arista
#     "comunica" de nodo-review -> orquestador le daba padre al orquestador y
#     el arranque quedaba vacio; ahora se parte del orquestador y las aristas
#     que vuelven hacia atras no marcan nivel.
p = 'src/web.ts'
s = open(p).read()

OLD_A = r'''    if (tl && d.aprobaciones) tl.innerHTML = timeline(d);','''
NEW_A = r'''    if (tl && d.aprobaciones) tl.innerHTML = timeline(d);',
'    var te = document.getElementById(\"orq-techo\");',
'    if (te && d.techo) te.innerHTML = \"Rondas: <strong>\" + esc(d.techo.rondas) + \"</strong> · Tokens: <strong>\" + esc(d.techo.tokens) + \"</strong> · Llamadas: <strong>\" + esc(d.techo.calls) + \"</strong> <span class=\\\"hint\\\">reserva de verificacion: 20%</span>\";',
'    var ta = document.getElementById(\"orq-tareas\");',
'    if (ta) {',
'      var taq = \"\";',
'      if (d.tareas && d.tareas.length) d.tareas.forEach(function(s) { taq += \"<div class=\\\"trl\\\"><button class=\\\"mini\\\" onclick=\\\"nav(&apos;tra&apos;)\\\" title=\\\"Ir a Trabajo\\\">\" + esc(s.estado) + \": \" + esc(s.n) + \"</button></div>\"; });',
'      else taq = \"<div class=\\\"hint\\\">Sin tareas todavia: el orquestador las crea cuando ejecutas tu pedido en modo Build.</div>\";',
'      ta.innerHTML = taq;',
'    }','''

OLD_B = r'''  var nivel = {}; var orden = []; var visto = {};',
'  var cola = d.agentes.filter(function(a) { return !conPadre[a.id]; }).map(function(a) { return [a, 0]; });',
'  while (cola.length) {',
'    var it = cola.shift(); var a = it[0]; var n = it[1];',
'    if (visto[a.id]) continue;',
'    visto[a.id] = 1; nivel[a.id] = n; orden.push(a.id);',
'    (hijos[a.id] || []).forEach(function(e) { cola.push([porId[e.a], n + 1]); });',
'  }',
'  d.agentes.forEach(function(a) { if (!visto[a.id]) { nivel[a.id] = 0; orden.push(a.id); } });', '''

NEW_B = r'''  // Niveles: se parte del orquestador (o de alguien sin arista entrante) y se baja',
'  // por las aristas salientes. Las aristas que vuelven hacia atras (comunica,',
'  // ciclo) no marcan nivel: asi el grafo no se aplana en una sola fila.',
'  var nivel = {}; var orden = [];',
'  var os0 = d.agentes.filter(function(a) { return a.rol === \"orquestador\"; });',
'  var raiz = os0[0] || d.agentes.filter(function(a) { return !conPadre[a.id]; })[0] || d.agentes[0];',
'  nivel[raiz.id] = 0; orden.push(raiz.id);',
'  var cola = [raiz.id];',
'  while (cola.length) {',
'    var id = cola.shift();',
'    (hijos[id] || []).forEach(function(e) {',
'      if (nivel[e.a] !== undefined || !porId[e.a]) return;',
'      nivel[e.a] = nivel[id] + 1; orden.push(e.a); cola.push(e.a);',
'    });',
'  }',
'  // Sueltos (no alcanzables): fila propia al final.',
'  var filas = 0;',
'  d.agentes.forEach(function(a) {',
'    if (nivel[a.id] !== undefined) return;',
'    var maxAt = 0;',
'    orden.forEach(function(x) { if (nivel[x] > maxAt) maxAt = nivel[x]; });',
'    nivel[a.id] = maxAt + 1 + filas; filas++; orden.push(a.id);',
'  });', '''

for name, old, new in [("A(techo/tareas)", OLD_A, NEW_A), ("B(agred niveles)", OLD_B, NEW_B)]:
    n = s.count(old)
    assert n == 1, f"{name}: se encontraron {n} coincidencias (se espera 1)"
    s = s.replace(old, new)
    print(f"OK {name}")

open(p, 'w').write(s)
print("fix-orq aplicado")
