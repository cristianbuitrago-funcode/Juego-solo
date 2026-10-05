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


## 4. Pixel art (v4)

Dirección artística: RPG de pixel art de alta calidad (referencias de estilo y referencias generadas para el proyecto), con universo propio. Jerarquía: jugabilidad intacta → identidad del mundo → lenguaje visual de las referencias → adaptación a cada cultura → nada copiado.

| Pieza | Cómo se consigue la coherencia |
| --- | --- |
| Rejilla única | `WorldScene` dibuja el mundo en un lienzo intermedio a 1 píxel de arte por píxel de mundo y lo amplía con vecino más próximo. Las capas de luz, clima e interfaz van encima, a resolución de pantalla. |
| `render/pixel.ts` | `Painter` (píxeles enteros, óvalos, polígonos, líneas), `tone()` (sombras hacia violeta, luces hacia amarillo), `vivid()`, contorno teñido y `pixelize()`, que convierte cualquier dibujo vectorial en pixel art (paleta de colores sólidos del propio dibujo, alfa todo o nada, sombras planas, contorno). |
| Sprites (`sprites.ts`) | Árboles, edificios, mobiliario y animales se dibujan una vez a 1:1 y pasan por `pixelize`. `makeK` reduce diseños para mantener la escala con las personas. |
| Personas (`human.ts`) | Muñeco por capas en píxeles: piernas y calzado, falda o túnica, torso con estampado, chaleco, mandil, sobreveste, cinturón, fajín, bandolera, bolsa, joyas, capa, brazos por acción, cabeza, pelo (9 estilos), cara (10 expresiones), barba (5), sombreros (11) y objetos (12). Caché por aspecto y postura. Misma API que antes (`drawHuman`, `drawPortrait`). |
| Suelo (`chunks.ts`) | Cada píxel pertenece a una tesela desplazada con ruido (bordes dentados y orgánicos), con textura por material y relieve en escalones de luz. |
| Pueblos | Las casas solo tienen un sendero corto ante la puerta: el pueblo es verde con calles principales. |
| Clima y fuego (`fx.ts`) | `WeatherFx` dibuja gotas (trazos diagonales con punta clara y salpicadura de tres fotogramas), copos (1–3 px), hojas y ráfagas en el lienzo del mundo; en la pantalla solo quedan el tono del cielo, la niebla y el relámpago. Hogueras y faroles son sprites de píxeles con 4 y 3 fotogramas; el humo son discos pixelados. La hoguera de la plaza busca el hueco más despejado. |
| Montañas | `peak()` genera cada montaña píxel a píxel (seis variantes): una o dos cumbres, arista que separa la cara iluminada de la sombra violácea, estratos, grietas, nieve con borde dentado y pinos diminutos que dan escala. |


## 5. Despertar sin memoria (v5)

**Problema del prototipo:** el jugador empezaba gobernando (provisiones, emisarios, leyes, peticiones, diplomacia) desde el primer minuto. **Cambio:** empieza como una persona sin memoria y sin autoridad; el poder se construye.

| Pieza | Diseño |
| --- | --- |
| Autoridad en el motor | `Player.authority` (0 forastero … 6 líder). `ACTION_LEVEL` fija el nivel que necesita cada acción y `performAction` la rechaza si no se tiene («Nadie actuaría por orden tuya…»). Las peticiones solo llegan con nivel ≥ 4. Sin definir = partidas antiguas (gobierna). |
| `world/identity.ts` | Habilidades (11) y conocimientos (9) con experiencia y niveles; se descubren al usarlos. Aptitudes latentes del pasado que despiertan de golpe. Talentos únicos por combinaciones. Hambre, cansancio y monedas. Reputación por región (lo ganado + lo que recuerdan los vecinos) → reconocimiento 0–6; los cargos ≥ 4 se ofrecen y se aceptan o rechazan; el consejo exige haber ayudado en una crisis. Fragmentos de memoria con desencadenantes (colgante, edificio según el oficio pasado, canción en la posada, sueño, llegar a su tierra, alguien que le reconoce, la verdad) y decisiones. Crónica personal y vidas anteriores. |
| `world/livelihood.ts` | Trabajar con cada oficio (tiempo, paga, aprendizaje, memoria del vecino, reputación), preguntar por uno mismo, convencer, mentir, comer, dormir, comprar, vender, pedir, buscar comida, estudiar (templo, posada, salón, mercado), escuchar tras la puerta, atender una fiebre, aprendizaje en encuentros y al explorar. |
| Vida y generaciones | `createLife` despierta al personaje a las afueras, sin familia ni provisiones; elige su pasado (oficio, tierra de origen, nombre verdadero, un hecho bueno o terrible y alguien que le conoció). Los hijos solo llegan si ha echado raíces. El heredero tiene carácter y habilidades propias y puede honrar o rechazar el legado. |
| Interfaz | Escena de despertar sin explicaciones; HUD con monedas, mochila, hambre y cansancio; botón ✋ (comer, buscar comida, descansar, dormir al raso, mirar el colgante); diario que se amplía con el cargo; pantalla «Quién soy»; crónica «Tu historia»; edificios y conversaciones que cambian según quién eres en cada pueblo. |

## 6. Fase 1: el prólogo jugable

**Objetivo:** que los primeros 10–20 minutos demuestren exploración + mundo vivo + memoria + aprendizaje + decisiones + consecuencias + misterio, sin misión lineal ni tutorial.

| Pieza | Diseño |
| --- | --- |
| Estado (`life.prologue`) | Solo en partidas nuevas (`setupPrologue` desde `createLife`). Guarda los lugares (despertar, mochila, cabaña, camino, caja, acequia), los vecinos con papel (primera persona, posadera, comerciante, crío, artesano, dos vecinos), el estado de cada situación, efectos pendientes por día y un registro del día para el resumen. |
| Despertar | `wakeSpot` puntúa candidatos: prado verde, sin casas cerca, a una caminata del pueblo y con camino transitable hasta él. La cabaña se coloca en un hueco libre y bloquea sus casillas. |
| Rutinas | `prologueRoutine` adelanta a la rutina normal solo en sus momentos: la primera persona recoge leña en el camino la mañana del día 1; la posadera atiende la puerta; el comerciante busca su caja; los vecinos discuten junto a la acequia. |
| Escenas | `prologueScene` / `prologueChoose`: un pequeño motor de escenas (líneas, opciones, retrato, recuerdo borroso, carta con emblema). Si no hay escena, el juego sigue con la conversación normal. |
| Tiempo | `prologueTick` (llegada al pueblo, la caja a media mañana, la acequia el día 2, el aviso de la noche, la pista final) y `prologueDawn` (consecuencias al amanecer, algunas encadenadas varios días). Los encuentros al azar se silencian los dos primeros días. |
| Interfaz | Objetivo suave bajo el reloj, objetos interactuables en el mundo (`Target` `item`), recuerdo en pantalla oscura y borrosa, tarjeta «Día N» con resumen al dormir, pajar gratuito si te lo has ganado, carta con el símbolo del colgante en pixel art. |

## 7. Fase 2: NPC y mundo vivo

**Análisis previo.** Los vecinos (`Folk`) ya existían: se crean en `folk.populate`, se guardan en `life.folk`, tienen rutina por oficio y hora (`routines.ts`), se mueven en la escena por proximidad (`scene.ts`, `updateLod`), recuerdan al jugador (`memories`, 8 como máximo) y envejecen, nacen, mueren y emigran en `life.dailyLife`. El tiempo es un reloj continuo (`life.clock`, 6 minutos reales por día) y cada amanecer el motor ejecuta sus sistemas y después `dailyLife`. Todo se guarda como JSON. Faltaba que los vecinos tuvieran vida entre ellos. **Se amplía sin sustituir:** `Folk` gana `gender` y `p` (persona); `Life` gana `society`.

| Pieza | Diseño |
| --- | --- |
| `society.ts` | `Persona` (rasgos 0–100, necesidades 0–1, emociones, dinero, objetivos, gustos, recuerdos `Mem` con intensidad, acontecimientos, oficios, planes del día, enfermedad, luto, viaje). `Tie` entre dos vecinos (parentesco, afecto −100..100, trato 0..100, compañeros). Índices en memoria para que sea rápido. `ensurePeople` crea personas y teje familias y amistades (también en partidas antiguas). `fadeMemories` aplica el olvido. El género coincide con el dibujo y ya no cambia al cambiar de oficio. |
| `social.ts` | `societyDay` (cada amanecer, dentro de `dailyLife`): economía → necesidades → emociones → trato → olvido → objetivos → acontecimientos → rumores → conflictos → planes de hoy → acercamientos. Detalle por distancia. `socialOverride` y `routineMood` cambian las rutinas. Muertes (luto, herencia, funeral), nacimientos (padres y hermanos) y mayoría de edad (oficio familiar o el que pide el carácter). Avisos en vivo y «mientras no estabas». |
| `economy.ts` | `Market` por región: inventario y precio de comida, herramientas, mineral y madera; producción por oficio con estación, clima, estado del motor y malas cosechas; consumo por casas con dinero compartido; importación y exportación por comerciantes. `priceOf` y la compra del jugador usan este mercado. |
| `gossip.ts` | `SRumor` con versiones de menor a mayor exageración y quién cree cuál; se difunde por los lazos según lo sociable y honrado de cada uno. `chatter` (líneas propias en la conversación), `opinionOf`, `overheard` (frases al pasar) y lo que el jugador va sabiendo de cada vecino. |
| `arcs.ts` | `Arc`: deuda, clientes o linde, con verdad oculta y dos versiones; etapas (discusión, versiones, consecuencia y cambio de oficio, el pueblo toma partido, las familias, desenlace) y «calor» que sube con el orgullo y baja con la amabilidad, los amigos comunes o la mediación. Intervención del jugador sin respuesta correcta. |
| Integración | `routines.ts` (planes, tormenta, guerra, mercado vacío, pereza, horas extra, adolescentes, oficios nuevos: posadero, minero, carpintero), `talk.ts` (conversación y observación), `mood.ts` (expresión desde la emoción), `scene.ts` (frases al pasar, vecinos que vienen a buscarte), `app.ts` (avisos, acercamientos, puesta al día), `world-dialogs.ts` (pleitos, preguntar por alguien, responder a quien se acerca), `family.ts` («Gente que conoces»). |
| Preparado para la Fase 3 | Bienes y precios por región, importación/exportación según caminos y guerra, migraciones que cambian la población del motor, oficios con historial, ingresos y gasto por persona. |

## 8. Fase 3: simulación del mundo

**Análisis previo.** El motor (`core/systems/economy.ts`) llevaba la comida como «días de reserva» por región, el comercio como tráfico de rutas y la población como un número; la Fase 2 añadió un mercado local con cuatro bienes. No había bienes concretos, dinero que circulara, cosechas, caravanas reales ni vivienda. **Se amplía sin sustituir:** con `w.sim.worldEconomy` el motor deja de calcular comida y población por su cuenta (sigue con tráfico, banderas de comercio, hambre, conflictos, rumores…) y la economía de cada pueblo es la que manda; un **puente** traduce en cada sentido (los cambios del motor —ayudas, saqueos, caravanas del gobernante— entran como cambios del mercado; el mercado devuelve `food`/`reserves`).

| Pieza | Diseño |
| --- | --- |
| `economy.ts` | 17 bienes con precio de referencia, peso y tipo. `Market` por región: inventario, precio, demanda con inercia, caja del comercio, arcas, salarios reales por oficio, noticias de otros mercados, prosperidad e historial. `economyDayFull`: producción por oficio (con esfuerzo, herramientas, tierra, agua, bosque, montaña), campo, semilla, consumo por hogares según su riqueza, ocio, sueldos públicos, margen y quiebra de comerciantes, reinversión, precios por días de existencias. |
| `farming.ts` | `Farm` (fertilidad, humedad, semilla, tierra, sembrado, crecimiento, cosecha e historial) y `Climate` (sequías por comarca). Ciclo anual por estaciones; lluvia diaria por valle; daños con causa. |
| `trade.ts` | `Convoy` (dueño, origen, destino, carga, salida, llegada, estado). `bestDeal` con lo que se sabe de otros mercados; transporte = peso × distancia; riesgo por guerra, bandidos e inestabilidad; retrasos por tiempo y caminos cortados; volumen por par de pueblos (para la diplomacia de la Fase 4). |
| `population.ts` | Atracción de cada pueblo; nacimientos y muertes; flujos de migración por camino abierto (con familias con nombre y motivo), regresos, llegadas; cambio de oficio por salario. |
| `business.ts` | Carga y vehículo, compraventa con efecto inmediato en el precio, donaciones, negocios (`puesto`, `granja`, `transporte`; `taller`, `herreria`, `posada` preparados), contratación con sueldo diario, encargos, rastro de grandes compras para que el mundo «responda». |
| Lo visible | `marketview.ts` (puestos con la mercancía real, descripción sin cifras), `scene.ts` (carretas de verdad, restos de asaltos), `ui/market.ts` (mercado, comprar, vender, preguntar precios, encargos, negocios, carreteros), cuaderno de precios y negocios en «Quién soy», puesta al día al volver (`social.catchUp`). |
| Rendimiento | Todo se calcula una vez al día por pueblo (y las caravanas cada hora de juego); el detalle social depende de la distancia al jugador. Unos 5 ms por día simulado. |
| Preparado para la Fase 4 | Arcas e ingresos por tasa (impuestos), volumen comercial entre pueblos (dependencia, diplomacia), rutas y riesgo (conflictos), producción especializada por región (recursos estratégicos), migraciones y prosperidad (estabilidad e influencia). |

## 9. Fase 4: estrategia, política, influencia y consecuencias

**Análisis previo.** El motor tenía relaciones entre regiones (opinión, agravio, tensión, alianza, guerra), militancia, estabilidad, guerras abstractas (`conflict.ts`: población × militancia × técnica, diez días y tributo), tres leyes del hogar (`player.laws`), peticiones y una autoridad del jugador derivada de su reconocimiento (`identity.standing`, cargos 4–6 por ofertas). La Fase 3 dejó arcas e ingresos por tasa, volumen comercial entre pueblos, rutas con riesgo y prosperidad. No había grupos sociales, leyes con efecto económico, formas de gobierno distintas, votaciones, protestas, tratados negociados, secretos ni ejércitos con suministro. **Se amplía sin sustituir:** con `w.sim.worldPolitics` el motor sigue decidiendo cuándo la tensión desemboca en guerra (y respeta los tratados de paz), pero la guerra se libra en la capa del mundo; las leyes escriben `Market.law` cada día y la economía, el comercio y la población las leen.

| Pieza | Diseño |
| --- | --- |
| `polstate.ts` | Todo el estado en `life.politics` (JSON): `Gov` por región (sistema, quien gobierna, consejo, legitimidad, represión, leyes, elecciones, consejo del jugador), `Org` (tipo, miembros, líder, fondos, peso, enfado, queja, objetivo, acción colectiva, relación con el jugador: reputación, rango, encargos, expulsión), `Proposal` (presión por votante, quién ha hablado con el jugador), `Rebellion`, `Treaty`, `DipRole`, `Federation`, `Secret` (con testimonios verdaderos o falsos), `War`/`Army`/`Battle`, territorios (`owner`), disputas, granero, acaparamientos, favores, promesas, consecuencias retardadas, decisiones por escala, legado e hipótesis. |
| `politics.ts` | Gobiernos iniciales según la cultura; `councilOf` y `votersOf` por sistema (representantes de grupos, consejeros con el peso del gobernante, todo el pueblo, familias por riqueza, guardia); `leanOf` (intereses del grupo + necesidades + carácter + quién propone + presión + consejo del jugador) y `tally`; `lobby` (razones, promesas, favores, información, chantaje, soborno); `setLaw` con consecuencias que se comprueban a los 6 y 18 días; elecciones (`candidateScore`), sucesión, `changeGov`; la cadena de rebelión en cinco eslabones; legitimidad que mueve la estabilidad del motor. |
| `orgs.ts` | Grupos creados desde los oficios y la riqueza; intereses por ley con ajustes por la situación (hambre, bandidos, arcas vacías, guerra, tierra degradada); enfado por leyes contrarias, penurias, represión y peticiones rechazadas; protestas, huelgas (`Persona.strike` → no trabajan), boicots (no salen caravanas), motines (asaltan el almacén), desobediencia; respuesta del gobierno; encargos, ingreso, representación, expulsión y fundación de grupos. |
| `influence.ts` | Seis poderes calculados desde los sistemas (cargos y asientos; dinero, carga y negocios; gente que te aprecia; guardia, combate y batallas; secretos, aciertos y saberes; tratados, cargos y pueblos que te conocen) y el nivel 0–5. |
| `diplomacy.ts` | Postura entre pueblos derivada de la relación; relaciones del pueblo del jugador (el motor no las movía); tratados con efectos diarios (aranceles, intercambio de excedentes, tributos, tregua, alianza) que se rompen si la relación se pudre; tratados y disputas que surgen solos; guerra contra el pueblo del jugador por hambre, agravios o tierras; `negotiate` por intereses, reputación, cargo, saber, carácter, oferta e información; ofertas de emisario, diplomático y consejero; federaciones. |
| `intrigue.ts` | Secretos que salen del estado real (granero vacío que se calla, acaparamiento que de verdad retira comida del mercado, legitimidad baja, corrupción que de verdad sale de las arcas, pasos secretos que reducen el riesgo, conspiraciones, ejércitos sin comida); `pry` (los poco honrados y los implicados mienten), `readDocuments`, `readMarket`, comparación de versiones; `useSecret` con efectos reales. |
| `war.ts` | Ejércitos por región (guardia + milicia), suministro sacado del mercado y llevado al frente según el transporte, armas, cansancio, ánimo, mando, información; terreno del frente (`nearTiles`: bosque, montaña, río, murallas); batallas cada pocos días con muertos con nombre, casas quemadas, ocupación (saqueo, refugiados, cambio de dueño del territorio, tributo, resistencia e independencia); fin por derrota, hambre, agotamiento o paz mediada; reconstrucción con materiales. Acciones del jugador: alistarse, abastecer, espiar, mediar, ayudar a refugiados. |
| `forecast.ts` | Hipótesis sobre variables del mundo vivo con plazo; acierto, fallo, parcial o inesperado (si entre medias hubo guerra, levantamiento, cambio de gobierno, motín…). |
| Lo visible | `poltalk.ts` (cada vecino cuenta qué votará, las quejas de su grupo, lo que sabe si se fía, la guerra, la oposición; la posada da el pulso de las votaciones), protestas en la plaza (planes del día), «mientras no estabas» con leyes, elecciones, protestas y batallas, `ui/politics.ts` (salón: gobierno, leyes, propuestas, grupos, vecinos, cuentas, fundar, la guerra; conversación: votación, grupo, quien gobierna, sonsacar, oposición; negociación con contraofertas; Quién soy: influencia, grupos, cargos, lo que sabes, hipótesis, legado), ficha de región (gobierno, leyes notables, vecinos, guerra) y mapa con capas (`MapView.layer`). |
| Rendimiento | La política se calcula una vez al día (≈1,5 ms de los ≈9 ms de un día simulado en 9 pueblos). |
| Preparado para la Fase 5 | `legacy.ts`: `inheritance()` reúne propiedad, reputación por grupo y por pueblo, conocimiento (secretos, cuaderno de precios, aciertos) e historia (`LegacyRec` con autor y generación). Las leyes, tratados y grupos fundados viven en el mundo, no en el personaje. |

## 10. Fase 5: generaciones, muerte, herencia y legado

**Análisis previo.** Ya existía un relevo sencillo: el avatar tenía edad, una familia abstracta (`Kin`: nombres sin vecino), un riesgo de muerte por edad a partir de los 58, `pendingDeath`, un diálogo de sucesión con «honrar o seguir tu camino», el linaje (`Ancestor`) y una identidad heredada (`heirIdentity`). Los vecinos ya envejecían, nacían, elegían oficio a los 15 y morían; los muertos con nombre se guardaban sin límite, igual que el registro del motor. **Se amplía sin sustituir:** la familia pasa a ser gente del mundo (`Kin.folkId`), la muerte del forastero la decide su salud, la sucesión convierte a un vecino en protagonista, y todo lo importante se archiva. Las partidas antiguas en modo «gobernante» conservan su sistema.

| Pieza | Diseño |
| --- | --- |
| `genstate.ts` | Estado en `life.gens` (JSON): lazos del protagonista (`Bond`: amistad, pareja, hijo, aprendiz, rival…, cariño, lecciones, generación), salud (`Health` con condiciones y causa), objetos (`Heirloom` con dueños y hazañas), testamento (`Will`), disputas, deudas, dinastía (nombre, fama, miembros, poder por generación), archivo (`HistEvent`), casas del mundo (`House`), marcas de archivado y `scale` (tope del archivo, número de regiones) para la Fase 6. `Folk` gana `learned`, `died` y `houseId`; `Avatar`, `death` y `origin`; `Ancestor`, `fem`, `age` y `chronicle`. |
| `generations.ts` | `stageOf` y `vigorOf` (cuerpo, mente, aprendizaje, enseñanza, peso social; continuos) → `Identity.vigor`, que leen `gain`, `chanceOf`, `tickNeeds` y `speedFactor`. `healthDay`: hambre, agotamiento, fiebre del pueblo, achaques, heridas (`injure`), curas con medicinas y descanso, incapacidad y riesgo de muerte compuesto (edad × salud + condiciones) → `die(causa)`. Familia: `talkedWith` (cariño según compatibilidad), `court`, `proposeUnion` (la pareja anterior pasa a expareja; anillo), `talkChildren`, `familyYear`/`birthChild` (hijo vecino con rasgos mezclados), `adopt`, `takeApprentice`. Enseñanza: `teach` (según lo que sabe quien enseña, su edad, la curiosidad y edad de quien aprende) y `shareSecret`. Vecinos: `inheritTraits`, `educate` (oficio de los padres y lo que ellos aprendieron), `generationalLine`, `ancestorRel`, `pruneDead` (muertos de hace 25 años y registro del motor). |
| `estate.ts` | Objetos (`createHeirloom`: colgante, espada, anillo, llave; `heirloomDeed`, `passHeirloom`, `recognizeHeirloom`), bienes y testamento (`assetsOf`, `setWill`), reparto (`settleEstate`: testamento o ley de propiedad, negocios a vecinos o grupos, deudas de sueldos, disputas de hermanos ambiciosos), `resolveDispute` (repartir, ceder, juicio según la ley), `payDebt`, `estateDay` (deudas vencidas, disputas que se pudren), fama familiar (`addFame`, `fameOf`, `familyTalk`). |
| `succession.ts` | `successorsOf` (hijos —también menores—, pareja, aprendices, hermanos, amistades, socios, compañeros de grupo, alguien a quien inspiró; nunca vacío), `lifeChronicle` y `titleOf` (desde lo que pasó), `succeedTo`: crónica, linaje, dinastía, archivo, funeral, reparto, limpieza de cargos, años de espera (`skipDays` con el motor de verdad), y el relevo: el vecino sale del mundo y pasa a ser el avatar con su familia, sus lazos, lo que aprendió, su carácter (`temper` desde sus rasgos) y la actitud de los demás recalculada desde su propio trato y la memoria de la familia. `generationsDay` ordena el día (salud, herencias, archivo) y el año (historia, casas, familia, poda). |
| `history.ts` | `recordHist` con tope y olvido de lo menos recordado; `archiveDay` desde el registro del motor (solo importancia 3 o del jugador), la política (guerras, tratados, gobiernos, rebeliones, fronteras) y el legado; `tellingOf`/`retell`/`hedge`/`told` (hecho, recuerdo, leyenda, mito, olvido; plantillas por tipo); `historyYear` (fama, monumentos y fiestas); `legendFor` (los viejos), `templeRecords`, `timeline`, `worldChronicle`; `housesYear` (casas por parentesco, poder relativo, ascenso, caída, extinción). |
| Lo visible | `talk.ts` (te reconocen, recuerdan a tus antepasados, comentan la fama familiar y reconocen objetos; los viejos cuentan leyendas), `appearance.ts` (envejecimiento gradual del avatar), `ui/generations.ts` (pantalla «Tu historia continúa», candidatos con lo que heredan y lo que les pesa, «Pasan los años…», testamento, dejar pasar una estación o un año, familia, disputas y deudas, opciones de conversación para cortejar, casarse, hijos, enseñar, aprendices, acoger; registros del templo; secciones de Quién soy; pestaña «Historia» en la crónica). |
| Rendimiento | La salud y las herencias se calculan una vez al día; la historia y las casas, una vez al año. La prueba de ocho generaciones mantiene menos de 900 vecinos guardados y menos de 1500 entradas del motor. |
| Preparado para la Fase 6 | El archivo y las casas van por región; `gens.scale` fija el tope del archivo y el número de regiones; la simulación generacional no depende del tamaño del mapa. |
