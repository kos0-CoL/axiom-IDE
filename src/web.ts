// B-web — UI web mínima: mismo store SQLite (UI-SPEC 5), toda acción por broker.
// Tokens solo en :root (3 capas en comentarios); validate-tokens lo verifica.
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { datosOrquestacion, datosTrabajo } from "./ui.js";
import { decide } from "./broker.js";
import { handleUpdate, deliver } from "./modules/telegram/bot.js";
import { parseUpdate, webhookSecretFromEnv, tokenFromEnv } from "./modules/telegram/transport.js";
import { loadConfig as loadTg } from "./modules/telegram/config.js";
import { allowChatId, unallowChatId, setExpiracion, setEnabled as setTgEnabled } from "./modules/telegram/adapter.js";
import { loadConfig as loadAdapters, baseUrlDe, spawn as adaptersSpawn, usarProveedor, ponerModelo, ponerUrl, ponerTimeoutMs, ponerMaxChars, listarModelos } from "./adapters.js";
import { loadAgents } from "./agents.js";
import { secretPresence, setSecrets, readSecrets, SECRET_KEYS, getSecret } from "./secrets.js";
import { asegurarProyecto, baseProyectos, crearProyecto, leerRecientes, recordar, validarRutaProyecto } from "./proyectos.js";
import { listarModulos, moduloActivo, crearModulo, regenModulo, setModulo, setVista } from "./modulos.js";

let raizActual = "";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Exportada para check-webjs (sintaxis del <script> servido) sin levantar servidor.
export const PAGE: string = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<link rel="icon" href="data:,">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AXIOM</title>
<style>
:root{--bg:#060c14;--panel-bg:#0e151e;--panel-line:#1b2634;--fg:#e8eef4;--dim:#96abc0;--good:#40c552;--bad:#e06c6c;--warn:#e0b46c;--accent:#2e7ce0;--sel:#132944;--burbuja:#0d1826;--lila:#7a5fd0;--blanco:#fff;--gap:var(--gap);--fs-xs:10px;--fs-sm:11px;--fs-md:13px;--overlay:rgba(0,0,0,.5)}
*{box-sizing:border-box}
html,body{height:100%;margin:0;padding:0}
body{background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,Ubuntu,sans-serif}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
h1{font-size:15px;margin:0}
h2{font-size:14px;margin:0 0 8px;font-weight:600}

/* Workbench Layout */
.workbench{display:flex;height:100vh}
.activity{display:flex;flex-direction:column;gap:4px;padding:10px 6px;border-right:1px solid var(--panel-line);background:var(--panel-bg);min-width:56px;max-width:56px}
.activity button{position:relative;border:1px solid transparent;background:none;color:var(--dim);padding:8px 2px;border-radius:6px;font-size:var(--fs-sm);cursor:pointer;text-align:center;transition:all .15s ease}
.activity button:hover{color:var(--fg);border-color:var(--dim)}
.activity button.on{color:var(--fg);background:var(--sel);border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.activity button.on::before{content:"";position:absolute;left:-6px;top:6px;bottom:6px;width:3px;border-radius:2px;background:var(--accent)}
.activity button.data-view{flex:1;min-width:48px;text-align:center}

.col{display:flex;flex-direction:column;flex:1;min-width:0}
.titlebar{display:flex;align-items:center;gap:10px;padding:8px 14px;min-height:48px;border-bottom:1px solid var(--panel-line);background:var(--panel-bg)}
.brand{font-weight:700;letter-spacing:2px}
.projbadge{display:flex;align-items:center;gap:6px;border:1px solid var(--panel-line);border-radius:20px;padding:2px 12px;font-size:var(--fs-md)}
.dot{width:8px;height:8px;border-radius:50%;background:var(--good)}
.sp{flex:1}
.mainrow{display:flex;flex:1;min-height:0}
.side{width:260px;flex:none;border-right:1px solid var(--panel-line);background:var(--panel-bg);padding:12px;overflow-y:auto}
.side h2{font-size:12px;color:var(--dim);margin:14px 0 4px}
.side h2:first-child{margin-top:0}
main.content{flex:1;min-width:0;padding:14px;overflow-y:auto}
.statusbar{display:flex;align-items:center;gap:var(--gap);padding:6px 14px;border-top:1px solid var(--panel-line);background:var(--panel-bg);font-size:12px;color:var(--dim)}

/* Cards and Buttons */
section{background:var(--panel-bg);border:1px solid var(--panel-line);border-radius:8px;padding:12px}
button{border:1px solid var(--panel-line);background:var(--bg);color:var(--fg);font:inherit;padding:4px 10px;border-radius:6px;cursor:pointer}
button:hover{border-color:var(--dim)}
button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:1px solid var(--accent);outline-offset:2px}
table{border-collapse:collapse;margin-top:8px;width:100%}
th,td{border:1px solid var(--panel-line);padding:4px 8px;text-align:left;font-size:var(--fs-md)}
th{color:var(--dim);font-weight:600}
.good{color:var(--good)}
.bad{color:var(--bad)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--gap)}
@media (max-width:1100px){.grid{grid-template-columns:1fr}}
body.noside .side{display:none}
button.on{border-color:var(--fg);color:var(--good)}

/* Chat Styles - Integrated in flow */
.chat-container{width:100%;max-width:860px}
.chat-header{display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:var(--panel-bg);border:1px solid var(--panel-line);border-radius:8px}
.tabs{display:flex;gap:8px;margin-bottom:8px}
.tab{border:1px solid var(--panel-line);border-bottom:none;border-radius:8px 8px 0 0;padding:6px 12px;background:var(--panel-bg);font-size:var(--fs-md);cursor:pointer}
.tab.active{border-bottom:2px solid var(--accent);background:var(--bg)}

.messages{flex:1;min-height:300px;max-height:400px;overflow-y:auto;background:var(--panel-bg);border:1px solid var(--panel-line);border-radius:8px;padding:12px;margin-bottom:8px}
.message{margin-bottom:12px}
.message.user{text-align:right}
.message.assistant{text-align:left}
message .content{background:var(--sel);border:1px solid var(--accent);border-radius:12px;padding:8px 12px;max-width:80%;margin:0 auto}
.message.user .content{background:var(--accent);border-color:var(--accent)}
.message.assistant .content{background:var(--bg);border-color:var(--panel-line)}

.input-area{display:flex;gap:8px;align-items:flex-end}
.input-area textarea{flex:1;min-height:40px;max-height:150px;background:var(--bg);color:var(--fg);border:1px solid var(--panel-line);border-radius:8px;padding:8px;font:inherit;resize:vertical}
.input-area button{background:var(--accent);color:var(--bg);border:none;border-radius:8px;padding:8px 16px;cursor:pointer}
.input-area button:disabled{opacity:0.5;cursor:not-allowed}

.console{margin-top:var(--gap);color:var(--dim);font-size:var(--fs-md)}
.view{display:none}
.view.on{display:block}
.lab .row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lab input,.lab select{background:var(--bg);color:var(--fg);border:1px solid var(--panel-line);font:inherit;padding:4px 8px;border-radius:6px}
.lab input{width:150px}
.hint{margin-top:8px;color:var(--dim);font-size:var(--fs-md)}
.lablog{margin-top:8px;border-top:1px solid var(--panel-line);padding-top:8px;min-height:24px;overflow-wrap:anywhere;font-size:var(--fs-md)}

/* Modal Cards - ASK, PLAN, BUILD */
.mode-cards{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.mode-card{border:1px solid var(--accent);border-radius:12px;padding:16px;cursor:pointer;transition:transform .1s ease,box-shadow .1s ease}
.mode-card:hover{transform:scale(1.02);box-shadow:0 4px 12px rgba(46,124,224,0.3)}
.mode-card.active{border-color:var(--good);box-shadow:0 0 0 2px var(--good)}
.mode-card h3{margin:0 0 8px;color:var(--accent);font-size:16px;font-weight:600}
.mode-card p{margin:0;color:var(--dim);font-size:12px}
.mode-card b{display:block;font-size:24px;margin-top:8px;color:var(--fg)}
.mode-card .desc{font-size:11px;color:var(--dim);margin-top:4px}

/* Orq & Trabajo views */
.orq-content,.tra-content{padding:16px}
.agents-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:12px}
.agent-card{border:1px solid var(--panel-line);border-radius:8px;padding:12px;text-align:center}
.agent-status{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:8px}
.agent-status.active{background:var(--good)}
.agent-status.paused{background:var(--bad)}
.agent-status.pending{background:var(--warn)}
</style>
</head>
<body>
<div class="workbench">
<nav class="activity" aria-label="Vistas">
<button data-view="chat" class="on" onclick="nav('chat')" title="Chat">Chat</button>
<button data-view="orq" onclick="nav('orq')" title="Orquestación">Orq</button>
<button data-view="tra" onclick="nav('tra')" title="Trabajo">Trab</button>
<button data-view="apr" onclick="nav('apr')" title="Aprobaciones">Aprob</button>
<button data-view="cfg" onclick="nav('cfg')" title="Configuración">Ajust</button>
<div id="modcol"></div>
</nav>
<div class="col">
<header class="titlebar"><span class="brand">AXIOM</span><button class="mini" onclick="sidetoggle()" title="Mostrar/ocultar sidebar">☰</button><span class="sp"></span><span class="projbadge"><span class="dot"></span><span id="projname">Proyecto activo</span></span><span class="sp"></span><button id="tgtoggle" class="pill off" onclick="tgtoggle()" title="Telegram">Tg: off</button></header>
<div class="mainrow">
<aside class="side" aria-label="Proyectos y chats">
<div class="sidehead"><h2>Proyectos</h2><button class="mini" onclick="proynuevo()" title="Nuevo proyecto">+</button></div>
<div class="hint" id="projroot" style="display:none">Servidor local</div>
<input id="proybuscar" autocomplete="off" placeholder="Buscar..." oninput="seslist()">
<div id="seslist" class="seslist"><div class="hint">Sin sesiones</div></div>
</aside>
<main class="content">
<!-- VISTA CHAT -->
<div class="view on" id="v-chat">
<section class="chat-container" aria-label="Chat">
<div class="tabs" id="chat-tabs">
<button class="tab active" onclick="setmodo('ask')">ASK</button>
<button class="tab" onclick="setmodo('plan')">PLAN</button>
<button class="tab" onclick="setmodo('build')">BUILD</button>
</div>
<div class="messages" id="messages">
<div class="message assistant"><div class="content">Selecciona un modo o escribe tu pregunta...</div></div>
</div>
<div class="input-area">
<textarea id="chatin" placeholder="Escribe tu pregunta..." oninput="updateSendButtonState()"></textarea>
<button id="sendButton" disabled onclick="chatsend()">Enviar</button>
</div>
</section>
</div>
<!-- VISTA ORQUESTACIÓN -->
<div class="view" id="v-orq"><section aria-label="Orquestación"><h2>Orquestación</h2><div id="orq-agentes" class="agents-grid">Cargando...</div></section></div>
<!-- VISTA TRABAJO -->
<div class="view" id="v-tra"><section aria-label="Trabajo"><h2>Trabajo</h2><div id="tra">Cargando...</div></section></div>
<!-- VISTA APROBACIONES -->
<div class="view" id="v-apr"><section aria-label="Aprobaciones"><h2>Aprobaciones</h2><div id="apr">Cargando...</div></section></div>
<!-- VISTA CONFIGURACIÓN -->
<div class="view" id="v-cfg"><section class="lab" aria-label="Configuración"><h2>Configuración</h2><div id="cfg">Cargando...</div></section></div>
</main>
</div>
</div>
<div id="agtip" class="agtip"></div>
</body>
</html>`;

export const PAGE_HTML: string = PAGE;

// Funciones JavaScript
const JSFuncs = `
var currentModo = 'ask';
var currentVista = 'chat';
function nav(v){
  var views = document.querySelectorAll('.view');
  for(var i=0;i<views.length;i++)views[i].className='view';
  document.getElementById('v-'+v).className='view on';
  // Update activity bar buttons
  var actBtns = document.querySelectorAll('.activity button');
  for(var k=0;k<actBtns.length;k++)actBtns[k].classList.remove('on');
  var targetBtn = document.querySelector('.activity button[data-view=\"'+v+'\"]');
  if(targetBtn)targetBtn.classList.add('on');
  // Update tabs
  var btns = document.querySelectorAll('.tab');
  for(var j=0;j<btns.length;j++)btns[j].classList.remove('active');
  if(['ask','plan','build'].includes(v))document.querySelector('.tab[onclick*\\''+v+'\\']')?.classList.add('active');
  currentVista = v;
}
function setmodo(m){
  currentModo = m;
  var btns = document.querySelectorAll('.tab');
  for(var j=0;j<btns.length;j++)btns[j].classList.remove('active');
  document.querySelector('.tab[onclick*\\''+m+'\\']')?.classList.add('active');
}
function chatsend(){
  var ta = document.getElementById('chatin');
  var contentDiv = document.getElementById('messages');
  if(!ta||!ta.value.trim())return;
  var userMsg = document.createElement('div');
  userMsg.className='message user';
  userMsg.innerHTML='<div class="content">'+escapeHtml(ta.value)+'</div>';
  contentDiv.appendChild(userMsg);
  ta.value='';
  ta.disabled=true;
  contentDiv.scrollTop = contentDiv.scrollHeight;
  // Simular respuesta (en producción llamaría al backend)
  setTimeout(function(){
    var assistantMsg = document.createElement('div');
    assistantMsg.className='message assistant';
    assistantMsg.innerHTML='<div class="content">Respuesta en modo: '+currentModo.toUpperCase()+'</div>';
    contentDiv.appendChild(assistantMsg);
    contentDiv.scrollTop = contentDiv.scrollHeight;
    ta.disabled=false;
  },500);
}
function updateSendButtonState(){
  var ta=document.getElementById('chatin');
  var sb=document.getElementById('sendButton');
  if(!ta||!sb)return;
  if(ta.value.trim()){sb.disabled=false;sb.className='input-area button'}
  else{sb.disabled=true;sb.className='input-area button disabled'}
}
function escapeHtml(text){
  var div=document.createElement('div');
  div.textContent=text;
  return div.innerHTML;
}
function sidetoggle(){
  var side=document.querySelector('.side');
  if(side){
    if(side.style.display==='none'){side.style.display='block'}
    else{side.style.display='none'}
  }
}
function tgtoggle(){
  fetch('api/telegram/config',{method:'POST',body:JSON.stringify({action:'toggle'})})
  .then(r=>r.json()).then(d=>console.log('Telegram:',d.msg||d.error)).catch(e=>console.error('Error:',e));
}
`;

// Servidor web
export function startWeb(root: string = "", port: number = 8787): { port: number; close: () => void } {
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url || "/";
    const pathname = new URL(url, `http://localhost:${port}`).pathname;
    
    if (pathname === "/" || pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(PAGE + "<script>" + JSFuncs + "</script>");
      return;
    }
    
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
  
  http.listen(port, () => {
    console.log(`Servidor escuchando en http://localhost:${port}`);
  });
  
  return { 
    port, 
    close: () => http.close() 
  };
}

// Compatibilidad con código existente
export const server = startWeb;

export function validateTokens(html: string): { ok: boolean; errores: string[] } {
  const errores: string[] = [];
  if (!html.includes("AXIOM")) errores.push("falta AXIOM");
  if (!html.includes("composer")) errores.push("falta composer");
  return { ok: errores.length === 0, errores };
}

export function defaultWebSource(): string {
  return PAGE;
}