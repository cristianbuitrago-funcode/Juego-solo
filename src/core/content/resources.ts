/**
 * Recursos de las regiones. No se "recolectan": determinan qué produce una
 * región, cuánto depende del comercio y qué tan frágil es su ecosistema.
 */
export interface ResourceDef {
  id: string;
  name: string;
  food: number; // alimento diario producido por cada 100 habitantes (1 = autosuficiente)
  fragility: number; // cuánto daña la presión de extracción al ecosistema
  tradeValue: number; // atractivo comercial
  glyph: 'olas' | 'campo' | 'monte' | 'bosque' | 'cristal' | 'pasto';
  depleted: string; // pista cuando el ecosistema se degrada
}

export const RESOURCES: Record<string, ResourceDef> = {
  pesca: { id: 'pesca', name: 'pesca', food: 1.15, fragility: 1.1, tradeValue: 0.5, glyph: 'olas', depleted: 'Los pescadores de {R} regresan con las redes vacías.' },
  grano: { id: 'grano', name: 'grano', food: 1.35, fragility: 0.7, tradeValue: 0.6, glyph: 'campo', depleted: 'La tierra de {R} se agrieta; las espigas salen huecas.' },
  sal: { id: 'sal', name: 'sal', food: 0.55, fragility: 0.5, tradeValue: 0.9, glyph: 'cristal', depleted: 'Las salinas de {R} se han vuelto amargas.' },
  hierbas: { id: 'hierbas', name: 'hierbas medicinales', food: 0.8, fragility: 1.3, tradeValue: 0.8, glyph: 'bosque', depleted: 'Los recolectores de {R} caminan días sin encontrar raíces.' },
  hierro: { id: 'hierro', name: 'hierro', food: 0.5, fragility: 1.0, tradeValue: 1.0, glyph: 'monte', depleted: 'Los ríos bajan rojizos desde las minas de {R}.' },
  lana: { id: 'lana', name: 'lana', food: 0.95, fragility: 0.9, tradeValue: 0.7, glyph: 'pasto', depleted: 'Los rebaños de {R} pastan sobre tierra desnuda.' },
  arcilla: { id: 'arcilla', name: 'arcilla fina', food: 0.7, fragility: 0.6, tradeValue: 0.7, glyph: 'campo', depleted: 'Las orillas de {R} se derrumban donde excavaron la arcilla.' },
  ambar: { id: 'ambar', name: 'ámbar', food: 0.6, fragility: 1.2, tradeValue: 1.1, glyph: 'bosque', depleted: 'Los bosques de {R} ya no sangran resina.' },
};

export const RESOURCE_IDS = Object.keys(RESOURCES);
