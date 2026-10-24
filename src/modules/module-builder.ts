import ts from "typescript";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { Worker } from "node:worker_threads";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { openDb } from "../store.js";

export interface ReferenciaModulo {
  title: string;
  url: string;
  snippet: string;
}

export interface PropuestaModulo {
  nombre: string;
  tipo: "grafo" | "lista" | "texto";
  descripcion: string;
  resumen: string;
  indexTs: string;
  configTs: string;
}

export interface PropuestaPersistida extends PropuestaModulo {
  id: string;
  referencias: ReferenciaModulo[];
  estado: "pendiente" | "instalada";
  createdAt: string;
}

const NOMBRE_OK = /^[a-z][a-z0-9-]{0,31}$/;
const BLOQUEADOS = new Set([
  "process", "global", "globalThis", "require", "fetch", "XMLHttpRequest", "WebSocket", "Worker",
  "importScripts", "eval", "Function", "Deno", "Bun", "Buffer", "setTimeout", "setInterval",
  "queueMicrotask", "constructor", "__proto__", "prototype", "Reflect", "Proxy", "console", "unescape", "globalThis",
  "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__", "caller", "callee",
]);
const METODOS_PUROS = new Set([
  "map", "filter", "reduce", "find", "findIndex", "some", "every", "join", "slice", "concat",
  "flat", "flatMap", "includes", "indexOf", "startsWith", "endsWith", "toLowerCase", "toUpperCase",
  "trim", "trimStart", "trimEnd", "replace", "split", "padStart", "padEnd", "localeCompare",
  "toString", "toFixed", "isArray", "stringify", "parse", "abs", "min", "max", "round", "floor", "ceil", "at",
  "object", "string", "number", "boolean", "enum", "array", "record",  "optional", "default", "int", "email", "url", "literal", "union", "nullable", "regex",
]);
const GLOBALES_PUROS = new Set(["JSON", "Math", "Array", "String", "Number", "Boolean", "undefined", "z"]);
const TIPOS_PERMITIDOS = new Set(["string", "number", "boolean", "unknown", "void", "undefined", "null"]);
const WORKER_VALIDACION = `import { parentPort, workerData } from "node:worker_threads";
(async () => {
  let unlink;
  try {
    const { pathToFileURL } = await import("node:url");
    const fs = await import("node:fs/promises");
    unlink = fs.unlink;
    const temp = pathToFileURL(workerData.path);
    await fs.writeFile(temp, Buffer.from(workerData.source, "base64").toString("utf8"), { flag: "wx", mode: 0o600 });
    const mod = await import(temp.href);
    await unlink(workerData.path);
    if (typeof mod.datosModulo !== "function" || typeof mod.estadoTexto !== "function") throw new Error("Contrato de módulo incompleto.");
    const estado = mod.estadoTexto();
    const datos = mod.datosModulo("/validacion-sin-archivos");
    if (typeof estado !== "string" || !estado.trim()) throw new Error("estadoTexto() debe devolver texto no vacío.");
    const serializado = JSON.stringify(datos);
    if (serializado === undefined || serializado.length > 100000) throw new Error("datosModulo() no devolvió JSON acotado.");
    parentPort.postMessage({ ok: true, datos: JSON.parse(serializado) });
  } catch (error) { parentPort.postMessage({ ok: false, error: String(error && error.message || error).slice(0, 300) }); }
  finally { if (unlink) try { await unlink(workerData.path); } catch {} }
})();`;

function objetoJSON(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parsearPropuestaModulo(texto: string): { ok: true; propuesta: PropuestaModulo } | { ok: false; error: string } {
  let value: unknown;
  try {
    const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    value = JSON.parse(limpio);
  } catch {
    return { ok: false, error: "El proveedor no devolvió JSON válido para el módulo." };
  }
  if (!objetoJSON(value)) return { ok: false, error: "La propuesta debe ser un objeto JSON." };
  const { nombre, tipo, descripcion, resumen, indexTs, configTs } = value;
  if (typeof nombre !== "string" || !NOMBRE_OK.test(nombre)) return { ok: false, error: "nombre inválido: usa minúsculas, números y guiones (1-32), empezando por letra." };
  if (tipo !== "grafo" && tipo !== "lista" && tipo !== "texto") return { ok: false, error: "tipo inválido: usa grafo, lista o texto." };
  if (typeof descripcion !== "string" || !descripcion.trim() || descripcion.length > 200) return { ok: false, error: "descripcion requerida (máximo 200 caracteres)." };
  if (typeof resumen !== "string" || !resumen.trim() || resumen.length > 2000) return { ok: false, error: "resumen requerido (máximo 2000 caracteres)." };
  if (typeof indexTs !== "string" || !indexTs.trim() || indexTs.length > 30000) return { ok: false, error: "indexTs requerido (máximo 30000 caracteres)." };
  if (typeof configTs !== "string" || !configTs.trim() || configTs.length > 10000) return { ok: false, error: "configTs requerido (máximo 10000 caracteres)." };
  return { ok: true, propuesta: { nombre, tipo, descripcion: descripcion.trim(), resumen: resumen.trim(), indexTs, configTs } };
}

function validarAST(file: string, source: string, importsPermitidos: string[]): string[] {
  const errors: string[] = [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const funciones = new Set(sf.statements.filter(ts.isFunctionDeclaration).map((n) => n.name?.text ?? ""));
  const locales = new Set<string>(funciones);
  const recogerBinding = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) locales.add(name.text);
    else for (const element of name.elements) if (ts.isBindingElement(element)) recogerBinding(element.name);
  };
  const recogerLocales = (node: ts.Node): void => {
    if (ts.isParameter(node) || ts.isVariableDeclaration(node)) recogerBinding(node.name);
    ts.forEachChild(node, recogerLocales);
  };
  recogerLocales(sf);
  const host = ts.createCompilerHost({ noResolve: true });
  host.getSourceFile = (_file, languageVersion) => sf;
  host.fileExists = () => true;
  host.readFile = () => source;
  const syntacticDiagnostics = ts.createProgram([file], { noResolve: true }, host).getSyntacticDiagnostics(sf);
  for (const diagnostic of syntacticDiagnostics) errors.push(`sintaxis ${file}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const from = ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : "";
      if (!importsPermitidos.includes(from)) errors.push(`${file}: import no permitido (${from || "dinámico"}).`);
      const clause = node.importClause;
      if (file === "config.ts" && from === "zod" && (!clause || clause.name !== undefined || !clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.length !== 1 || clause.namedBindings.elements[0].name.text !== "z" || clause.namedBindings.elements[0].propertyName !== undefined)) errors.push("config.ts: usa únicamente import { z } from zod.");
    }
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (target.kind === ts.SyntaxKind.ImportKeyword) errors.push(`${file}: import dinámico no permitido.`);
      else if (ts.isIdentifier(target) && !funciones.has(target.text) && !["String", "Number", "Boolean"].includes(target.text)) errors.push(`${file}: llamada no permitida (${target.text}).`);
      else if (ts.isPropertyAccessExpression(target) && !METODOS_PUROS.has(target.name.text)) errors.push(`${file}: llamada no permitida (${target.name.text}).`);
      else if (!ts.isIdentifier(target) && !ts.isPropertyAccessExpression(target)) errors.push(`${file}: forma de llamada no permitida.`);
    }
    if (ts.isIdentifier(node)) {
      if (node.text === "unescape") errors.push(`${file}: identificador no permitido (unescape).`);
      if (BLOQUEADOS.has(node.text)) errors.push(`${file}: identificador no permitido (${node.text}).`);
      const padre = node.parent;
      const esNombre = (ts.isPropertyAccessExpression(padre) && padre.name === node) ||
        (ts.isPropertyAssignment(padre) && padre.name === node) ||
        (ts.isMethodDeclaration(padre) && padre.name === node) ||
        (ts.isPropertySignature(padre) && padre.name === node) ||
        (ts.isMethodSignature(padre) && padre.name === node) ||
        (ts.isTypeReferenceNode(padre) && padre.typeName === node) ||
        (ts.isVariableDeclaration(padre) && padre.name === node) ||
        (ts.isParameter(padre) && padre.name === node) ||
        (ts.isFunctionDeclaration(padre) && padre.name === node) ||
        (ts.isInterfaceDeclaration(padre) && padre.name === node) ||
        (ts.isTypeAliasDeclaration(padre) && padre.name === node) ||
        (ts.isImportSpecifier(padre) || (ts.isImportClause(padre) && padre.name === node));
      const esTipo = TIPOS_PERMITIDOS.has(node.text) || node.text === "Record" && file === "index.ts" || node.text === "z" && file === "config.ts";
      if (!esNombre && !esTipo && !locales.has(node.text) && !GLOBALES_PUROS.has(node.text)) errors.push(`${file}: identificador fuera del entorno permitido (${node.text}).`);
    }
    if (ts.isPropertyAccessExpression(node) && BLOQUEADOS.has(node.name.text)) errors.push(`${file}: acceso no permitido (${node.name.text}).`);
    if (ts.isElementAccessExpression(node)) {
      if (!node.argumentExpression || (!ts.isStringLiteral(node.argumentExpression) && !ts.isNumericLiteral(node.argumentExpression))) errors.push(`${file}: acceso dinámico a propiedades no permitido.`);
      if (node.argumentExpression && ts.isStringLiteral(node.argumentExpression) && (BLOQUEADOS.has(node.argumentExpression.text) || !/^[a-zA-Z_$][\\w$]*$/.test(node.argumentExpression.text))) errors.push(`${file}: acceso no permitido (${node.argumentExpression.text}).`);
    }
    if (ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isClassDeclaration(node) || ts.isNewExpression(node) || ts.isAwaitExpression(node) || ts.isYieldExpression(node) || ts.isTryStatement(node) || ts.isThrowStatement(node) || ts.isDeleteExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node)) errors.push(`${file}: construcción no permitida (${ts.SyntaxKind[node.kind]}).`);
    if (node.kind === ts.SyntaxKind.AnyKeyword) errors.push(`${file}: el tipo any no está permitido.`);
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && !TIPOS_PERMITIDOS.has(node.typeName.text) && !(file === "index.ts" && node.typeName.text === "Record")) errors.push(`${file}: tipo no permitido (${node.typeName.text}).`);
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) && BLOQUEADOS.has(node.name.text)) errors.push(`${file}: propiedad no permitida (${node.name.text}).`);
    ts.forEachChild(node, visit);
  };
  visit(sf);

  if (file === "index.ts") {
    const exports = new Set<string>();
    for (const statement of sf.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        const name = statement.name.text;
        exports.add(name);
        if (!statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) errors.push(`index.ts: ${name} debe exportarse.`);
        if ((name === "estadoTexto" && statement.parameters.length !== 0) || (name === "datosModulo" && statement.parameters.length !== 1)) errors.push(`index.ts: firma inválida para ${name}.`);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = ts.isIdentifier(declaration.name) ? declaration.name.text : "";
          if (name !== "NOMBRE" || !declaration.initializer || !ts.isStringLiteral(declaration.initializer) || declaration.initializer.text.length === 0) errors.push("index.ts: solo se permite la constante NOMBRE con texto literal en nivel superior.");
          else exports.add(name);
        }
      } else if (!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) errors.push(`index.ts: declaración de nivel superior no permitida (${ts.SyntaxKind[statement.kind]}).`);
    }
    for (const required of ["NOMBRE", "estadoTexto", "datosModulo"]) if (!exports.has(required)) errors.push(`index.ts: falta exportar ${required}.`);
    if (exports.size !== 3) errors.push("index.ts: exporta únicamente NOMBRE, estadoTexto y datosModulo.");
  } else {
    for (const statement of sf.statements) {
      if (ts.isImportDeclaration(statement)) continue;
      if (!ts.isVariableStatement(statement) || statement.declarationList.declarations.length !== 1) {
        errors.push("config.ts: solo se permite importar zod y exportar Config.");
        continue;
      }
      const decl = statement.declarationList.declarations[0];
      const isConfig = decl && ts.isIdentifier(decl.name) && decl.name.text === "Config" && decl.initializer && ts.isCallExpression(decl.initializer) && ts.isPropertyAccessExpression(decl.initializer.expression) && decl.initializer.expression.expression.getText(sf) === "z" && decl.initializer.expression.name.text === "object";
      if (!isConfig || !statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) errors.push("config.ts: exporta Config = z.object({...}).");
    }
    const configExports = new Set(sf.statements.flatMap((statement) => ts.isVariableStatement(statement) && statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ? statement.declarationList.declarations.filter((d) => ts.isIdentifier(d.name)).map((d) => (d.name as ts.Identifier).text) : []));
    if (!configExports.has("Config") || configExports.size !== 1) errors.push("config.ts: exporta únicamente Config.");
  }
  return errors;
}

function probarContrato(source: string): Promise<{ ok: boolean; error?: string; datos?: unknown }> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_VALIDACION, { eval: true, workerData: { source: Buffer.from(source).toString("base64"), path: join(tmpdir(), `axiom-module-validation-${randomUUID()}.mjs`) }, resourceLimits: { maxOldGenerationSizeMb: 32, stackSizeMb: 2 } });
    let terminado = false;
    const timer = setTimeout(() => { terminado = true; void worker.terminate(); resolve({ ok: false, error: "La prueba de contrato superó 500 ms." }); }, 500);
    worker.once("message", (result: { ok: boolean; error?: string; datos?: unknown }) => { if (terminado) return; terminado = true; clearTimeout(timer); void worker.terminate(); resolve(result); });
    worker.once("error", (error) => { if (terminado) return; terminado = true; clearTimeout(timer); void worker.terminate(); resolve({ ok: false, error: error.message.slice(0, 300) }); });
  });
}

export async function validarPropuestaModulo(propuesta: PropuestaModulo): Promise<{ ok: boolean; errores: string[] }> {
  if (!propuesta || typeof propuesta !== "object" || typeof propuesta.nombre !== "string" || !NOMBRE_OK.test(propuesta.nombre) || (propuesta.tipo !== "grafo" && propuesta.tipo !== "lista" && propuesta.tipo !== "texto") || typeof propuesta.descripcion !== "string" || propuesta.descripcion.length > 200 || typeof propuesta.resumen !== "string" || propuesta.resumen.length > 2000 || typeof propuesta.indexTs !== "string" || !propuesta.indexTs.trim() || propuesta.indexTs.length > 30000 || typeof propuesta.configTs !== "string" || !propuesta.configTs.trim() || propuesta.configTs.length > 10000) return { ok: false, errores: ["propuesta inválida"] };
  const errores = [
    ...validarAST("index.ts", propuesta.indexTs, []),
    ...validarAST("config.ts", propuesta.configTs, ["zod"]),
  ];
  if (errores.length) return { ok: false, errores: [...new Set(errores)].slice(0, 30) };

  const projectRoot = process.cwd();
  const moduleDir = resolve(projectRoot, "src/modules", propuesta.nombre);
  const files = new Map([
    [resolve(moduleDir, "index.ts"), propuesta.indexTs],
    [resolve(moduleDir, "config.ts"), propuesta.configTs],
  ]);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  const host = ts.createCompilerHost(options);
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  const originalGetSourceFile = host.getSourceFile.bind(host);
  host.fileExists = (file) => files.has(file.replace(/\\/g, "/")) || originalFileExists(file);
  host.readFile = (file) => files.get(file.replace(/\\/g, "/")) ?? originalReadFile(file);
  host.getSourceFile = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
    const content = files.get(file.replace(/\\/g, "/"));
    return content === undefined ? originalGetSourceFile(file, languageVersion, onError, shouldCreateNewSourceFile) : ts.createSourceFile(file, content, languageVersion, true);
  };
  const program = ts.createProgram([...files.keys()], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program).filter((d) => {
    if (!d.file || !d.file.fileName.includes("node_modules")) return true;
    const rp = relative(process.cwd(), d.file.fileName);
    return isAbsolute(rp) || rp.split(sep)[0] !== "node_modules";
  });
  if (diagnostics.length) {
    errores.push(...diagnostics.slice(0, 20).map((d) => {
      const lugar = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      const prefijo = d.file ? `${d.file.fileName.split("/").pop()}${lugar ? `:${lugar.line + 1}` : ""}: ` : "";
      return prefijo + ts.flattenDiagnosticMessageText(d.messageText, " ");
    }));
  }
  if (errores.length) return { ok: false, errores: [...new Set(errores)].slice(0, 30) };
  const javascript = ts.transpileModule(propuesta.indexTs, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
  const contrato = await probarContrato(javascript.outputText);
  if (!contrato.ok) errores.push(`prueba del módulo: ${contrato.error ?? "falló el contrato"}`);
  if (contrato.ok && (!objetoJSON(contrato.datos) || Object.keys(contrato.datos).length === 0)) errores.push("prueba del módulo: datosModulo() debe devolver un objeto JSON comprobable con al menos una propiedad.");
  return { ok: errores.length === 0, errores: [...new Set(errores)].slice(0, 30) };
}

export function inicializarTablaPropuestas(root: string): void {
  mkdirSync(root, { recursive: true });
  const db = openDb(root);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS module_proposals(id TEXT PRIMARY KEY, nombre TEXT NOT NULL, payload TEXT NOT NULL, estado TEXT NOT NULL, created_at TEXT NOT NULL, checksum TEXT NOT NULL DEFAULT '')");
    const columnas = db.prepare("PRAGMA table_info(module_proposals)").all() as { name?: unknown }[];
    if (!columnas.some((c) => c.name === "checksum")) db.exec("ALTER TABLE module_proposals ADD COLUMN checksum TEXT NOT NULL DEFAULT ''");
  } finally {
    db.close();
  }
}

export function guardarPropuestaModulo(root: string, propuesta: PropuestaModulo, referencias: ReferenciaModulo[]): PropuestaPersistida {
  inicializarTablaPropuestas(root);
  const persistida: PropuestaPersistida = { ...propuesta, id: randomUUID(), referencias, estado: "pendiente", createdAt: new Date().toISOString() };
  const payload = JSON.stringify({ ...propuesta, referencias });
  const checksum = createHash("sha256").update(payload).digest("hex");
  const db = openDb(root);
  try {
    db.prepare("INSERT INTO module_proposals(id,nombre,payload,estado,created_at,checksum) VALUES(?,?,?,?,?,?)").run(persistida.id, persistida.nombre, payload, persistida.estado, persistida.createdAt, checksum);
  } finally {
    db.close();
  }
  return persistida;
}

export function obtenerPropuestaModulo(root: string, id: string): PropuestaPersistida | undefined {
  inicializarTablaPropuestas(root);
  const db = openDb(root);
  let row: { id: string; nombre: string; payload: string; estado: string; created_at: string; checksum: string } | undefined;
  try {
    row = db.prepare("SELECT id,nombre,payload,estado,created_at,checksum FROM module_proposals WHERE id=?").get(id) as typeof row;
  } finally {
    db.close();
  }
  if (!row) return undefined;
  try {
    if (!/^[a-f0-9]{64}$/.test(row.checksum) || createHash("sha256").update(row.payload).digest("hex") !== row.checksum) return undefined;
    const payload = JSON.parse(row.payload) as PropuestaModulo & { referencias: ReferenciaModulo[] };
    return { ...payload, id: row.id, estado: row.estado === "instalada" ? "instalada" : "pendiente", createdAt: row.created_at };
  } catch {
    return undefined;
  }
}

export function marcarPropuestaModuloInstalada(root: string, id: string): void {
  inicializarTablaPropuestas(root);
  const db = openDb(root);
  try {
    db.prepare("UPDATE module_proposals SET estado='instalada' WHERE id=? AND estado='pendiente'").run(id);
  } finally {
    db.close();
  }
}

export function propuestaModuloPendiente(root: string, nombre: string): boolean {
  inicializarTablaPropuestas(root);
  const db = openDb(root);
  let row: { existe: number } | undefined;
  try {
    row = db.prepare("SELECT 1 AS existe FROM module_proposals WHERE nombre=? AND estado='pendiente' LIMIT 1").get(nombre) as typeof row;
  } finally {
    db.close();
  }
  return Boolean(row);
}
