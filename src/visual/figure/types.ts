/**
 * Contrato entre la escena y las figuras: cómo está una persona (hacia dónde
 * mira, qué hace, qué siente). Lo decide la escena leyendo el mundo; la
 * figura solo lo pinta.
 */
export type Expr = 'feliz' | 'neutral' | 'preocupado' | 'enfadado' | 'miedo' | 'triste' | 'sorpresa' | 'desconfianza' | 'alivio' | 'hostil' | 'cansado' | 'confiado';
export type Facing = 'front' | 'back' | 'side';
export type Action =
  | 'idle'
  | 'walk'
  | 'run'
  | 'work' // azada, siembra, recoger
  | 'hammer'
  | 'sit'
  | 'talk'
  | 'wave'
  | 'cross'
  | 'point'
  | 'carry'
  | 'nod'
  | 'shake'
  | 'look'
  | 'fish'
  | 'listen'
  | 'eat'
  | 'sleep'
  | 'cry'
  | 'celebrate'
  | 'fight'
  | 'argue'
  | 'rest'
  | 'patrol';

export interface Pose {
  facing: Facing;
  flip: boolean; // de perfil: mira a la izquierda
  phase: number; // ciclo de paso (radianes acumulados)
  action: Action;
  t: number; // segundos (gestos, parpadeo, respiración)
  expr: Expr;
  lod: 0 | 1 | 2;
  hood?: boolean; // capucha puesta (lluvia)
  heavy?: boolean; // abrigo de nieve
  umbrella?: boolean; // paraguas encerado (lluvia, gente acomodada)
  wet?: boolean; // ropa mojada (más oscura y brillante)
  speed?: number; // 0..1 velocidad real (mezcla de reposo y marcha)
  drink?: boolean; // sentado con una jarra que se lleva a la boca de vez en cuando
}
