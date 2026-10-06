/**
 * Iconos propios de ECOS: dibujos de trazo de tinta con un relleno de oro
 * viejo, del mismo lenguaje que el mundo pintado (y no emojis del sistema,
 * que cambian según el móvil y no casan con nada). Cada icono es un SVG de
 * 24×24 que hereda el color del texto.
 *
 * La interfaz se escribió con emojis; `iconize` los sustituye al vuelo en
 * todo lo que se añade al DOM, así que no hay que tocar cada pantalla.
 */

// Piezas: trazo (s), relleno de acento (f), relleno de tinta (k).
const S = (d: string) => `<path d="${d}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`;
const F = (d: string) => `<path d="${d}" fill="var(--ico-accent)" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`;
const K = (d: string) => `<path d="${d}" fill="currentColor"/>`;
const C = (cx: number, cy: number, r: number, fill = false) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${fill ? 'fill="var(--ico-accent)"' : 'fill="none"'} stroke="currentColor" stroke-width="1.6"/>`;

export const ICONS: Record<string, string> = {
  moneda: C(12, 12, 7.5, true) + S('M12 7.5v9M9.5 9.5c0-1 1-1.6 2.5-1.6s2.5.7 2.5 1.6-1 1.4-2.5 1.6-2.5.7-2.5 1.7 1 1.6 2.5 1.6 2.5-.6 2.5-1.6'),
  bolsa: F('M6 9.5c0-1.4 1.1-2.5 2.5-2.5h7c1.4 0 2.5 1.1 2.5 2.5V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19z') + S('M9 7V5.5A3 3 0 0 1 15 5.5V7M6 12h12M10.5 12v2h3v-2'),
  grano: S('M12 21V8M12 12c-2.5-.5-4-2.2-4-4.5 2.4.3 4 2 4 4.5zM12 12c2.5-.5 4-2.2 4-4.5-2.4.3-4 2-4 4.5zM12 16.5c-2.5-.5-4-2.2-4-4.5 2.4.3 4 2 4 4.5zM12 16.5c2.5-.5 4-2.2 4-4.5-2.4.3-4 2-4 4.5zM12 8c-1-1.5-1-3.2 0-4.8 1 1.6 1 3.3 0 4.8z'),
  pan: F('M4 14.5c0-4 3.6-7 8-7s8 3 8 7c0 1.6-1.2 2.5-2.6 2.5H6.6C5.2 17 4 16.1 4 14.5z') + S('M9 9.5l-1 3M12.5 8.8l-.6 3.4M16 9.8l-.2 3'),
  sueno: S('M5 6h5l-5 6h5M13 11h4l-4 5h4M18 4h3l-3 3.5h3'),
  brujula: C(12, 12, 8.5) + F('M12 5.5l2.2 6.5L12 18.5 9.8 12z') + K('M12 5.5l2.2 6.5H9.8z'),
  pergamino: F('M7 4.5h10a2 2 0 0 1 2 2V17H9v2.5a2 2 0 0 1-4 0V6.5a2 2 0 0 1 2-2z') + S('M9 19.5a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V17H9M10 8.5h6M10 11.5h6M10 14.5h4'),
  menu: S('M5 7h14M5 12h14M5 17h14'),
  mano: F('M8.5 12V6a1.3 1.3 0 0 1 2.6 0v4.5V4.8a1.3 1.3 0 0 1 2.6 0v5.7-4.2a1.3 1.3 0 0 1 2.6 0v6.9-3a1.3 1.3 0 0 1 2.6 0V15a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.6-2.2L4.6 15.6a1.4 1.4 0 0 1 2.1-1.9z'),
  correr: C(15, 4.8, 2, true) + S('M9 21l3-6 3 2.5V22M12 15l1.5-6.5L9 10l-2.5 3M13.5 8.5l2.5 3.5 3.5.5M7 17.5H3.5'),
  luna: F('M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z'),
  sol: C(12, 12, 4.2, true) + S('M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7'),
  nube: F('M7 18.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.6-1.3A4.7 4.7 0 0 1 17 18.5z'),
  lluvia: F('M7 14a3.7 3.7 0 0 1-.4-7.4 5.3 5.3 0 0 1 10.2-1.2A4.3 4.3 0 0 1 17 14z') + S('M8 17l-1 3M12 17l-1 3M16 17l-1 3'),
  tormenta: F('M7 13a3.7 3.7 0 0 1-.4-7.4 5.3 5.3 0 0 1 10.2-1.2A4.3 4.3 0 0 1 17 13z') + K('M12.5 13.5l-3 4.5h2.5l-1.5 4 4.5-5.5H12l1.5-3z'),
  viento: S('M3 9h11a2.5 2.5 0 1 0-2.5-2.5M3 13.5h15a2.5 2.5 0 1 1-2.5 2.5M3 18h7'),
  niebla: S('M4 8h12M7 12h13M4 16h10M8 20h9'),
  nieve: S('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M10 4.5l2 2 2-2M10 19.5l2-2 2 2M4.5 10.2l2.7-.6-.8-2.7M19.5 13.8l-2.7.6.8 2.7M4.5 13.8l2.7.6-.8 2.7M19.5 10.2l-2.7-.6.8-2.7'),
  mapa: F('M3.5 6l5.5-2 6 2 5.5-2v14l-5.5 2-6-2-5.5 2z') + S('M9 4v14M15 6v14'),
  persona: C(12, 8, 3.6, true) + S('M5 20.5c.6-4 3.4-6.5 7-6.5s6.4 2.5 7 6.5'),
  personas: C(9, 8.5, 3, true) + C(16.5, 9, 2.5) + S('M3.5 20c.5-3.6 2.8-5.8 5.5-5.8s5 2.2 5.5 5.8M15 14.5c2.8 0 4.8 1.9 5.3 5'),
  salon: F('M3.5 9.5L12 4l8.5 5.5z') + S('M5 9.5v9M9.5 9.5v9M14.5 9.5v9M19 9.5v9M3.5 20.5h17'),
  lupa: C(10.5, 10.5, 6, false) + S('M15 15l5.5 5.5') + `<circle cx="10.5" cy="10.5" r="3.6" fill="var(--ico-accent)" opacity=".45"/>`,
  matraz: F('M9.5 3.5h5M10.5 3.5v6L5.2 18.2A1.5 1.5 0 0 0 6.5 20.5h11a1.5 1.5 0 0 0 1.3-2.3L13.5 9.5v-6') + S('M7.5 15h9'),
  balanza: S('M12 4v16M8 20.5h8M5 7h14M12 5.5l0 0') + F('M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z'),
  estrella: F('M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8 6.8 19.6l1-5.8-4.3-4.1 5.9-.8z'),
  engranaje: F('M10.3 3.5h3.4l.5 2.3 1.8.8 2-1.3 2.4 2.4-1.3 2 .8 1.8 2.3.5v3.4l-2.3.5-.8 1.8 1.3 2-2.4 2.4-2-1.3-1.8.8-.5 2.3h-3.4l-.5-2.3-1.8-.8-2 1.3-2.4-2.4 1.3-2-.8-1.8-2.3-.5v-3.4l2.3-.5.8-1.8-1.3-2 2.4-2.4 2 1.3 1.8-.8z') + C(12, 12, 3),
  puerta: F('M6 21V5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 5v16') + S('M3.5 21h17M14.5 12.5v1'),
  habla: F('M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z') + S('M8 9h8M8 12h5'),
  oido: F('M7 9a5 5 0 0 1 10 0c0 3-2.5 3.6-3 6.2-.4 2.2-1.8 4.3-4 4.3A3 3 0 0 1 7 16.5') + S('M10 9.5a2 2 0 0 1 4 0c0 1.4-1.3 1.6-1.3 3'),
  cuenco: F('M3.5 11.5h17a8.5 8.5 0 0 1-17 0z') + S('M9 4c-1 1.2 1 2 0 3.5M13 4c-1 1.2 1 2 0 3.5M8 20.5h8'),
  cama: F('M3.5 13h17v4.5h-17z') + S('M3.5 8v13M20.5 13v8M3.5 17.5h17') + C(7.5, 10.5, 1.8, true),
  rueda: C(12, 12, 8.5) + C(12, 12, 2, true) + S('M12 3.5v6.5M12 14v6.5M3.5 12H10M14 12h6.5M6 6l4.5 4.5M13.5 13.5L18 18M18 6l-4.5 4.5M10.5 13.5L6 18'),
  caballo: F('M6 20.5l1.5-6.5L5 11.5l3.5-6L11 3.5l1 2.5c3 .5 6 3 6.5 6.5L20 20.5h-3.5l-1.5-5.5-4.5.5-1 5z') + K('M9.8 7.6a.9.9 0 1 0 0 .1z'),
  caja: F('M4 8l8-4 8 4v9l-8 4-8-4z') + S('M4 8l8 4 8-4M12 12v9'),
  pacto: F('M3 12l4-4 3 1.5 3-2 4 1.5 4 3-4 5.5-2-1-2 1.5-2-1.5-2 1-3.5-2.5z') + S('M10 9.5l-2.5 3 1.5 1.5 3-2.5M13 13l2.5 2'),
  espadas: S('M5 3.5l9.5 9.5M4 7l3-3M13 14.5l-3 3M11.5 19l-2-2M19 3.5l-9.5 9.5M20 7l-3-3M11 14.5l3 3M12.5 19l2-2') + F('M3.5 18.5l3-3 2 2-3 3zM20.5 18.5l-3-3-2 2 3 3z'),
  vela: F('M9 10h6v10.5H9z') + F('M12 2.5c2 2.5 2 4.5 0 6-2-1.5-2-3.5 0-6z') + S('M7 20.5h10'),
  ojo: F('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + `<circle cx="12" cy="12" r="3" fill="currentColor"/>`,
  reloj: S('M6.5 3.5h11M6.5 20.5h11M7.5 3.5c0 5 4.5 5.5 4.5 8.5s-4.5 3.5-4.5 8.5M16.5 3.5c0 5-4.5 5.5-4.5 8.5s4.5 3.5 4.5 8.5') + F('M9.5 19.5c0-2 2.5-3 2.5-4.5 0 1.5 2.5 2.5 2.5 4.5z'),
  tridente: S('M12 21V6M7 4v4a5 5 0 0 0 10 0V4M12 3l-1 2.5h2z') + F('M10 20.5h4l-.5-3h-3z'),
  llave: C(7.5, 12, 4, true) + S('M11.5 12h9M17 12v3.5M20 12v2.5'),
  brote: S('M12 21v-8') + F('M12 13c-4.5 0-7-2.5-7-7 4.5 0 7 2.5 7 7zM12 15.5c0-4 2.2-6.5 6.5-6.5 0 4-2.2 6.5-6.5 6.5z'),
  escudo: F('M12 3l7.5 2.5v6c0 5-3.4 8.3-7.5 9.5-4.1-1.2-7.5-4.5-7.5-9.5v-6z') + S('M12 7v10M8 11h8'),
  fuego: F('M12 21a6 6 0 0 1-6-6c0-3.5 3-5.5 3.5-9 2 1 3 3 3 5 1-1 1.5-2.3 1.2-4C16.5 8.5 18 11.5 18 15a6 6 0 0 1-6 6z') + S('M12 21c-1.8 0-3-1.3-3-3 0-2 1.6-2.7 2-4.5 1.6 1 3 2.5 3 4.5a2 2 0 0 1-2 3z'),
  puno: F('M6.5 10.5V8a1.5 1.5 0 0 1 3 0v-.5a1.5 1.5 0 0 1 3 0V8a1.5 1.5 0 0 1 3 0v.5a1.5 1.5 0 0 1 3 0v5.5a7 7 0 0 1-7 7h-.5a5.5 5.5 0 0 1-5.5-5.5V12a1.5 1.5 0 0 1 3-.5') + S('M9.5 8v3M12.5 7.5v3.5M15.5 8v3'),
  voz: C(8.5, 9, 3.2, true) + S('M2.5 20c.5-3.4 2.9-5.6 6-5.6s5.5 2.2 6 5.6M15.5 6.5a5 5 0 0 1 0 6M18.5 4a8.5 8.5 0 0 1 0 11'),
  hoja: F('M5 19c0-8 5-14 15-15 0 9-5 15-13 15') + S('M5 19L14 10'),
  carta: F('M3.5 6.5h17v11h-17z') + S('M3.5 6.5l8.5 7 8.5-7'),
  libro: F('M4 5.5c3-1 5.5-1 8 .8 2.5-1.8 5-1.8 8-.8v13c-3-1-5.5-1-8 .8-2.5-1.8-5-1.8-8-.8z') + S('M12 6.3v13.5'),
  casa: F('M4.5 11L12 4.5l7.5 6.5v9.5h-15z') + S('M10 20.5V15h4v5.5'),
  paloma: F('M3 13c3 0 5-1.5 6.5-4 1.2-2.2 3.5-3.5 6-3l2 .5-1.5 1.5 3 1.5-3 1c0 5-4 8.5-9 8.5L9 17z') + K('M15.2 7.3a.7.7 0 1 0 0 .1z'),
  bolsaDinero: F('M8.5 8.5L7 4.5h10l-1.5 4c3 1.5 5 4.6 5 8 0 2.5-2 4-4.5 4h-8C5.5 20.5 3.5 19 3.5 16.5c0-3.4 2-6.5 5-8z') + S('M8.5 8.5h7M12 11v6M10 12.5c0-.8 4-.8 4 .5s-4 .7-4 2 4 1.2 4 .3'),
  cesta: F('M3.5 10h17l-2 9.5a1.5 1.5 0 0 1-1.5 1h-10a1.5 1.5 0 0 1-1.5-1z') + S('M7.5 10a4.5 5 0 0 1 9 0M8 13.5v4M12 13.5v4M16 13.5v4'),
  espejo: `<ellipse cx="12" cy="10" rx="5.5" ry="7" fill="var(--ico-accent)" stroke="currentColor" stroke-width="1.6"/>` + S('M12 17v4M8.5 21h7M9.5 7.5l2.5-2'),
  pluma: F('M20 3.5c-7 1-12 6-13.5 13.5l2 .5C10 11 14 6.5 20 3.5z') + S('M6.5 17l-2 3.5M9 13h4'),
  anillo: C(12, 14.5, 6) + F('M9.5 6.5L12 3.5l2.5 3L12 8.5z'),
  corazon: F('M12 20s-8-4.6-8-10.5A4.5 4.5 0 0 1 12 6.8a4.5 4.5 0 0 1 8 2.7C20 15.4 12 20 12 20z'),
  birrete: F('M2.5 9L12 4.5 21.5 9 12 13.5z') + S('M6.5 11v4.5c3 2.5 8 2.5 11 0V11M21.5 9v5'),
  barco: F('M3 15.5h18l-2.5 4.5h-13z') + F('M12 3.5v10H6z') + S('M12 3.5v12M13.5 6l4.5 7.5h-4.5'),
  aviso: F('M12 3.5l9.5 16.5h-19z') + S('M12 9.5v5M12 17.2v.3'),
  carro: F('M3.5 6.5h3l2 9h10l2-6.5H7.5') + C(9.5, 19, 1.6, true) + C(17, 19, 1.6, true),
  tienda: F('M3.5 9.5l2-5h13l2 5c0 1.4-1.1 2.5-2.5 2.5S15.5 10.9 15.5 9.5c0 1.4-1.1 2.5-2.5 2.5h-2c-1.4 0-2.5-1.1-2.5-2.5C8.5 10.9 7.4 12 6 12s-2.5-1.1-2.5-2.5z') + S('M5 12v8.5h14V12M10 20.5v-5h4v5'),
  urna: F('M4 10h16v10.5H4z') + S('M9 10V8.5h6V10M7.5 3.5l3 3 6-3.5') + S('M9 14h6'),
  bocina: F('M3.5 10v4h3l7 5V5l-7 5z') + S('M17 9a4.5 4.5 0 0 1 0 6M19.5 6.5a8 8 0 0 1 0 11'),
  amanecer: F('M6 17a6 6 0 0 1 12 0z') + S('M3 17h18M12 5v3M5.5 9l1.8 1.5M18.5 9l-1.8 1.5M7 20.5h10'),
  bombilla: F('M8.5 15a6 6 0 1 1 7 0v2h-7z') + S('M9.5 20.5h5M12 11v4'),
  arbol: F('M12 3c4 0 6.5 3 6.5 6.5 0 3.3-2.6 5.5-6.5 5.5S5.5 12.8 5.5 9.5C5.5 6 8 3 12 3z') + S('M12 9v12M9 21h6M12 13l-2.5-2M12 12l2.5-2.5'),
  disco: F('M4.5 4.5h12l3 3v12h-15z') + S('M8 4.5v5h7v-5M8 19.5v-5.5h8v5.5'),
  pieza: F('M4 8h4a2 2 0 1 1 4 0h4v4a2 2 0 1 1 0 4v4H4v-4a2 2 0 1 0 0-4z'),
  aldea: F('M3 12.5L8 8l5 4.5V20H3z') + F('M13 10.5l4-3.5 4 3.5V20h-8z') + S('M6.5 20v-3.5h3V20'),
  caminante: C(13, 4.8, 2, true) + S('M10 21l2-5.5 2.5 2V21M12 15.5l1-6-3 1.5-1.5 3M13 9.5l2 3 2.5.5'),
  pregunta: C(12, 12, 8.5, true) + S('M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7v.5M12 17v.2'),
  pico: S('M4 7c4.5-3.5 11.5-3.5 16 0M12 5l-5.5 15.5') + F('M3.5 7.3c1.2-.9 2.4-1.5 3.7-2l.5 2.2c-1.3.4-2.6 1-3.8 1.9zM20.5 7.3c-1.2-.9-2.4-1.5-3.7-2l-.5 2.2c1.3.4 2.6 1 3.8 1.9z'),
  ancla: C(12, 5, 2) + S('M12 7v13.5M7.5 11h9M4.5 14c.5 4 3.5 6.5 7.5 6.5s7-2.5 7.5-6.5'),
  bandera: S('M5 21V3.5') + F('M5 4.5h12l-2.5 4 2.5 4H5z'),
  cadena: S('M9.5 14.5l5-5') + F('M10.5 7.5l2-2a3.5 3.5 0 0 1 5 5l-2 2-1.5-1.5 2-2a1.4 1.4 0 0 0-2-2l-2 2zM13.5 16.5l-2 2a3.5 3.5 0 0 1-5-5l2-2 1.5 1.5-2 2a1.4 1.4 0 0 0 2 2l2-2z'),
  corona: F('M3.5 8l4 3.5L12 5l4.5 6.5 4-3.5-1.5 10h-14z') + S('M5 20.5h14'),
  regalo: F('M4 10h16v10.5H4z') + F('M3 7.5h18V10H3z') + S('M12 7.5v13M12 7.5C10 3.5 6.5 4.5 8 7.5M12 7.5c2-4 5.5-3 4 0'),
  martillo: F('M4.5 6.5l5-3 4 2-1.5 2.5-2-1-2 1.5z') + S('M9.5 8.5l9 11.5'),
  diana: C(12, 12, 8.5) + C(12, 12, 5, true) + `<circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  campana: F('M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z') + S('M10 20.5a2 2 0 0 0 4 0M12 3.5V5'),
  nota: F('M9 17.5V5.5l10-2v12') + C(7, 17.5, 2.2, true) + C(17, 15.5, 2.2, true),
  marco: F('M4 4.5h16v15H4z') + S('M7 16l3.5-4 2.5 2.5 2-2 2.5 3.5M9 9.2v.1'),
  maleta: F('M3.5 8h17v11.5h-17z') + S('M9 8V5.5h6V8M3.5 12.5h17'),
  tumba: F('M6 20.5V10a6 6 0 0 1 12 0v10.5z') + S('M4 20.5h16M12 9v6M9.5 11.5h5'),
  cueva: F('M2.5 20.5C4 10 8 5 12 5s8 5 9.5 15.5z') + K('M8.5 20.5c0-4 1.5-7 3.5-7s3.5 3 3.5 7z'),
  ruina: S('M4 20.5h16M6 20.5V9M10 20.5V12M14 20.5V7M18 20.5V11') + F('M5 7.5h3v2H5zM13 5h3v2h-3z'),
  palmera: S('M12 21c0-5 .5-9 2-12') + F('M14 9c-2-3-6-3.5-8.5-1.5 2.5.2 4.5 1 6 2.5zM14 9c1-3 4.5-4.5 7.5-3-2.2.6-4 1.7-5.5 3.5zM14 9c-1-2.5-.5-5.5 1.5-6.5-.2 2.2 0 4.2.5 6z'),
  hito: F('M7 20.5V8l5-4.5L17 8v12.5z') + S('M10 11h4M10 14h4'),
};

/** Qué icono corresponde a cada emoji que todavía usa la interfaz. */
const EMOJI: Record<string, string> = {
  '🪙': 'moneda', '💰': 'bolsaDinero', '🎒': 'bolsa', '🌾': 'grano', '🍞': 'pan', '💤': 'sueno', '🧭': 'brujula',
  '📜': 'pergamino', '☰': 'menu', '✋': 'mano', '🤲': 'mano', '🏃': 'correr', '🚶': 'caminante', '🌙': 'luna', '🌒': 'luna',
  '☀': 'sol', '☁': 'nube', '🌧': 'lluvia', '⛈': 'tormenta', '🌬': 'viento', '🌫': 'niebla', '❄': 'nieve',
  '🗺': 'mapa', '🪞': 'espejo', '👤': 'persona', '🧑': 'persona', '🧒': 'persona', '👶': 'persona', '🙂': 'persona',
  '😔': 'persona', '😠': 'persona', '😟': 'persona', '🙅': 'persona', '👥': 'personas', '👪': 'personas',
  '🏛': 'salon', '🔎': 'lupa', '🧪': 'matraz', '⚖': 'balanza', '⭐': 'estrella', '⚙': 'engranaje', '🛠': 'engranaje',
  '🚪': 'puerta', '💬': 'habla', '🗣': 'voz', '📣': 'bocina', '👂': 'oido', '🍲': 'cuenco', '🛏': 'cama',
  '🛞': 'rueda', '🐴': 'caballo', '📦': 'caja', '📥': 'caja', '📤': 'caja', '🤝': 'pacto', '🙏': 'pacto', '👋': 'mano',
  '⚔': 'espadas', '🗡': 'espadas', '🕯': 'vela', '👁': 'ojo', '⏳': 'reloj', '🔱': 'tridente', '🗝': 'llave',
  '🌱': 'brote', '🛡': 'escudo', '🔥': 'fuego', '✊': 'puno', '🌿': 'hoja', '🍂': 'hoja', '📨': 'carta', '✉': 'carta',
  '📒': 'libro', '📖': 'libro', '📚': 'libro', '📓': 'libro', '📝': 'pluma', '🏠': 'casa', '🏚': 'ruina', '🕊': 'paloma',
  '🧺': 'cesta', '💍': 'anillo', '💞': 'corazon', '🎓': 'birrete', '⛵': 'barco', '❗': 'aviso', '🛒': 'carro',
  '🏪': 'tienda', '🗳': 'urna', '🌅': 'amanecer', '💡': 'bombilla', '🌳': 'arbol', '🌴': 'palmera', '💾': 'disco',
  '🧩': 'pieza', '🏘': 'aldea', '🏕': 'aldea', '❓': 'pregunta', '❔': 'pregunta', '⛏': 'pico', '⚓': 'ancla',
  '⛳': 'bandera', '⚑': 'bandera', '⛓': 'cadena', '👑': 'corona', '🎁': 'regalo', '🔨': 'martillo', '🎯': 'diana',
  '🔔': 'campana', '🎵': 'nota', '🖼': 'marco', '🧳': 'maleta', '🗿': 'hito', '🕳': 'cueva', '📈': 'diana',
  '📐': 'pluma', '🕹': 'brujula',
};

export function icon(name: string, cls = ''): string {
  const body = ICONS[name] ?? ICONS.estrella;
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
}

const RE = new RegExp(`(${Object.keys(EMOJI).map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\uFE0F?`, 'gu');

/** Cambia los emojis de un trozo de DOM (y de lo que se le añada después) por iconos propios. */
export function iconize(root: Node): void {
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.nodeValue ?? '';
      RE.lastIndex = 0;
      if (!RE.test(t)) return;
      const span = document.createElement('span');
      span.className = 'ico-text';
      // El texto se escapa: solo los emojis conocidos se convierten en SVG.
      const esc = t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
      span.innerHTML = esc.replace(RE, (_m, e: string) => icon(EMOJI[e]));
      n.parentNode?.replaceChild(span, n);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as Element;
    if (el.tagName === 'svg' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'CANVAS' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return;
    // Etiquetas y títulos accesibles conservan el texto; solo cambia lo que se ve.
    for (const c of [...el.childNodes]) walk(c);
  };
  walk(root);
}

/** Vigila un contenedor y convierte todo lo que se le añada. */
export function watchIcons(root: HTMLElement): MutationObserver {
  iconize(root);
  const mo = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData' && m.target.parentNode) iconize(m.target.parentNode);
      for (const n of m.addedNodes) iconize(n);
    }
  });
  mo.observe(root, { childList: true, subtree: true, characterData: true });
  return mo;
}
