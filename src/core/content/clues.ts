import type { ClueKind } from '../types';

/**
 * Bancos de pistas indirectas. El jugador nunca ve "militancia 0.8":
 * ve frases como estas y debe deducir. {R} = región, {dir} = dirección
 * desde tu hogar, {X} = otra región.
 */
export const CLUE_TEXTS: Record<ClueKind, string[]> = {
  militar: [
    'Se escucharon movimientos durante la noche cerca de {R}.',
    'Los exploradores regresaron heridos de la frontera de {R}.',
    'Las forjas de {R} trabajan hasta muy tarde.',
    'Un pastor jura haber visto columnas de gente armada al {dir}.',
    'En {R} compran lanzas y cuero a cualquier precio.',
  ],
  construccion: [
    'Alguien está construyendo algo en {R}.',
    'Hay humo al {dir}, cerca de {R}.',
    'Desde {R} llegan pedidos extraños de materiales.',
    'Los carros que salen de {R} van cargados de piedra y cuerda.',
  ],
  hambre: [
    'Viajeros de {R} piden comida en los caminos.',
    'Los mercados de {R} están casi vacíos, dicen.',
    'Familias de {R} cambian herramientas por pan.',
    'En {R} ya no se oyen las fiestas de la cosecha.',
  ],
  ecologia: [
    'El agua baja turbia desde {R}.',
    'Los pájaros han dejado de anidar en {R}.',
    'Los cazadores de {R} vuelven con las manos vacías.',
  ],
  animo: [
    'Se oyen canciones de protesta en {R}.',
    'En {R} discuten a gritos en la plaza.',
    'Un mensajero de {R} habla de un consejo dividido.',
  ],
  comercio: [
    'Los comerciantes han cambiado de ruta: ahora pasan por {R}.',
    'Hay más carros que nunca en los caminos de {R}.',
    'Un mercader se queja de que en {R} ya no compran nada de fuera.',
  ],
  migracion: [
    'Familias enteras cruzan desde {R} con sus pertenencias.',
    'Hay campamentos improvisados en el camino de {R}.',
  ],
  salud: [
    'En {R} hablan de una fiebre que no se va.',
    'Los curanderos de {R} piden hierbas con urgencia.',
  ],
  clima: [
    'Las grullas han migrado antes de tiempo sobre {R}.',
    'En las cumbres de {R} hay escarcha fuera de estación.',
    'Los ancianos de {R} dicen que el aire huele a un invierno antiguo.',
  ],
  misterio: [],
  ruido: [
    'Hay humo al {dir}. Quizás una fiesta, quizás otra cosa.',
    'Alguien dice que en {R} se prepara algo grande.',
    'Se escucharon tambores al {dir} durante la noche.',
    'Un viajero asegura que {R} esconde algo.',
  ],
};
