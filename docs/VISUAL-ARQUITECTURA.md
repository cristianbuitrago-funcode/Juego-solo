# ECOS — Reconstrucción visual: análisis y arquitectura

## 1. Lo que había (renderer v4, «pixel art»)

| Archivo | Responsabilidad | Qué se conserva |
| --- | --- | --- |
| `render/scene.ts` (≈1.900 líneas) | Escena explorable: cámara, entrada (joystick, tocar, pellizcar, teclado), movimiento del jugador, materialización de vecinos cercanos (LOD por distancia), animales, pájaros, partículas, orden en profundidad, pueblos/puestos/caravanas/refugiados/soldados, luces nocturnas, gradación, clima, etiquetas, flechas. Pinta en un búfer de **1 píxel de arte = 1 píxel de mundo** y lo amplía **sin suavizado**. | Toda la lógica de escena, entrada, cámara, LOD de entidades, rutinas y lectura del estado del mundo. Se sustituye el «cómo se pinta». |
| `render/human.ts` (≈1.450) | Personas en una rejilla de píxeles (`Painter`), fotogramas en caché por aspecto y postura; caras con 10 expresiones; retratos 48×48. | Los tipos `Pose`, `Expr`, `Action`, `Facing` (contrato entre escena y figura). |
| `render/appearance.ts` (≈400) | **Datos** de apariencia: rasgos individuales, vestuario por región y oficio, jugador personalizable. | Se conserva íntegro (es representación de entidad, no píxeles) y se amplía. |
| `render/mood.ts` | Del estado del vecino a la expresión y la acción del cuerpo. | Se conserva y se amplía (cansancio, confianza, clima). |
| `render/sprites.ts` (≈1.350) | Árboles, rocas, edificios por cultura, mobiliario, animales, carros… dibujados con formas vectoriales y luego **pixelizados** (`pixelize`). | Las formas de diseño se reaprovechan como base; se elimina la pixelización y se repintan con materiales. |
| `render/chunks.ts` | Suelo por fragmentos de 24×24 teselas pintado píxel a píxel con ruido y paletas planas; objetos estáticos (árboles, rocas, picos). | La partición en fragmentos, la caché y la colocación de objetos. Se repinta el suelo. |
| `render/pixel.ts` | Paleta y `Painter` de rejilla de píxeles, `pixelize`. | Solo las utilidades de color. |
| `render/fx.ts` | Fuego, llamas, humo y clima en píxeles enteros. | Se reemplaza por efectos a resolución nativa. |
| `ui/*`, `styles.css` | HUD, diario, diálogos, mapa estratégico (lienzo propio). | Estructura y flujo; se renueva la piel visual. |

**Simulación separada.** `core/` y `world/` no importan nada de `render/` ni de `ui/` (comprobado): la economía, la política, las generaciones, la memoria, los rumores y el guardado no dependen del aspecto. El guardado no contiene nada visual (el terreno se regenera desde la semilla).

## 2. Limitaciones encontradas

1. **Resolución**: el búfer 1:1 ampliado ×4–×6 sin suavizado impone el aspecto pixelado a todo, por mucho que se mejore el dibujo.
2. **Escala en pantalla**: con el zoom de exploración ×2 una persona ocupa ≈60 px CSS (≈1/14 de la pantalla) y su cara ≈10 px: las expresiones no se leen.
3. **Personas por fotogramas**: cada combinación aspecto × postura × fotograma se pinta y se guarda entera; la animación tiene pocos fotogramas y los miembros no giran (rigidez de «sprite»).
4. **Materiales**: colores planos de 3–4 tonos por material, sin degradados, sin volumen ni oclusión; el suelo es ruido por píxel.
5. **Luz**: una capa de oscuridad con huecos; no hay sol con dirección ni sombras proyectadas; la gradación horaria es un tinte global.
6. **Clima**: gotas y copos de 1 píxel de mundo (enormes al ampliar).

## 3. ¿Canvas 2D o WebGL?

Se valoraron WebGL directo, Three.js, Babylon.js, Phaser 3 (WebGL) y un renderer híbrido.

- El cuello de botella **no es la API**: es la tubería de arte (resolución y pintura). Cambiar a Phaser o Three.js obligaría a reescribir ≈6.000 líneas de escena, entrada, procedimientos de dibujo y UI de lienzo sin que, por sí solo, el arte mejore.
- Canvas 2D en el WebView de Android (Chromium) está **acelerado por GPU**: `drawImage` de texturas en caché con transformaciones es barato. Una escena típica de ECOS son 300–700 llamadas `drawImage` por fotograma.
- Lo que Canvas 2D **no** hace bien: iluminación por píxel con mapas de normales, cientos de luces dinámicas y postprocesos de pantalla completa (bloom, desenfoque) a 60 fps en gama media. Eso se **aproxima**: velos de color con mezcla normal y luces sumadas (`lighter`), sombras proyectadas como siluetas en caché deformadas con una transformación afín, y gradación por capas.
- Tamaño: Three.js/Babylon añaden 150–600 KB y otra forma de pensar la escena; Phaser, ≈1 MB. ECOS no necesita 3D.

**Decisión**: renderer **Canvas 2D a resolución nativa** con arte **pintado** (vectorial con degradados, pintado una vez en texturas en caché a la resolución que pide cada nivel gráfico) y **personajes con esqueleto 2D por piezas** (animación de recortes al estilo de las herramientas de animación 2D profesionales). Si en dispositivos reales hiciera falta más (luz por píxel, postproceso), el paso natural sería un compositor WebGL solo para la capa de luz; hoy no está hecho ni hace falta. No se cambia de tecnología por moda.

## 4. Arquitectura nueva (tal como está en el código)

```
SIMULACIÓN (core/, world/)            ← sin cambios de lógica; no importa nada visual
   ↓  estado del mundo (WorldState, Life, Folk, Town, Market…)
DATOS → REPRESENTACIÓN (render/appearance.ts, render/mood.ts, scene.houseState/entPose)
   apariencia (cuerpo, edad, ropa por oficio/región/clima), expresión, acción, estado de edificios
   ↓
PINTURA EN CACHÉ (visual/paint.ts → tex(): texturas con presupuesto de memoria y LRU)
   visual/figure/*  personas por piezas        visual/env/*  suelo, flora, edificios, objetos,
                                                             estructuras, interiores
   ↓
COMPOSICIÓN (render/scene.ts, render/chunks.ts)
   cámara, culling por fragmentos y vista, LOD, orden en profundidad (pasada de suelo →
   sombras → objetos), clima (visual/weather.ts), etiquetas
   ├─ render/lighting.ts   noche (oscuridad con huecos, halos a media resolución, reflejos,
   │                       núcleos) y gradación por franjas; recibe luces, cámara y tamaño
   ├─ render/furniture.ts  colisión fina del jugador con el mobiliario y carácter de cada plaza
   ├─ render/traffic.ts    puestos fronterizos (guardias, bandos en guerra) y tráfico de caminos
   ├─ render/overlay.ts    marcas de destino y foco, nombres, bocadillos, flechas de borde
   ├─ render/village.ts    casas por estado, edificios, mobiliario, plaza, faroles, puestos, empalizada, hoguera
   ├─ render/animals.ts    rebaños, caballos, perros y patos de los pueblos cercanos (aparición y paseo)
   ├─ render/birds.ts      bandadas de pájaros con su sombra en el suelo
   ├─ render/poses.ts      LOD por distancia, ropa según el tiempo, aspecto en caché y postura de cada persona
   └─ render/wet.ts        suelo mojado: tierra oscurecida, charcos con reflejo y ondas de lluvia
```

| Módulo | Qué hace |
| --- | --- |
| `visual/quality.ts` | Niveles LOW/MEDIUM/HIGH/ULTRA (dpr, resolución de figuras, objetos y suelo, sombras, partículas, gentío, luces, distancias de LOD, hierba, gradación, presupuesto de texturas), detección del dispositivo y nivel adaptativo: baja si el p95 del tiempo de dibujo pasa de 16 ms o si el intervalo entre fotogramas empeora un 40 % respecto al mejor visto (carga de GPU); sube tras dos ventanas tranquilas. Al cambiar de nivel no se vacía el caché: las claves llevan la resolución. |
| `visual/paint.ts` | Color (mezcla, luz cálida, sombra violácea), degradados, curvas suaves, `tex()` con presupuesto y LRU, `silhouette()` para sombras. |
| `visual/light.ts` | Sol por hora y tiempo (dirección, longitud con un único tope `SHADOW_MAX`, opacidad), sombra proyectada afín y sombra de contacto en textura. |
| `visual/figure/` | `body.ts` proporciones por edad y complexión; `rig.ts` de la acción al esqueleto; `head.ts` rostro con 12 expresiones, pelo, sombreros, capucha; `clothes.ts` ropa y objetos; `figure.ts` composición, mezcla entre acciones (0,22 s) y giros, objeto según la acción, figura tumbada, LOD estatua, sombras; `portrait.ts` retratos. |
| `visual/env/materials.ts` | Texturas de detalle repetibles sin costuras (las aleatorias se graban y se repiten en las copias desplazadas). |
| `render/chunks.ts` | Suelo por fragmentos 24×24: capa base a media resolución ampliada con suavizado (bordes fundidos), materiales por máscara, nieve por región, bordillos; clave por fragmento (solo sus regiones) y precarga en ratos libres (un fragmento por fotograma como mucho). |
| `visual/env/flora.ts` | Árboles pintados por valores (sombra, medio tono, luces, pinceladas de hoja), pinos por pisos, estaciones, viento, oclusión con silueta del jugador. |
| `visual/env/buildings.ts` | Casas y edificios con volumen, estados (normal, deteriorada, quemada, destruida, obra, restaurada, abandonada), riqueza y variante nevada. |
| `visual/env/props.ts`, `structures.ts`, `interiors.ts` | Mobiliario, puestos, animales, fuente animada; montañas, puestos fronterizos, barricadas, lugares, carros, mojones; viñetas de interiores animadas con quien está dentro. |
| `visual/env/plaza.ts` | Lo que distingue cada plaza (solo aspecto, determinista por semilla y región): pavimento con dibujo recortado al empedrado, árbol en alcorque, jardineras de temporada, terrazas, estandartes, guirnaldas entre faroles. |
| `render/lighting.ts` | `Lighting.night()` y `drawGrade()`: la oscuridad de luna se normaliza (la simulación da 0–0,62), los huecos de luz nunca borran la noche del todo, los halos se suman en una capa a media resolución y la viñeta nocturna va dentro de la capa oscura. |
| `render/traffic.ts`, `render/overlay.ts` | Funciones que reciben de la escena solo lo que necesitan (`TrafficHost`, `OverlayHost`): lo de fuera de los pueblos y lo que se pinta encima del mundo. `scene.ts` baja de 2.702 a ~2.000 líneas. |
| `render/village.ts`, `render/animals.ts`, `render/birds.ts`, `render/poses.ts`, `render/wet.ts` | Mismo patrón (`VillageHost`, `AnimalsHost`, `BirdsHost`, `PoseHost`, `WetHost`): el dibujo de cada pueblo, los animales, los pájaros, aspecto y postura de las personas y el suelo mojado. `scene.ts` baja de ~2.090 a ~1.450 líneas. |
| `ui/map/relief.ts`, `ui/map/inkicons.ts` | Mapa a tinta: relieve sacado del terreno real (montañas, bosques, juncos, olas) solo en lo conocido; iconos propios en medallón en lugar de emojis. |
| `render/furniture.ts` | Elipses de colisión (fuente, pozo, estatua, bancos, puestos, adornos) que frenan solo al jugador; al aparecer dentro de un mueble, se le aparta. |
| `visual/weather.ts` | Lluvia en tres capas de profundidad, salpicaduras, tormenta, nieve, niebla en bancos, viento con hojas. |
| `ui/icons.ts`, `theme.css` | Iconos propios (SVG de tinta y oro) que sustituyen a los emojis en toda la interfaz; tema de pergamino con tipografía Alegreya empaquetada. |

**LOD de entidades**: cerca (`lodNear`), figura completa con rostro; media distancia (`lodMid`), figura con rostro simplificado y gestos exagerados; lejos, una sola textura («estatua»); fuera de 46 teselas, la simulación sigue sin dibujar.

## 5. Rendimiento: lo que se midió y lo que se decidió

Medido en Chromium sin GPU (solo vale para comparar). Tres hallazgos cambiaron el diseño:

1. **Filtrado `high` al ampliar texturas** (bicúbico) era el mayor coste: con bilineal (`low`) la escena de día pasó de 29 a 46 fps y la de noche de 9 a 32. Las texturas se pintan a una resolución cercana a la de pantalla, así que el bilineal no se nota.
2. **Mezclas avanzadas a pantalla completa** (`multiply`, `screen`, `saturation`) obligan a la GPU a copiar el fondo en cada pasada (en muchos Android también). La gradación combina todos los tintes en un velo `source-over` y otro claro; la noche es un velo frío y las luces se suman (`lighter`).
3. **Suelo**: pintar un fragmento costaba 150–240 ms. Ahora la base se calcula a media resolución (4× menos, con una muestra de margen para que no haya costuras), se evita consultar la orilla lejos del agua y el pintado va por pasos: la precarga de los vecinos reparte unos 4 ms por fotograma. La caché guarda los fragmentos visibles más un anillo.
4. **Bucle**: con el diario o el mapa (opacos) el mundo no se pinta; detrás de un diálogo, uno de cada tres fotogramas. El nivel automático mide el tiempo de dibujo (no el intervalo, para no confundir un móvil a 30 Hz con uno lento) y baja o sube de nivel.
5. **Niebla**: se compone en una capa a ¼ de resolución y se dibuja una sola vez.

Sin degradados creados por fotograma en lo repetido (gotas, charcos, halos, faroles, hogueras, humo, sombras de personas y árboles, niebla, viñeta): son texturas pintadas una vez.
