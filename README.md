# ECOS: El Mundo que Recuerda

Juego 2D de estrategia para **un jugador**, pensado para **teléfonos Android** en vertical.

Guías a una pequeña civilización en un mundo que funciona por sí mismo. No construyes bases, no recolectas oro ni madera, no produces soldados. La estrategia está en:

**información incompleta + memoria de personajes + consecuencias en cadena + experimentación + mundo autónomo + decisiones con efectos retardados.**

---

## Cómo se juega

1. **Observa el mapa.** Cada región se colorea según lo que *sabes* de ella, no según la verdad. Lo que no has explorado aparece con niebla.
2. **Interpreta las pistas.** No hay cifras: «Hay humo al norte», «Los exploradores regresaron heridos», «Alguien está construyendo algo». Unas son ciertas, otras son ruido o malentendidos.
3. **Decide.** Toca una región → *Decidir*. Puedes enviar observadores o espías, investigar rumores, enviar provisiones, mediar, proponer o romper alianzas, presionar, sabotear, cerrar rutas, prohibir recursos, favorecer o abandonar regiones, compartir u ocultar información, crear rumores… y, como último recurso, intervenir con tu guardia.
4. **Formula hipótesis.** Acompaña una decisión con una predicción («creo que si ayudo a esta región, su alimento aumentará en 5 días»). Al vencer el plazo sabrás si era *correcta*, *parcial* o *incorrecta*, y descubrirás parte de lo que pasó de verdad.
5. **AVANZAR DÍA.** El mundo procesa las consecuencias y te cuenta lo que llega a tus oídos en el informe del amanecer.

Los objetivos son varios (paz duradera, cooperación entre regiones, sociedad sostenible, confirmar hipótesis…) y algunos **se descubren jugando**: la verdad oculta del mundo, convencer a una región que desconfía de ti, sobrevivir a una crisis o detener una epidemia.

### Controles táctiles

| Gesto | Acción |
| --- | --- |
| Tocar región | Abre su panel (Saber · Gente · Decidir · Historia) |
| Mantener pulsado | Resumen rápido de lo que sabes de la región |
| Arrastrar | Mover el mapa |
| Pellizcar | Zoom |
| Doble toque | Acercar |
| Deslizar hacia abajo el panel | Cerrarlo |
| Botón «atrás» de Android | Cierra el último panel o diálogo |

---

## Mecánicas principales (y dónde están en el código)

| Mecánica | Implementación |
| --- | --- |
| **El mundo recuerda.** Cada acontecimiento se registra con su causa (`causeId`), lo que forma cadenas («cerraste la ruta → los comerciantes cambian de ruta → la región pierde comercio → hambre → investigan una técnica → la inventan → la comparten…»). | `src/core/chronicle.ts`, `Entry` en `src/core/types.ts` |
| **Consecuencias retardadas.** Las acciones programan efectos para días futuros (fin de una requisa, descubrimiento de un engaño, resultado de una mediación…). | `src/core/effects.ts` |
| **Información incompleta.** El estado real nunca se muestra. Se traduce a descriptores imprecisos con fecha y fiabilidad; las pistas pueden ser falsas. | `src/core/intel.ts`, `src/core/systems/clues.ts` |
| **Rumores.** Pueden ser ciertos, falsos, malentendidos o fabricados (por ti o por otros). Las regiones que los creen actúan en consecuencia, así que un rumor falso puede volverse verdad. | `src/core/systems/rumors.ts` |
| **Personajes con memoria.** Emociones simples (confianza, miedo, rencor, gratitud, ambición, curiosidad) que cambian con cada recuerdo. Hablan a partir de sus recuerdos («Hace 8 días nos quitaste los alimentos») y pueden mentir. Si alguien muere y la cadena causal empezó en una decisión tuya, sus allegados te culpan. | `src/core/systems/characters.ts`, `src/core/content/dialogue.ts` |
| **Patrones aprendidos.** Si resuelves siempre igual, el mundo se adapta: dependencia de tu ayuda, regiones que se arman ante tu fuerza, pueblos que piden tu mediación, desconfianza ante tus engaños. | `src/core/systems/patterns.ts` |
| **Abandono.** Las regiones desatendidas desarrollan sus propias soluciones y pueden volverse autónomas. | `tickNeglect` en `patterns.ts` |
| **Mundo autónomo.** Comercio, hambre, migraciones (que llevan costumbres y técnicas), ecosistemas que se degradan y se transforman, inventos que nacen de la necesidad y se difunden o provocan disputas, alianzas y guerras. | `src/core/systems/*.ts` |
| **Conflictos sin ejércitos.** Las guerras avisan antes de estallar; se previenen con negociación, información, economía, rutas, alianzas, presión, sabotaje o investigación. La fuerza es el último recurso. | `conflict.ts`, `relations.ts`, `actions.ts` |
| **Hipótesis.** Predicciones evaluadas por el motor: métricas, rumores, guerras e inventos. | `src/core/systems/hypotheses.ts` |
| **Verdad oculta.** Cada mundo tiene un misterio (el manipulador de rumores, la fiebre del río, el invierno largo, el archivo antiguo) que influye en la simulación y se resuelve reuniendo fragmentos. | `src/core/systems/mystery.ts` |
| **Objetivos múltiples**, visibles y ocultos. | `src/core/systems/objectives.ts` |
| **Legado entre partidas.** Al terminar una era, los rencores y favores se guardan por cultura y reaparecen en mundos futuros como recuerdos de los personajes y viejas enemistades. | `src/core/legacy.ts` |
| **Generación procedural.** Isla, regiones (Voronoi deformado con ruido), río, culturas, recursos, personajes, relaciones, rival, misterio y objetivos. La misma semilla genera el mismo mundo. | `src/core/gen/` |

---

## Arquitectura

```
src/
├── core/                  Motor del juego (TypeScript puro, sin DOM; probado con Vitest)
│   ├── types.ts           Modelo de datos del mundo
│   ├── world.ts           Contexto de simulación (estado + RNG) y utilidades
│   ├── rng.ts, noise.ts   Aleatoriedad determinista y ruido para el mapa
│   ├── chronicle.ts       Memoria del mundo y cadenas causales
│   ├── effects.ts         Consecuencias retardadas (cola de efectos)
│   ├── intel.ts           Información incompleta: verdad → descriptores imprecisos
│   ├── actions.ts         Catálogo de decisiones del jugador y misiones
│   ├── simulation.ts      AVANZAR DÍA: orden de los sistemas, final de era
│   ├── api.ts             Fachada que usa la interfaz
│   ├── save.ts, storage.ts, legacy.ts
│   ├── gen/               mapgen.ts (isla y regiones) · worldgen.ts (todo lo demás)
│   ├── content/           Datos: culturas, recursos, técnicas, nombres, roles, diálogos, pistas
│   └── systems/           Reglas del mundo: economy, ecology, tech, relations, conflict,
│                          rumors, clues, characters, patterns, petitions, hypotheses,
│                          mystery, objectives, player
├── ui/                    Interfaz táctil (DOM + Canvas, sin framework)
│   ├── app.ts             Controlador: vistas, hoja de región, modales, botón atrás
│   ├── map/               view.ts (mapa interactivo) · colors.ts (color según lo que sabes)
│   └── screens/           menu, region, decisions, research, hypotheses, chronicle,
│                          composer (pantalla de decisión + hipótesis), dawn, help
├── audio/audio.ts         Música ambiental generativa (Web Audio) según el estado del mundo
├── styles.css
└── main.ts
android/                   Proyecto nativo Android (Capacitor)
tests/core.test.ts         Pruebas del motor
scripts/                   Simulaciones sin interfaz para equilibrar
```

El **motor** (`src/core`) no conoce la interfaz: recibe acciones, avanza días y devuelve informes. Todo el estado es un objeto JSON serializable (incluido el estado del generador aleatorio), así que guardar, cargar y reproducir una partida es trivial y determinista.

### Orden de un día (`simulation.ts`)

1. Consecuencias programadas que vencen hoy
2. Economía (producción, comercio, hambre, población, migraciones)
3. Ecología · 4. Tecnología · 5. Relaciones y alianzas · 6. Conflictos
7. Misterio · 8. Personajes · 9. Abandono/autonomía
10. Rumores · 11. Pistas · 12. Peticiones
13. Tu civilización · 14. Hipótesis · 15. Objetivos

---

## Cómo ampliar el juego

- **Nueva región / cultura:** añade una entrada a `CULTURES` en `src/core/content/cultures.ts` (nombre, tono de color, rasgos y sílabas). El número de regiones se controla con `regionCount` en `createWorld`.
- **Nuevo recurso:** `RESOURCES` en `src/core/content/resources.ts` (+ su transformación en `ecology.ts`).
- **Nueva técnica:** `TECHS` en `src/core/content/techs.ts`. Su función `pressure` decide cuándo la situación de una región empuja a inventarla.
- **Nueva acción del jugador:** añade un `ActionDef` a `ACTIONS` en `src/core/actions.ts` (`check` + `run`). Aparecerá en el panel de región si la añades a la lista de `tabDecide` (`src/ui/screens/region.ts`).
- **Nueva consecuencia retardada:** `registerEffect('tipo', handler)` y prográmala con `schedule(ctx, 'tipo', días, datos, causa)`.
- **Nueva regla del mundo:** escribe un sistema `(ctx) => void` y regístralo con `registerSystem(nombre, sistema, antesDe?)`.
- **Nuevo personaje / rol:** `ROLES` en `src/core/content/roles.ts`; nuevos tipos de recuerdo en `MEMORY_LINES` (`dialogue.ts`) y su impacto emocional en `EMOTION_IMPACT` (`characters.ts`).
- **Nuevas pistas:** `CLUE_TEXTS` en `src/core/content/clues.ts`.
- **Nuevo misterio:** añade un `MysteryDef` a `MYSTERIES` en `src/core/systems/mystery.ts`.
- **Nuevo objetivo:** añade un `ObjectiveDef` a `OBJECTIVES` en `src/core/systems/objectives.ts`.

Registra siempre lo importante con `record(ctx, { …, causeId })`: así el mundo lo recuerda y el jugador puede seguir la cadena de consecuencias.

---

## Desarrollo

Requisitos: Node.js 20+.

```bash
npm install
npm run dev        # servidor de desarrollo (abre la URL en el móvil o en modo móvil del navegador)
npm test           # pruebas del motor
npm run typecheck
npm run build      # compila a dist/
npm run sim -- 1234 60 aleatorio   # simula una partida sin interfaz (semilla, días, estrategia)
npx vite-node scripts/stats.ts 20  # estadísticas de 20 mundos (para equilibrar)
```

## Generar el APK para Android

Requisitos: Android Studio (o Android SDK + JDK 17+).

```bash
npm install
npm run android:sync     # compila la web y la copia al proyecto android/
npm run android:open     # abre Android Studio → Run ▶ o Build › Build APK(s)
```

O desde la terminal, con el SDK instalado:

```bash
cd android
./gradlew assembleDebug          # APK en android/app/build/outputs/apk/debug/
```

La app está fijada en orientación vertical, usa el botón «atrás» del sistema, guarda las partidas en el almacenamiento local del dispositivo y funciona sin conexión.

---

## Estado del prototipo

Implementadas las cuatro fases pedidas:

- **Fase 1:** mapa, regiones, sistema de tiempo, decisiones, memoria, eventos y consecuencias.
- **Fase 2:** personajes con memoria y emociones, relaciones, investigación, hipótesis e información incompleta.
- **Fase 3:** generación procedural, eventos emergentes, objetivos múltiples (visibles y ocultos) y una primera pasada de equilibrio con simulaciones automáticas.
- **Fase 4:** interfaz táctil Android, animaciones discretas (humo, comercio, emisarios, pulsos), música generativa según el estado del mundo, guardado/carga (3 ranuras + autoguardado + exportar/importar) y proyecto Capacitor.

Pendiente para iteraciones futuras: más contenido (misterios, técnicas, tipos de petición), afinar el equilibrio con partidas reales y pruebas en dispositivos concretos.
