// Fachada del módulo skills (costura única con el núcleo).
// El núcleo no conoce el módulo: solo esta superficie pequeña y estable.
export {
  listarSkills,
  leerSkill,
  guardarSkill,
  borrarSkill,
  cuerpoEfectivo,
  descripcionEfectiva,
  ignoradosSkills,
  datosSkills,
  textoSkills,
  SKILL_ID_OK,
  MAX_DESCRIPCION,
  MAX_CUERPO,
} from "./modules/skills/index.js";
export type { SkillInfo, SkillLeido } from "./modules/skills/index.js";
// El runner de scripts (`axiom skills run`) vive en el módulo; el núcleo lo ve
// por esta fachada, no entrando al módulo desde commands.ts.
export { ejecutarScriptSkill } from "./modules/skills/runner.js";
export type { OpcionesScript, ResultadoScript } from "./modules/skills/runner.js";
