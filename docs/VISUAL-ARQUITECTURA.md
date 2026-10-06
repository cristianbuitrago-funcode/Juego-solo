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
- Lo que Canvas 2D **no** hace bien: iluminación por píxel con mapas de normales, cientos de luces dinámicas y postprocesos de pantalla completa (bloom, desenfoque) a 60 fps en gama media. Eso se **aproxima**: luces en un búfer de baja resolución compuesto con `multiply`/`lighter`, sombras proyectadas como siluetas en caché deformadas con una transformación afín, y gradación por capas.
- Tamaño: Three.js/Babylon añaden 150–600 KB y otra forma de pensar la escena; Phaser, ≈1 MB. ECOS no necesita 3D.

**Decisión**: renderer **Canvas 2D a resolución nativa** con arte **pintado** (vectorial con degradados, pintado una vez en texturas en caché a la resolución que pide cada nivel gráfico) y **personajes con esqueleto 2D por piezas** (animación de recortes al estilo de las herramientas de animación 2D profesionales). Queda preparado un punto de entrada (`visual/quality.ts`) para un compositor WebGL opcional en ULTRA si en dispositivos reales se demuestra rentable; no se cambia de tecnología por moda.

## 4. Arquitectura nueva

```
SIMULACIÓN (core/, world/)            ← sin cambios de lógica
   ↓  estado del mundo (WorldState, Life, Folk, Town, Atlas…)
DATOS DE ENTIDAD → REPRESENTACIÓN (render/appearance.ts, render/mood.ts, visual/cityLook.ts)
   apariencia, expresión, acción, estado de edificios, aspecto de la ciudad
   ↓
PINTURA EN CACHÉ (visual/paint/*, visual/figure/*)
   piezas de personas, árboles, edificios, suelo, efectos — a la resolución del nivel gráfico
   ↓
COMPOSICIÓN (render/scene.ts)
   cámara, culling por fragmentos y vista, LOD, orden en profundidad, sombras, luz, clima
```

- `visual/quality.ts`: niveles **LOW / MEDIUM / HIGH / ULTRA**, detección del dispositivo (memoria, núcleos, tamaño de pantalla, prueba de rendimiento breve) y presupuesto de cada nivel (resolución de render, resolución de texturas, sombras, partículas, gentío, luces, detalle de figuras).
- `visual/paint.ts`: color (mezcla, luz/sombra con desplazamiento de tono), degradados, ruido, caché de texturas con presupuesto de memoria.
- `visual/figure/`: esqueleto (`rig.ts`: de `Pose` a ángulos de huesos por acción y fase), piezas (`parts.ts`: cabeza con rostro y expresión, pelo, sombreros, torso con ropa, extremidades, manos, objetos), composición (`figure.ts`: `drawFigure`, sombras, LOD) y retratos.
- `visual/env/`: suelo (`terrain.ts`), agua animada, vegetación (`flora.ts`), edificios con estados (`buildings.ts`), mobiliario, animales.
- `visual/light.ts`: sol por hora (dirección, longitud y color de las sombras), gradación por franja (madrugada, mañana, mediodía, tarde, atardecer, noche), luces puntuales.
- `visual/weather.ts`: lluvia, tormenta, nieve, niebla, viento y partículas a resolución nativa.

**LOD de entidades**: cerca, figura completa con rostro animado; media distancia, figura sin detalles faciales; lejos, silueta simplificada; muy lejos, no se dibuja (la simulación sigue abstracta). Las texturas en caché tienen presupuesto por nivel y se liberan por antigüedad.
