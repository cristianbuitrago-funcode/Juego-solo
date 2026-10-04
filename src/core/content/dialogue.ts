/**
 * Plantillas de diálogo basadas en recuerdos. Un personaje no repite frases:
 * construye lo que dice a partir de sus recuerdos más fuertes y de su
 * emoción dominante. {d} = días transcurridos, {R} = región, {X} = otra región,
 * {rel} = familiar.
 */
export const MEMORY_LINES: Record<string, string[]> = {
  ayuda: ['Hace {d} días ayudaste a mi pueblo. No lo olvido.', 'Cuando nos faltó de todo, hace {d} días, tus carros llegaron.'],
  ayudaRepetida: ['Ya nos has ayudado muchas veces. Algunos aquí han dejado de sembrar.', 'Mi gente pregunta cuándo llegará tu próximo envío, no cuándo será la cosecha.'],
  negada: ['Hace {d} días te pedimos ayuda y miraste hacia otro lado.', 'Te pedimos comida hace {d} días. Recuerdo tu respuesta.'],
  quitar: ['Hace {d} días nos quitaste los alimentos.', 'Se llevaron nuestro grano en tu nombre, hace {d} días.'],
  muerte: ['{rel} murió durante aquella decisión, hace {d} días.', 'Hace {d} días enterré a {rel}. No me pidas que sonría.'],
  fuerza: ['Hace {d} días tus guardias pisaron nuestras tierras.', 'Vimos tus lanzas hace {d} días. Nadie aquí lo ha olvidado.'],
  mediacion: ['Hace {d} días nos sentaste a la misma mesa que {X}. Fue difícil, pero sirvió.', 'Tu mediación con {X} evitó lo peor, hace {d} días.'],
  mediacionFallida: ['Hace {d} días intentaste que habláramos con {X}. Fue inútil.'],
  rutaCerrada: ['Hace {d} días cerraste el camino. Los mercaderes ya no vienen.', 'Desde que cerraste la ruta, hace {d} días, el mercado está en silencio.'],
  rutaAbierta: ['Reabriste el camino hace {d} días. Volvimos a ver caras nuevas.'],
  verdad: ['Hace {d} días nos contaste la verdad sobre {X}. Te creímos, y tenías razón.'],
  mentira: ['Hace {d} días nos mentiste sobre {X}. Ahora dudamos de todo lo que dices.'],
  espia: ['Descubrimos a tu observador hace {d} días. ¿Así tratas a tus vecinos?'],
  sabotaje: ['Hace {d} días alguien quemó nuestros talleres. Sabemos que fuiste tú.'],
  abandono: ['Nos abandonaste hace {d} días. Aprendimos a vivir sin ti.'],
  favor: ['Nos favoreces desde hace {d} días. Otros nos miran con envidia.'],
  guerra: ['La guerra con {X} empezó hace {d} días. {rel} no volvió.', 'Hace {d} días {X} cruzó la frontera.'],
  alianza: ['Hace {d} días sellamos la alianza con {X} gracias a ti.'],
  alianzaRota: ['Hace {d} días rompiste nuestra alianza con {X}. Eso no se perdona fácilmente.'],
  invento: ['Hace {d} días nuestros talleres lograron algo nuevo. Sin ayuda de nadie.'],
  robo: ['{X} copió nuestro invento hace {d} días. Sin pedir permiso.'],
  legado: ['Mi abuela contaba que un extranjero como tú enfrentó a mi pueblo con {X}. Las canciones aún lo recuerdan.', 'Las viejas canciones hablan de alguien como tú, que nos ayudó cuando nadie lo hizo.'],
  refugio: ['Hace {d} días nos diste refugio. Mis hijos duermen bajo tu techo.'],
  rechazo: ['Hace {d} días cerraste tus puertas a los que huíamos.'],
  prohibicion: ['Prohibiste nuestro {res} hace {d} días. ¿De qué viviremos?'],
  rumor: ['Hace {d} días oímos lo que se dice de {X}. ¿Es verdad?'],
};

/** Saludos según la emoción dominante. */
export const MOOD_LINES: Record<string, string[]> = {
  trust: ['Siéntate. Aquí siempre hay sitio para ti.', 'Me alegra verte. Hablemos con calma.'],
  fear: ['Habla rápido. No sé si es seguro que te vean conmigo.', 'Las cosas están raras últimamente. Muy raras.'],
  resentment: ['¿Otra vez tú? Di lo que tengas que decir.', 'No esperes una bienvenida.'],
  gratitude: ['Amigo de {R}, bienvenido.', 'Siempre tendrás pan en esta casa.'],
  ambition: ['Tengo planes para {R}. Quizás encajes en ellos.', 'El mundo está cambiando. Quien se mueva primero, gana.'],
  curiosity: ['¿Qué noticias traes de fuera? Cuéntamelo todo.', 'He visto cosas extrañas estos días. ¿Tú también?'],
  neutral: ['Te escucho.', 'Buen día, viajero.'],
};
