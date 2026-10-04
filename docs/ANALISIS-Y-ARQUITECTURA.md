# ECOS · Análisis del código existente y arquitectura del mundo vivo

Este documento recoge el análisis previo a la transformación de ECOS: de juego de estrategia sobre un mapa a **mundo vivo explorable** en el que la estrategia sigue siendo el corazón.

> No quiero que el jugador vea el mundo. Quiero que el jugador viva en él.

---

## 1. Qué había (análisis)

| Sistema | Dónde | Cómo funciona | Conexiones | Veredicto |
| --- | --- | --- | --- | --- |
| **Días** | `core/simulation.ts` | `advanceDay(w)` ejecuta 15 sistemas en orden fijo y devuelve un informe. Fin de era en `eraLength`. | Todo el motor | **Reutilizar.** Ahora lo dispara el reloj del mundo al amanecer (06:00). La era pasa a ser opcional: el mundo puede durar generaciones. |
| **Decisiones** | `core/actions.ts` | Catálogo `ACTIONS` con `check`/`run`; las misiones ocupan emisarios y programan efectos. | Memoria, patrones, crónica, efectos | **Reutilizar entero.** Cambia *dónde* se toman: en el almacén, el salón del consejo, con los líderes, en los puestos fronterizos y en las posadas. La ayuda ahora viaja como caravana física y llega días después. |
| **Hipótesis** | `systems/hypotheses.ts`, `ui/screens/composer.ts` | Se capturan con línea base y se evalúan al vencer el plazo. | Crónica (revela causas ocultas), objetivos | **Reutilizar.** Se formulan en el momento de decidir, en el mundo. |
| **Investigación** | rumores, pistas, misterio, intel | Hechos imprecisos con fecha y fiabilidad; rumores ciertos/falsos/malentendidos; fragmentos del misterio. | Mapa, UI | **Reutilizar y ampliar.** Estar físicamente en un lugar ahora genera observación directa; las posadas permiten escuchar conversaciones y comprobar rumores en persona; los lugares descubiertos dan fragmentos. |
| **Regiones** | `types.ts` `Region` + `gen/mapgen.ts` | Voronoi deformado sobre una isla; recurso, cultura, población, alimento, ecología, militancia… | Todo | **Reutilizar.** `regionAt()` es función pura de la semilla: es la base del terreno real. |
| **NPC** | `systems/characters.ts` | Personajes con nombre, rol, emociones y recuerdos; hablan desde sus recuerdos. | Regiones, peticiones, misterio | **Reutilizar y ampliar.** Los personajes con nombre aparecen en el mundo; se añaden **vecinos** (campesinos, comerciantes, guardias, niños, pastores, artesanos, ancianos) con rutinas, edad, familia y memoria propia. |
| **Recursos** | `content/resources.ts`, `Player.reserves` | Sin oro ni madera: recursos que definen producción, fragilidad y comercio. | Economía, ecología | **Reutilizar.** Además definen el bioma visible (bosques, montañas, campos, costa). Se añade un inventario personal pequeño. |
| **Eventos** | sistemas + `chronicle.record` | Cada cambio crea una entrada con causa. | Cadenas de consecuencias | **Reutilizar.** Se añaden encuentros que se descubren caminando y cambios físicos (murallas, ruinas, reconstrucción) que también se registran con su causa. |
| **Relaciones** | `Relation`, `Attitude` | Opinión, tensión, agravios, alianzas, guerra. | Conflicto, rumores | **Reutilizar.** Ahora se ven: guardias en la frontera, barricadas, patrullas, campamentos. |
| **Crónica** | `chronicle.ts`, `screens/chronicle.ts` | Entradas conocidas por día; árbol de consecuencias con huecos. | Todo | **Reconstruir la vista**: historia por años y estaciones, por generaciones, con hitos ilustrados. El modelo se mantiene. |
| **Guardado** | `save.ts` | JSON del mundo (incluye estado del RNG). | — | **Ampliar.** El mundo explorable vive en `w.life` dentro del mismo JSON; las partidas antiguas se migran automáticamente. |
| **Generación** | `gen/worldgen.ts` | Culturas, recursos, personajes, rival, misterio, objetivos. | — | **Reutilizar.** El terreno, los pueblos, los caminos, los puentes, los puestos fronterizos y los lugares se generan de forma determinista a partir de la misma semilla. |
| **Interfaz** | `ui/` | Mapa como pantalla principal, barra de navegación, paneles. | — | **Reconstruir.** Exploración a pantalla completa con un HUD mínimo; el mapa pasa a ser un objeto del diario; los paneles estratégicos quedan como menús secundarios. |

**Conclusión:** el motor estratégico (`src/core`) es independiente del DOM y determinista. No hay que tirarlo: hay que **darle cuerpo**. Lo que se reconstruye es la *forma de experimentarlo*.

---

## 2. Arquitectura nueva

```
WORLD (src/world)
├── Terrain        terrain.ts     teselas reales generadas desde la semilla (agua, playa, prado, bosque, campos, roca, montaña, marisma, salinas)
├── Regions        core/          las regiones del motor; cada una con su bioma y arquitectura
├── Villages       layout.ts      pueblos con plaza, casas, mercado, almacén, salón, templo, forja, posada, campos
├── Cities         life.ts        un pueblo crece (aldea → pueblo → villa → ciudad) o decae según su población
├── Roads          layout.ts      caminos trazados con A* sobre el terreno, siguiendo las rutas comerciales
├── Rivers         terrain.ts     el río del motor, ahora agua real con puentes donde lo cruza un camino
├── Buildings      layout.ts      ranuras deterministas; life.ts decide cuáles existen, cuáles arden y cuáles se reconstruyen
├── NPCs           folk.ts        vecinos persistentes con edad, familia, rutina y memoria; personajes con nombre del motor
├── Animals        entities.ts    rebaños y fauna que crecen o desaparecen con la comida y la ecología
├── Resources      core/          + inventario personal (comida, hierbas, reliquias)
├── Events         encounters.ts  escenas que se descubren caminando y pueden escalar
├── Relationships  core/ + folk    relaciones entre pueblos y recuerdos personales
└── World History  core/chronicle la memoria causal del mundo

PLAYER (src/world/avatar.ts)
├── Movement       joystick, tocar para caminar, correr, seguir
├── Inventory      comida, hierbas, reliquias
├── Relationships  recuerdos que los vecinos guardan de ti (y de tus antepasados)
├── Reputation     actitudes de las regiones (core) + patrones aprendidos
├── Knowledge      intel del motor + zonas exploradas + lugares descubiertos
└── Family         edad, familia, herederos y linaje

SIMULATION
├── Time           clock.ts       reloj continuo; el motor avanza un día al amanecer
├── Economy        core/
├── Politics       core/
├── Population     core/ + folk   nacimientos, envejecimiento, muertes, migraciones
├── Conflicts      core/ + life   daños visibles, campamentos, reconstrucción
├── Weather        clock.ts       estaciones, lluvia, niebla, nieve (y el invierno largo)
├── Migration      core/ + folk   refugiados que caminan de verdad por los caminos
└── Consequences   core/effects   consecuencias retardadas (caravanas que llegan, engaños descubiertos…)

HISTORY
├── Events         core/chronicle
├── Memories       characters + folk
├── Generations    avatar.ts      sucesión del personaje del jugador
├── Hypotheses     core/
└── Chronicle      ui/screens/chronicle.ts  historia por años, estaciones y generaciones
```

### Simulación por proximidad (Android)

- **Cerca del jugador** (unas 40 teselas): los vecinos caminan, siguen su rutina y tienen físicas simples; aparecen animales, caravanas, soldados y refugiados.
- **Lejos**: los vecinos no se mueven; cuando vuelves, se colocan donde su rutina dice que deberían estar a esa hora. La conversión de lo abstracto a lo visible es automática.
- **Regiones lejanas**: solo existe la simulación abstracta del motor (`core/`), que es la fuente de verdad.
- El terreno se dibuja por **fragmentos cacheados** y los objetos solo se generan para la zona visible.

### Bucle de juego

**EXPLORAR → OBSERVAR → DEDUCIR → DECIDIR → ESPERAR → VER CONSECUENCIAS → VOLVER A EXPLORAR**

Cada decisión sigue pasando por `performAction` del motor, así que la memoria, los patrones, las consecuencias retardadas, las hipótesis y la crónica siguen funcionando igual. La diferencia es que ahora sus efectos son **visibles en el mundo**: mercados vacíos o llenos, caravanas por los caminos, casas quemadas, murallas nuevas, refugiados, guardias nerviosos y vecinos que te recuerdan.

---

## 3. Revisión visual (v3): análisis del render anterior

| Elemento | Antes | Problema | Solución |
| --- | --- | --- | --- |
| Personas | `sprites.person()`: sprite cacheado de 18×30 px, cabeza de radio 3,6 (≈ 1/3,7 de la altura), sin rostro, color según el rol | Muñecos cabezones e idénticos | `render/human.ts`: figura humana vectorial de 48 px (cabeza ≈ 1/7), rostro con ojos, cejas, nariz, boca, orejas, barba y arrugas; animación por esqueleto simple; vistas de frente, espalda y perfil |
| Apariencia | Rol → color | NPC clónicos | `render/appearance.ts`: rasgos únicos por persona (cara, piel, pelo, barba, edad, complexión) + vestuario por región (corte, materiales, accesorios, sombreros, capas, patrones) + clase social |
| Expresiones | No existían | — | 10 expresiones derivadas de memoria, emociones, estado de la región, conversación y reacciones recientes |
| Escala | Casa 32 px, árbol 34 px, persona 30 px | Casas del tamaño de una persona | Persona 48 px; casa 3–4 teselas (~80 px de alto); árboles 80–100 px; caballos > personas; pueblos más amplios con calles |
| Suelo | Cuadrados de color por tesela | Cuadrícula visible | Mezcla bilineal entre teselas + ruido + relieve (sombreado por elevación) |
| Cámara | Zoom fijo del usuario | No se aprecian caras | Zoom suave al acercarse a alguien y primer plano en las conversaciones |
| Iluminación | Oscuridad nocturna con huecos | Plana | Gradación de color por hora (mañana, mediodía, tarde, noche), luces cálidas aditivas, faroles, ventanas, hogueras |
| Clima | Lluvia, nieve, niebla | La gente no reacciona | Tormentas y viento; con lluvia la gente se refugia o se cubre; con nieve se abriga |
| Rendimiento | Sprites cacheados para todo | — | Personas vectoriales con niveles de detalle (cercano / medio / lejano); edificios, árboles y suelo cacheados |

El resto de la arquitectura (motor, capa de vida, rutinas, interacción) no cambia: la revisión visual reutiliza `WorldScene`, `ChunkCache`, `Layout` y las rutinas existentes.

### Cómo se conectan las piezas

- `appearanceOf(w, folk)` se calcula una vez por vecino y se cachea en la escena (se regenera al cambiar de etapa de la vida). Los figurantes (soldados, refugiados, mensajeros, gentío) usan la misma función con un vecino sintético, así que visten como su región.
- `moodOf(w, folk)` lee solo datos que ya existían (`trust`, `fear`, `gratitude`, `resentment`, `memories`, banderas de la región). `actionOf(actividad)` traduce la actividad de la rutina a un gesto.
- `WorldScene.social()` (cada 0,3 s) orienta a cada vecino: hacia el jugador si está cerca (con sorpresa, saludo u hostilidad según la relación) o hacia quien tiene al lado si está charlando; las parejas se turnan para hablar y escuchar.
- `WorldScene.converse(id)` lo llama el diálogo de conversación: la cámara pasa a primer plano (`ZOOM.talk`) y encuadra a ambos por encima de la hoja del diálogo. Al cerrarse el diálogo, la escena vuelve sola al zoom de exploración.
- Las luces nocturnas se recogen mientras se preparan los dibujables (ventanas encendidas, faroles de `Village.lamps`, hogueras, forjas, puestos fronterizos, tu farol) y se aplican en dos pasadas: huecos en la capa de oscuridad y halo cálido aditivo.
- Clima: `weatherOf` añade `tormenta` y `viento`. Las rutinas mandan a casa a quien estaba de ocio al aire libre si llueve; la escena viste con capa y capucha a quien sigue fuera (`dress()`), y con piel en invierno.
- Rendimiento: tres niveles de detalle por distancia (y por zoom); calidad gráfica `alta` / `media` / `baja` (resolución del lienzo, gentío, pájaros).
