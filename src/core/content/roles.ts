/** Roles de personajes. Cada rol sesga sus emociones iniciales y sus peticiones. */
export interface RoleDef {
  id: string;
  title: string;
  bias: Partial<Record<'trust' | 'fear' | 'resentment' | 'gratitude' | 'ambition' | 'curiosity', number>>;
  /** Tipo de petición que suele hacer este rol. */
  concerns: string[];
}

export const ROLES: Record<string, RoleDef> = {
  lider: { id: 'lider', title: 'líder', bias: { ambition: 0.25 }, concerns: ['alimento', 'seguridad', 'alianza'] },
  anciana: { id: 'anciana', title: 'anciana del consejo', bias: { curiosity: -0.1, fear: 0.1 }, concerns: ['memoria', 'seguridad'] },
  mercader: { id: 'mercader', title: 'mercader', bias: { ambition: 0.3, curiosity: 0.1 }, concerns: ['ruta', 'comercio'] },
  exploradora: { id: 'exploradora', title: 'exploradora', bias: { curiosity: 0.3, fear: -0.1 }, concerns: ['rumor', 'misterio'] },
  sanadora: { id: 'sanadora', title: 'sanadora', bias: { trust: 0.1, curiosity: 0.15 }, concerns: ['enfermedad', 'alimento'] },
  herrero: { id: 'herrero', title: 'maestro herrero', bias: { ambition: 0.15, fear: 0.05 }, concerns: ['seguridad', 'tecnologia'] },
  poeta: { id: 'poeta', title: 'cronista', bias: { curiosity: 0.2 }, concerns: ['memoria', 'rumor'] },
};

export const ROLE_IDS = Object.keys(ROLES);
