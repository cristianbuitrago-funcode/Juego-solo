# ECOS: El Mundo que Recuerda

Juego 2D de estrategia para **un jugador**, pensado para **teléfonos Android** en vertical.

Guías a una pequeña civilización en un mundo que funciona por sí mismo. No construyes bases, no recolectas oro ni madera, no produces soldados. La estrategia está en:

**información incompleta + memoria de personajes + consecuencias en cadena + experimentación + mundo autónomo + decisiones con efectos retardados.**

---

## Cómo se juega

> No quiero que el jugador vea el mundo. Quiero que el jugador viva en él.

Eres una persona dentro del mundo, siempre visible en pantalla. Caminas, corres, cruzas puentes, atraviesas fronteras, entras en pueblos, hablas con su gente y ves con tus propios ojos lo que tus decisiones provocan.

**EXPLORAR → OBSERVAR → DEDUCIR → DECIDIR → ESPERAR → VER CONSECUENCIAS → VOLVER A EXPLORAR**

1. **Explora.** Cada región es un terreno real con su bioma (bosques, montañas, campos, marismas, salinas…), su arquitectura y sus fronteras naturales: mojones, puestos fronterizos con banderas, cambios de vegetación. Al cruzar aparece discretamente «Has entrado en Ascaria».
2. **Observa.** Nadie te da cifras. Los mercados llenos o vacíos, los campos abandonados, las colas ante el almacén, los rebaños que desaparecen, los guardias nerviosos, las casas quemadas, los refugiados por los caminos… son la información.
3. **Habla.** Los vecinos tienen oficio, rutina diaria, edad, familia y memoria. Te reconocen («Pensé que no volverías»), recuerdan a tus antepasados y deciden cuánto contarte. Pueden callar, exagerar o mentir.
4. **Decide en el mundo.** En el almacén preparas caravanas que viajan de verdad por los caminos. En el salón del consejo envías emisarios, cambias leyes y atiendes a los mensajeros. Con los líderes tratas en persona (comercio, mediación, alianzas, presión, verdades y mentiras). En los puestos fronterizos se abren y cierran los caminos. En las posadas escuchas conversaciones y compruebas rumores.
5. **Formula hipótesis** al decidir: «Creo que la reserva de alimento de Ascaria aumentará en 3 días». Vuelve más tarde y compruébalo.
6. **El mundo sigue sin ti.** El tiempo corre (un día dura unos 6 minutos reales; puedes dormir en tu casa). Las regiones producen, comercian, inventan, se alían y entran en guerra; los vecinos nacen, envejecen, mueren y emigran.
7. **Generaciones.** Tu personaje envejece. Cuando muere, un hijo, una hija o un aprendiz toma el relevo y hereda casa, conocimiento, reputación y enemigos. La partida puede durar generaciones.

Mientras caminas surgen **encuentros** que no estaban escritos para ti: una disputa en el bosque, refugiados, un herido, soldados, un viajero con un rumor, una hoguera… Lo que hagas (o no hagas) puede escalar hasta convertirse en un conflicto entre pueblos.

### Controles táctiles

| Gesto | Acción |
| --- | --- |
| Arrastrar en la mitad izquierda | Joystick: caminar (más lejos para correr) |
| Tocar un punto / una persona / un edificio | Ir hasta allí (y hablar o entrar al llegar) |
| Pellizcar | Zoom de la cámara |
| Botón 🏃 | Correr |
| Botones de contexto | Hablar · Observar · Seguir · Entrar · Examinar · Viajar… |
| ☰ | Diario: mapa, crónica, hipótesis, investigación, consejo, objetivos, linaje, ajustes |
| Botón «atrás» de Android | Cierra el último diálogo o panel |

En el ordenador: flechas o WASD para caminar, Mayús para correr y rueda para el zoom.

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

El análisis del código previo y el diseño del mundo vivo están en [`docs/ANALISIS-Y-ARQUITECTURA.md`](docs/ANALISIS-Y-ARQUITECTURA.md).

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
├── world/                 El mundo explorable (lógica pura, probada con Vitest)
│   ├── terrain.ts         Terreno real por teselas desde la semilla (biomas por región, río)
│   ├── layout.ts          Pueblos, edificios, campos, caminos (A*), puentes, fronteras, lugares
│   ├── life.ts            Capa de vida persistente: pueblos que crecen/arden/se reconstruyen,
│   │                      vecinos que nacen/envejecen/mueren/emigran, generaciones del jugador
│   ├── folk.ts            Vecinos con memoria y disposición a ayudar
│   ├── routines.ts        Rutinas diarias según la hora y el estado de la región
│   ├── talk.ts            Conversaciones (reconocimiento, rumores, mentiras, historia oculta)
│   ├── encounters.ts      Encuentros que se descubren caminando y pueden escalar
│   ├── presence.ts        Observación en persona, lugares, posadas, templos
│   ├── clock.ts           Horas, estaciones, años, clima, día y noche
│   ├── path.ts · roadnet.ts  Colisiones, A* y red de caminos
│   └── index.ts           Conexión con el motor (sistema «vida» y caravanas)
├── render/                Dibujo 2D en canvas
│   ├── human.ts           Figura humana ilustrada: proporciones reales, rostro, 10 expresiones,
│   │                      vistas de frente/espalda/perfil, acciones y 3 niveles de detalle
│   ├── appearance.ts      Rasgos únicos + vestuario por región y clase social; aspecto del jugador
│   ├── mood.ts            Expresión y gesto a partir de memoria, emociones y estado de la región
│   ├── sprites.ts         Árboles, rocas, casas por cultura, edificios, mobiliario, animales, carros
│   ├── chunks.ts          Suelo fundido entre teselas con relieve + objetos estáticos
│   ├── gallery.ts         Galería de dirección artística (abrir con #galeria)
│   └── scene.ts           Cámara con zoom, proximidad y nivel de detalle, NPC, gentío, tráfico,
│                          luz del día, noche con luces cálidas, clima, entrada
├── ui/                    Interfaz (DOM)
│   ├── app.ts             Controlador: HUD mínimo, reloj del mundo, diario, modales
│   ├── world-dialogs.ts   Decisiones dentro del mundo (almacén, consejo, líderes, fronteras…)
│   ├── map/               Mapa del mundo (en el diario)
│   └── screens/           crónica, hipótesis, investigación, consejo, linaje, menú, ayuda…
├── audio/audio.ts         Música ambiental generativa (Web Audio) según el estado del mundo
├── styles.css
└── main.ts
android/                   Proyecto nativo Android (Capacitor)
tests/                     Pruebas del motor y del mundo explorable
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

## Estado del proyecto

**Versión 2 — el mundo vivo.** El juego pasó de ser un tablero de estrategia a un mundo explorable, sin perder la estrategia:

- Personaje controlable siempre en pantalla; cámara 2D cenital que le sigue, con zoom.
- Terreno real continuo, sin pantallas de carga entre regiones; cada región con su bioma y arquitectura.
- Pueblos con plaza, mercado, almacén, salón, posada, templo, forja, campos y animales; crecen de aldea a ciudad o se vacían.
- Vecinos con rutinas (campesinos, comerciantes, guardias, niños, pastores, ancianos, líderes…) y memoria propia.
- Consecuencias visibles: caravanas, refugiados, soldados en marcha, campamentos, barricadas, casas quemadas, reconstrucción, murallas, campos abandonados, mercados vacíos.
- Decisiones e hipótesis tomadas en el mundo; misterio con lugares que examinar; encuentros emergentes.
- Día y noche, estaciones, lluvia, niebla y nieve; generaciones del personaje; crónica por años.
- Simulación por proximidad para Android: solo lo cercano se mueve; lo lejano vive en la simulación abstracta.

**Versión 3 — revisión visual.** Mismas mecánicas, nueva dirección artística de RPG 2D ilustrado:

- Personas con proporciones humanas (cabeza ≈ 1/7 de la altura), rostro visible y único, y 10 expresiones que salen de lo que cada vecino ha vivido (gratitud, rencor, miedo, hambre, guerra) y de reacciones del momento (sorpresa, saludo, alivio).
- Vestuario por región (frío y pesado, de bosque, de costa, comercial y elegante, campesino) y por clase social (campesino, guardia, comerciante, artesano, líder con diadema y capa…).
- Animaciones: caminar, correr, trabajar, martillear, pescar, sentarse en los bancos, conversar entre ellos (uno habla, otro escucha y asiente), saludar, cruzar los brazos, mirar alrededor.
- Personaje del jugador personalizable (capa, jubón, pelo, barba, piel) en la pestaña Linaje; retratos en los diálogos.
- Cámara que se acerca al hablar con alguien y encuadra la conversación.
- Escala coherente: casas mucho más grandes que una persona, árboles altos, caballos mayores que la gente; pueblos con calles, fuente o pozo, bancos, faroles, almacenes, establos, graneros y carros.
- Luz por hora (mañana rosada, tarde dorada) y noches oscuras con ventanas, faroles y hogueras cálidas; tormentas con relámpagos, viento con hojas; la gente se refugia o se cubre con capucha y se abriga en invierno.
- Gentío en las ciudades grandes, pájaros, perros, patos y caballos; nivel de detalle por distancia y ajuste de calidad gráfica para Android.

El motor estratégico de la versión 1 (memoria, consecuencias en cadena, rumores, hipótesis, mundo autónomo, legado) se conserva entero y alimenta todo lo que se ve.

Pendiente: más contenido (oficios, encuentros, edificios especiales), afinar el equilibrio con partidas reales y probar en dispositivos Android concretos.
