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
