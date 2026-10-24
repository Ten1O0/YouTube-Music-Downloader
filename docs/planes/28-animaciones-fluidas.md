# 28 — Animaciones fluidas en el móvil

**Estado:** hecho (2026-10-24, versión 2.3.0) · planeado con el usuario el 2026-10-22, revisado el 2026-10-24 con lo aprendido del scroll de la APK · T0-T7 hechas el 2026-10-24 (ver «Registro»); el usuario lo dio por cerrado con P2 y P5 tal como están · **Prioridad:** 🟠 Medio (experiencia en el móvil) · **Depende de:** 09 (muelles y vuelo), 19 (principio del plan, `animarConMuelle`, `test/perf/pintado.mjs`)

> El usuario (2026-10-22), con la APK 2.2.0 en el Vivo X200 Pro: «al pulsar la
> tarjetita pequeña de la canción en la parte de abajo, se hace la animación…
> la imagen se desplaza desde esa esquina inferior izquierda hasta la mitad de
> la pantalla… Parece que solo va a 20 FPS… Esto me pasa con varias
> animaciones.»

---

## Problema

En el móvil, el vuelo de la carátula al abrir el reproductor y otras
animaciones se ven a 15–20 fotogramas por segundo. En el ordenador van
fluidas.

### Lo que se midió (2026-10-22)

**Fotogramas en Chrome de escritorio**, con tamaño de móvil y densidad 3,
abriendo el reproductor real:

| CPU | fps | Fotogramas lentos |
|---|---|---|
| normal | 60 | ninguno |
| frenada 6× | 60 | ninguno |
| frenada 12× | 56 | uno de 52 ms: el clic que abre el reproductor (26 ms de JavaScript) |

Ni con el procesador doce veces más lento se baja de 56. El JavaScript no es
lo que frena el móvil.

**Lo que se repinta en cada vuelo** (traza de Chrome, la misma técnica que
`test/perf/pintado.mjs`; vuelo de 0,45 s, unos 27 fotogramas):

| | Quieto (0,6 s) | Abrir | Cerrar |
|---|---|---|---|
| Pintados | 6 | 128 | 142 |
| … de la página entera (`#document`) | 3 | **41** | **41** |
| … del clon de la carátula | — | **40** | **40** |
| … de la barra del mini reproductor (cristal) | — | 8 | **35** |
| Rasterizado | 0,3 ms | **68 ms** | **79 ms** |

La página entera se repinta en cada fotograma del vuelo. En el móvil eso pesa
mucho más que en el ordenador:

- Con densidad 3, cada repintado de pantalla completa son unos 3 millones de
  píxeles.
- A 120 Hz (la pantalla del Vivo), cada fotograma tiene 8,3 ms.
- Encima de la página están las barras de cristal, cuyo desenfoque se
  recalcula sobre lo repintado.

El plan 19 (parte 2) ya vio lo mismo debajo de una hoja: unas 30 pasadas de
toda la pantalla al abrir «Ajustes». Se dejó como estaba porque grabar esos
pintados costaba 1,9 ms en el ordenador, pero lo caro en un móvil es
**rasterizarlos**, y eso no se midió.

**Experimentos** (CSS añadido solo para la prueba, misma traza):

| Experimento | Abrir: pintados / raster | Cerrar: pintados / raster |
|---|---|---|
| Hoy | 128 / 68 ms | 142 / 79 ms |
| Capas propias (`will-change`) para lo que se mueve | 122 / 56 ms | 135 / 69 ms |
| + radio del clon fijo | 56 / 34 ms | 121 / 44 ms |
| + barra sin fundido | **51 / 26 ms** | **77 / 10 ms** |
| + clon sin sombra | 49 / 25 ms | 77 / 11 ms |

## Causas encontradas

- **C1 · El radio de las esquinas del clon cambia en cada fotograma.** Eso
  obliga a repintar el clon y su sombra grande (44 px de desenfoque). Con el
  radio fijo, la página pasa de 41 repintados a 13 al abrir.
- **C2 · La barra del mini reproductor se funde cambiando su opacidad.** Es
  de cristal (`glass-regular`, con `backdrop-filter`) y se repinta en cada
  fotograma. Darle capa propia no lo arregla. Sin el fundido, el rasterizado
  al cerrar baja de 44 a 10 ms.
- **C3 · Al cerrar, la página y el clon se siguen repintando** (29 y 27 veces)
  aunque se quiten C1 y C2. La causa aún no se sabe; la busca la T1.
- **C4 · Todo lo mueve un muelle de JavaScript en el hilo principal:**
  - el vuelo (`ui/motion/flight.js`), que en cada fotograma escribe además la
    opacidad del reproductor, la de la barra y la opacidad y posición de 6
    piezas, que vuelve a buscar con `querySelectorAll` cada vez;
  - el arrastre para cerrar;
  - la carátula que respira;
  - las hojas al soltarlas;
  - la isla de descargas.

  Si el hilo principal se para un momento, la animación se para con él. Y
  justo al abrir, ese hilo trabaja: el favorito, `pintarFondoFp` (paleta de la
  carátula), la barra de estado nativa y el arranque del visualizador
  (`AudioContext`, `captureStream` y un lienzo a 30 fps).
- **C5 · El muelle limita cada paso a 1/30 s** (`spring.js`, `_step`). Si el
  móvil da 20 fps, además de verse a tirones la animación se alarga: dura 1,5
  veces lo previsto.
- **C6 · Otras animaciones con el mismo patrón:**
  - el arrastre del reproductor: `transform` más `borderRadius` de toda la
    pantalla con `overflow: hidden`, repintada entera en cada fotograma;
  - la carátula que respira: `--art-shadow` cambia una sombra grande en cada
    fotograma;
  - las hojas: la página de debajo se repinta (plan 19).
- **C7 · Hipótesis: el fondo con la carátula (plan 25).** Dos manchas de
  75vmax se mueven sin parar mientras suena música, debajo de las barras de
  cristal. Las anima el compositor y no aparecen como pintados en una traza,
  pero el desenfoque de las barras se recalcula en cada fotograma de pantalla
  (120 por segundo), siempre. Puede robar GPU a todas las demás animaciones.
  Solo se puede medir en el móvil.
- **C8 · Hipótesis: el ahorro de batería** del móvil, que limita las
  animaciones de JavaScript.

## Lo aprendido con el scroll de la APK (2026-10-23)

El scroll de la APK iba a trompicones y en Chrome no (commits `1d34d0f` y
`4cc7bdc`). Lo que se descubrió cambia cómo se hace este plan:

- **Chrome de escritorio no sirve para decidir.** Allí el scroll iba
  perfecto. En el WebView, no:
  - los hilos del renderizador tienen poca prioridad y van a los núcleos
    pequeños;
  - el WebView dibuja sincronizado con Android;
  - una animación ligada al scroll atascaba la inercia, algo que en Chrome no
    pasa.

  Las cifras de Chrome de arriba orientan, pero **se mide en el Vivo**.
- **Hay herramientas probadas para medir en el Vivo por USB:**
  - APK de prueba firmada con la clave de producción y con nombre propio
    (`2.2.0-prueba-…`), que se instala encima sin perder datos;
  - trazas de Perfetto (fotogramas de Android, hilos, CPU);
  - trazas del WebView por CDP, en las APK de prueba con depuración;
  - gestos reproducibles con `adb`.

  El medidor dentro de la app que proponía la T0 ya no hace falta.
- **El gesto importa.** El atasco solo salía con un arrastre lento: los
  lanzamientos rápidos lo escondían. Cada animación se mide con sus gestos
  reales, también los incómodos.
- **Más razones para el compositor.** Con el hilo principal a poca prioridad,
  los muelles en JavaScript sufren más en la APK que en Chrome. Las T2 y T4
  pasan delante.
- **Ninguna animación ligada al scroll en la APK** (test en
  `test_scroll_apk.mjs`). Lo que se añada aquí no debe usar
  `animation-timeline`.

## Principio del plan

El mismo que el del plan 19: **la misma imagen, menos trabajo.** Nada de lo
que se ve cambia: ni el cristal, ni su desenfoque, ni el recorrido o la curva
de cada animación. Se aplica la regla del píxel flexible:

- Una diferencia subpíxel e invisible se acepta si hay una mejora medida.
- Cualquier cambio que se vea es una decisión del usuario, que se le presenta
  con capturas y números.

## Decisiones pendientes del usuario

Se presentan con los números de la T1 y capturas del antes y el después.

- **P1 · El fundido de la barra (C2).** Resuelta sin cambiar nada a la vista
  (2026-10-24): lo que repintaba era el grano del cristal, no el fundido. Ver
  el registro de la T2. Las opciones de abajo quedan como historia.
  - **a)** Animarla con Web Animations, si eso quita el repintado. No cambia
    nada a la vista; hay que medirlo.
  - **b)** Fundir solo el contenido de la barra (carátula, textos, botones) y
    dejar que el reproductor, al aparecer, tape el cristal. El cristal se
    vería hasta la mitad del vuelo, un instante más que hoy.
  - **c)** Dejarla como está.
- **P2 · El radio del clon (C1) y el del arrastre.** Cerrada (2026-10-24): se
  queda como está (c), al dar el usuario el plan por cerrado. Números en el
  registro de la T2 y la T4, por si se retoma. El `clip-path` (a) no sirve: en Chrome
  repinta igual que el radio.
  - **a)** Recortarlo con un `clip-path` animado. Es la misma imagen, si el
    compositor del WebView lo anima sin repintar; hay que medirlo.
  - **b)** Radio fijo, el del destino. En los primeros 2–3 fotogramas, la
    miniatura tendría las esquinas algo menos redondas (unos 2 px en vez de 8).
  - **c)** Dejarlo como está.
- **P3 · Cómo medir en el Vivo.** Resuelta (2026-10-23): por USB, con las
  herramientas del scroll.
- **P4 · El fondo con la carátula, si la T0 confirma C7.** Pararlo con el
  reproductor completo abierto, que lo tapa entero, no cambia nada a la vista y
  va en la T6 sin preguntar. Si, además, pesa en las demás vistas, las opciones
  (moverlo más despacio, pararlo durante las animaciones…) se consultan.
- **P5 · La isla de descargas** (encontrada en la T5): recortarla con un
  `clip-path` animado (su texto dejaría de reajustarse mientras crece) o
  dejarla. Cerrada (2026-10-24): se queda como está. El `clip-path` también
  repinta en Chrome, así que ganaba poco. Ver «Registro · T5 y T6».

## Fuera de alcance

- Quitar o rebajar el cristal o su desenfoque.
- El dibujo del visualizador. Solo se retrasa su arranque (T3).
- El scroll de las listas, que va en su propio arreglo.
- Compilar la APK en release (T14 del plan 19, preparada y sin adoptar).

## Pasos

### T0 · Medir en el Vivo, por USB

Con la APK de producción y, para las trazas del WebView, una APK de prueba con
depuración. Por cada gesto: fotogramas que presenta Android y sus tirones,
huecos de más de 1,5 refrescos, qué hacen el hilo principal, el compositor y
el `RenderThread`, y la CPU.

**Gestos, con `adb` y repetidos varias veces:**

- tocar la miniatura del mini reproductor (abrir con vuelo) y cerrar con la
  flecha o el «atrás»;
- cerrar mientras se abre, y abrir mientras se cierra;
- arrastrar para cerrar: del todo, a medias y soltando para que vuelva;
- abrir y cerrar «Ajustes» y la cola; arrastrar una hoja para cerrarla;
- pausar y reanudar con el reproductor abierto (la carátula que respira).

**En cuatro situaciones:** tal cual; sin «Fondo con la carátula» (C7); sin el
visualizador; con el ahorro de batería encendido (C8). Si C7 o C8 pesan más que
el resto, se reordena el plan.

### T1 · Medir en Chrome lo que se repinta (orienta; decide el Vivo)

- **Escenas nuevas en `test/perf/pintado.mjs`:**
  - abrir y cerrar con vuelo;
  - arrastrar para cerrar;
  - pausar y reanudar (la carátula que respira);
  - abrir y cerrar una hoja.

  Por cada escena, una traza que da: pintados, área repintada, ms de
  rasterizado, recálculos de estilo y qué nodo se pinta cuántas veces. Son las
  cifras de la tabla de arriba, que pasan a ser la línea base.
- **Buscar la causa de C3** con la traza de invalidaciones
  (`disabled-by-default-devtools.timeline.invalidationTracking`): por qué se
  repintan la página y el clon al cerrar.
- **Medir las opciones de P1 y P2** (Web Animations en la barra, `clip-path`
  en el clon), para presentárselas al usuario con números.

### T2 · El vuelo, en el compositor

- **Antes de elegir, dos caminos medidos en el Vivo:**
  - **a)** el clon de hoy, movido con Web Animations (lo que sigue);
  - **b)** la API de transiciones de vista (`document.startViewTransition`):
    el WebView 155 la soporta y la app ya la usa al cambiar de vista. El
    navegador anima solo el paso de la miniatura a la carátula grande, sin
    clon y, quizá, sin el problema del radio (C1, P2). Hay que comprobar el
    coste de sus capturas y si se puede dar la vuelta a mitad.
- **Una curva desde cualquier punto.** `curvaDesde({ desde, hasta, velocidad,
  preset })` generaliza `curvaDeMuelle` (`spring.js`) con el mismo integrador y
  da los fotogramas de un muelle que empieza en cualquier punto y con
  cualquier velocidad. Es lo que permite pasar al compositor también las
  animaciones que cambian de rumbo.
- **El clon.** Su `transform` es lineal en el progreso (`flightPose`), así
  que basta con dos fotogramas clave y la curva del muelle como `easing`. Hace
  exactamente el mismo recorrido que hoy, con Web Animations.
- **El reproductor y sus 6 piezas.** Sus opacidades y desplazamientos no son
  lineales en el progreso. Se muestrea la misma curva, un fotograma clave por
  fotograma, y se anima también con Web Animations. Las piezas se buscan una
  sola vez al empezar.
- **Dar la vuelta a mitad** (cerrar mientras se abre):
  - se lee la posición y la velocidad de la curva en el instante actual;
  - se cancela la animación;
  - se lanza otra desde ahí con `curvaDesde`.

  Sin frenazo ni salto, como hoy.
- **Radio del clon y fundido de la barra:** según P1 y P2.
- **Respaldo:** si el WebView no entiende `linear()` (`animarConMuelle`
  devuelve `null`), se anima con `Spring`, como ahora. «Reducir movimiento»
  sigue con su fundido de 180 ms.
- **Arranque:** `flight.js` y `full-player.js` van en el código de arranque,
  que tiene **48 bytes de margen** (2026-10-23). Lo primero de la T2 es hacerle
  sitio: cargar el vuelo aparte la primera vez que se abre el reproductor, o
  liberar bytes del arranque.

### T3 · Abrir el reproductor sin estorbar al vuelo

Hasta que acaba el vuelo (o el fundido) se retrasa:

- el arranque del visualizador;
- la barra de estado nativa;
- `pintarFondoFp` si la carátula es la misma de cuando empezó la canción: los
  colores ya están puestos (`player/ui.js` los pinta al cambiar de canción).

El objetivo es que el clic que abre el reproductor baje de los 26 ms medidos
con la CPU frenada 12×.

### T4 · Arrastrar para cerrar y la carátula que respira

- **Arrastre del reproductor:**
  - Mientras el dedo manda sigue el `Spring`, pero solo escribe `transform`.
  - El radio de las esquinas sale de la misma decisión que P2.
  - Al soltar, la animación hasta cerrarse o volver va en el compositor con
    `curvaDesde`, desde la posición y con la velocidad del dedo.
- **La carátula que respira:**
  - La escala ya es un `transform`.
  - La sombra que crece se cambia por dos sombras fijas (la pequeña y la
    grande) en capas que se funden. Si las capturas muestran diferencia, se
    consulta.
  - Va con Web Animations y `curvaDesde`, porque pausar y reanudar rápido le
    cambia el rumbo.
- **C5:** el límite de 1/30 s del `Spring` se queda para lo que sigue al dedo,
  donde evita saltos. Lo que pasa al compositor deja de depender de él.

### T5 · Las hojas y lo demás

- **Hojas:** averiguar por qué la página de debajo se repinta unas 30 veces al
  abrir una hoja (el velo oscuro, el cristal…) y quitar el repintado. Al
  soltarlas, `curvaDesde`.
- **Isla de descargas:** comprobar qué escriben sus muelles de ancho y alto.
  Si mueven la maqueta, pasar a `transform` con la misma imagen.
- **Letra:** el `scrollTop` no se puede llevar al compositor. Solo se
  comprueba que no repinte de más.

### T6 · El fondo con la carátula

- Con el reproductor completo abierto y quieto, el fondo no se ve: sus
  animaciones se pausan y se reanudan al cerrarlo. No cambia nada a la vista.
- Lo mismo con la app en segundo plano, si no lo hace ya el navegador.
- Si la T0 muestra que pesa también en las demás vistas: P4.

### T7 · Tests

- **Unitarios (`test/frontend/`):**
  - `curvaDesde` frente a `Spring`, fotograma a fotograma, con velocidad
    inicial: como mucho 1 px de diferencia, como en el plan 19 (T9);
  - el vuelo con Web Animations: los fotogramas clave coinciden con
    `flightPose`;
  - dar la vuelta a mitad conserva la posición y la velocidad;
  - las piezas se buscan una sola vez;
  - el respaldo sin `linear()`.
- **Rendimiento (`npm run test:perf`, `presupuesto.spec.js`):** topes por
  escena con las cifras de la T1. Por ejemplo, el vuelo no repinta la página
  más de 3 veces y el rasterizado baja a menos de la mitad.
- **E2E:**
  - siguen en verde los recorridos del vuelo, el 15 (reducir movimiento) y el
    32 (visualizador), y las capturas de estética salen iguales;
  - recorrido nuevo: cerrar mientras se abre y abrir mientras se cierra
    terminan bien.
- **En el Vivo**, con los mismos gestos de la T0 y una APK de prueba. Después,
  el usuario lo prueba con el dedo.

## Verificación

- En el Vivo, frente a la línea base de la T0: el vuelo y el arrastre sin
  tirones, cerca de la frecuencia de la pantalla. Es lo que decide.
- Tabla del antes y el después en Chrome, por escena: pintados y rasterizado.
- Las capturas de estética salen iguales, o con las diferencias aceptadas en
  P1 y P2.

## Riesgos

- **Web Animations y `linear()` en el WebView:** `linear()` llegó con Chrome
  113. El WebView de Android se actualiza por la tienda, y hay respaldo con
  `Spring`.
- **Dar la vuelta a mitad** es la parte delicada. La cubren los unitarios y un
  recorrido nuevo.
- **Capas propias:** gastan memoria de GPU. Solo durante la animación, y se
  quitan al acabar.
- **Presupuesto de arranque:** el vuelo está en el código de arranque y quedan
  48 bytes de margen. Ver T2.
- **El ordenador no es el móvil:** lo medido en Chrome orienta, pero manda el
  Vivo. Con el scroll, Chrome decía que todo iba bien.
- **Rarezas del WebView:** pueden aparecer otras como la del scroll. Por eso
  se mide cada cambio en el Vivo antes de seguir.

## Orden, en dos fases

```
Fase 1:  T0 (Vivo) + T1  →  T2 + T3 (el vuelo)  →  APK de prueba  →  el usuario lo prueba
Fase 2:  T4, T5, T6, solo si la fase 1 confirma el enfoque
T7, durante todo el plan
```

Estimación (2026-10-24): fase 1, unas 7–8 h; el plan completo, 15–17 h.

## Registro · T0-T4 y T7

Hecho el 2026-10-24 por la primera sesión, en paralelo con la que hizo T5 y
T6. Todo medido en Chrome; **falta la T0 y medirlo en el Vivo**, que es lo que
decide: la T0 se midió después, con el móvil ya conectado (abajo).

### T0 · El Vivo

Medido el 2026-10-24 por USB con dos APK firmadas con la clave de
producción: `2.2.0-prueba-scroll-4` (antes del plan) y `2.2.0-prueba-28-1`
(con el plan entero). Las mismas escenas, 3 veces cada una, con
`dumpsys gfxinfo framestats`: cada fotograma del WebView pasa por el hilo de
dibujo de la app.

- **El Vivo dibuja esta app a 60 Hz** (16,6 ms por fotograma) y sube a 90 solo
  mientras el dedo toca la pantalla.
- Los fotogramas «perdidos» no sirven para comparar: con el plan, el fondo se
  para detrás del reproductor abierto y la app deja de dibujar cuando no se
  mueve nada, y esos ratos cuentan como huecos. La medida limpia es lo que
  tarda cada fotograma en dibujarse: el que pasa de 16,6 ms llega tarde.

Tiempo de dibujo por fotograma en los 600 ms que siguen a la acción (mediana
de las 3 tandas; el peor, de todas):

| Escena | p50 | p90 | El peor |
|---|---|---|---|
| Abrir con el vuelo | 20,0 → **11,8** ms | 43,8 → **19,9** ms | 99 → 59 ms |
| Cerrar con el vuelo | 17,8 → 15,1 ms | 41,1 → **23,2** ms | 60 → 50 ms |
| Abrir la cola | 32,0 → **11,4** ms | 51,5 → **19,1** ms | 145 → 37 ms |
| Cerrar la cola | 14,7 → 10,8 ms | 27,8 → **16,3** ms | 52 → 37 ms |
| Arrastrar poco y volver | 18,3 → 12,4 ms | 19,6 → 14,2 ms | 38 → 58 ms (una vez) |
| Pausar | 11,5 → 11,4 ms | 15,5 → 14,4 ms | 25 → 65 ms (la primera) |
| Reanudar | 11,7 → 11,4 ms | 15,6 → 13,2 ms | 26 → 27 ms |

Abrir el reproductor y la cola pasan a ir casi siempre a tiempo. Lo que aún
llega tarde en el vuelo (p90 de 20-23 ms) es el radio que se anima: P2. Los
peores sueltos de «después» salen en la primera tanda, cuando se carga el
código del vuelo y se calculan por primera vez los extremos de la sombra.
Las transiciones de vista (T2, opción b) no se han probado: con estas cifras
no hacen falta.

### T1 · Las escenas, en Chrome

`node test/perf/pintado.mjs --escenas --dist <carpeta>` mide abrir y cerrar con
el vuelo, arrastrar (poco, vuelve; mucho, cierra), pausar y reanudar, y abrir y
cerrar la cola. Por escena: pintados, cuántos de la página (#document), ms de
rasterizado, recálculos de estilo y ms de script. De paso, su letra falsa trae
ya título, artista y duración (sin ellos la app la descartaba).

Móvil (390×844, densidad 2), antes del plan → con el plan entero (las dos
sesiones). Pintados (de la página) · raster:

| Escena | Antes | Después |
|---|---|---|
| Abrir con el vuelo | 126 (43) · 62 ms · script 26 ms | 127 (47) · 43 ms · script 7 ms |
| Cerrar con el vuelo | 151 (45) · 83 ms | 113 (46) · 31 ms |
| Arrastrar poco y volver | 88 (27) · 148 ms | 79 (28) · 158 ms |
| Arrastrar y cerrar | 152 (48) · 77 ms | 63 (19) · 76 ms |
| Pausar | 90 (38) · 35 ms | **23 (5) · 9 ms** |
| Reanudar | 89 (35) · 55 ms | **30 (7) · 7 ms** |
| Abrir la cola | 107 (44) · 256 ms | **31 (8) · 35 ms** |
| Cerrar la cola | 60 (20) · 63 ms | **31 (7) · 6 ms** |

En el ordenador, las mismas proporciones. Lo que queda en el vuelo y en el
arrastre es el radio que se anima: es P2.

**La causa de C3** (por qué se repintaban la página y el clon al cerrar):
dos cosas a la vez, el radio del clon (C1) y el grano del cristal del mini
reproductor, que repintaba la barra en cada fotograma de su fundido. Medido en
el vuelo, pintados al abrir / cerrar:

| Variante | Abrir | Cerrar |
|---|---|---|
| Antes del plan | 128 · raster 68 ms | 142 · raster 79 ms |
| Vuelo en el compositor | 123 · 53 ms | 140 · 82 ms |
| + radio fijo (P2-b) | 54 · 24 ms | 95 · 44 ms |
| + grano de la barra recortado | la barra: 9 → 0 | la barra: 36 → 2 |
| + las dos cosas | 45 · 24 ms | 27 · 12 ms |

### T2 · El vuelo, en el compositor

- **`ui/motion/curva.js`** (nuevo, se carga aparte): `curvaDesde({ desde,
  hasta, velocidad, preset })` da un valor por fotograma de 1/60 s con el mismo
  integrador que `Spring` (pasos de 1/600 s); `enInstante` dice dónde va y a qué
  velocidad en cualquier instante; `animarCurva` lo convierte en una animación
  con un fotograma clave por valor y `easing: linear`, así que **no depende de
  `linear()`**; `muelleEnCompositor` lo hace sobre varias pistas a la vez.
- **`flight.js`**: con Web Animations, el `transform` del clon, el radio (en
  una animación aparte, porque mezclado con el `transform` se lo llevaría al
  hilo principal) y las capas que le pasan siguen la misma curva. Darle la
  vuelta a mitad lee posición y velocidad, cancela y relanza desde ahí. Sin Web
  Animations, el `Spring` de siempre.
- **`features/player/movimiento-fp.js`** (nuevo, se carga aparte): el
  reproductor y sus 6 piezas como capas del vuelo, buscadas una vez por vuelo.
- **Arranque:** el vuelo se carga la primera vez que se abre el reproductor (se
  pide ya al tocar el mini reproductor). Mientras carga, vale lo último que se
  pidió: abrir y cerrar enseguida no lo deja abierto. El visualizador espera a
  que acabe el vuelo.
- **C2 sin cambiar nada a la vista (P1):** el grano del mini reproductor va sin
  radio y recortado con un `clip-path` de sus esquinas, solo en el móvil (en el
  ordenador no tiene esquinas). Píxeles: 6 de 308.880 a 1/255. `overflow: clip`
  en la barra se descartó: 1.072 píxeles hasta 13/255 en las esquinas.
- **La tecla F** daba por abierto el reproductor mientras se cerraba y lo volvía
  a cerrar: ahora vale lo último que se pidió (`abierta()` en
  `full-player.js`). Lo cubre el recorrido 153.
- **P2, con números** (lo que queda): radio fijo, el de la carátula grande,
  baja el vuelo de 127 a 55 pintados al abrir y de 113 a 35 al cerrar, con la
  página de 47 a 17 y de 46 a 8. A la vista: en los primeros fotogramas la
  miniatura tendría las esquinas algo menos redondas (unos 2 px en vez de 6).
  `clip-path` animado no sirve: en Chrome repinta igual (74 pintados frente a
  74 del radio, en una página de prueba).
- **Las transiciones de vista** (opción b): sin medir; solo tiene sentido en el
  Vivo, con la T0.

### T3 · Abrir sin estorbar al vuelo

- `pintarFondoFp` no repinta si la carátula es la misma que ya está puesta.
- El visualizador arranca al acabar el vuelo.
- El clic que abre, con la CPU frenada 12×: el primero, de 56 a 5 ms (el vuelo
  se carga aparte y su trabajo va después); los siguientes, de 8-13 a 21-24 ms,
  por debajo de los 26 del objetivo. La subida es preparar de golpe las 10
  animaciones (unos 6 ms de `animate()` con la CPU frenada, menos de 1 ms sin
  frenar). A cambio, el script de todo el vuelo baja de 26 a 7 ms. Si en el Vivo
  pesa, se puede reducir con `linear()` (dos fotogramas clave en las pistas
  lineales).

### T4 · Arrastrar para cerrar y la carátula que respira

- **Arrastre:** mientras el dedo manda, el `Spring` de siempre. Al soltar, la
  vuelta o el cierre van en el compositor con `curvaDesde`, desde donde se soltó
  y con la velocidad del dedo; agarrarlo a mitad sigue desde donde iba. El radio
  que crece al arrastrar sigue igual: es P2 (radio 0 al arrastrar: de 79 a 48
  pintados y de 158 a 77 ms de raster al volver).
- **La carátula que respira:** la escala y la sombra van en el compositor. La
  sombra era un `box-shadow` que crecía en cada fotograma y repintaba la página
  (38 de los 90 pintados al pausar). Ahora es un `filter: drop-shadow()`, que el
  compositor anima, con los mismos valores en cada fotograma: la pista mezcla
  los dos extremos que calcula el CSS (todos sus números son lineales en
  `--art-shadow`). En vez de las dos sombras fijas fundidas del plan, que
  cambiaban la imagen a mitad.
  - En Chrome, `drop-shadow()` con la mitad de desenfoque pinta lo mismo que
    `box-shadow`: con el mismo valor la diferencia llegaba a 29/255.
  - **Píxeles** (regla del píxel flexible), en reposo y a mitad: en el móvil,
    como mucho 4/255 en 17 píxeles y el resto a 1/255; en el ordenador, como
    mucho 7/255, porque el filtro también da sombra al brillo dorado (sin él,
    2/255).
  - Pausar: de 90 a 23 pintados, la página de 38 a 5, el raster de 35 a 9 ms.
- **C5:** lo que pasa al compositor ya no depende del límite de 1/30 s.

### T7 · Pruebas

- `test/frontend/test_motion_curva.mjs` (15): `curvaDesde` frente a la curva de
  los tokens y frente a `Spring` con velocidad de salida, fotograma a fotograma
  (como mucho 1e-4 del recorrido, menos de 0,05 px en un vuelo de 310 px);
  `enInstante`; los fotogramas clave del vuelo frente a `flightPose`; el radio en
  su propia animación; dar la vuelta a mitad conserva posición y velocidad y no
  da por terminado el vuelo una animación ya sustituida; las piezas se buscan
  una vez; el respaldo sin Web Animations; la sombra que respira.
- Recorridos **153** (cerrar mientras se abre, abrir mientras se cierra con la
  F, y tres F seguidas: acaban donde se pidió y sin animaciones, carátulas
  ocultas ni barra a medio fundir) y **154** (pausar y reanudar sin esperar;
  soltar un arrastre corto y uno largo sin dejar nada puesto). El 153 falla sin
  el arreglo de la F.
- `presupuesto.spec.js`: pintados de la página al pausar y al abrir la cola,
  con tope por debajo de la mitad de antes (aquí, con la CPU frenada 4× y 300
  canciones: antes 56-57 y 50-59; ahora 4-8 y 13-19). El tope del vuelo («no
  repinta la página más de 3 veces») espera a P2: con el radio animado son ~46.
- En verde: la unitaria completa (1255/1256, 0 fallos), la lint, los recorridos
  10, 12, 13, 15, 18, 19, 32, 153, 154, 160 y 161, `estetica.spec.js` (22/22) y
  `npm run test:perf` (7/7).
- APK de prueba en el Vivo (2.2.0-prueba-28-1 y -2), probada por el usuario.

### Encontrado al probar la APK

- **El botón de reproducir y pausar de la notificación no hacía nada** (venía
  de antes del plan). El plugin `@jofr/capacitor-media-session` 3.0.3 le daba
  dos acciones juntas a `buildMediaButtonPendingIntent`, que solo traduce una:
  el botón se quedaba sin acción (`"Play" -> null` en `dumpsys notification`).
  Lo arregla `scripts/parchear-plugins.mjs`, que las dos compilaciones de la
  APK aplican antes de `cap sync`. Comprobado pulsándolo en la cortina del Vivo.
- **Los botones de la pantalla completa dejaban de responder a veces.** El
  WebView se quedaba con el `pointer-events: none` heredado de `.fp-hidden` en
  las 5 piezas que anima el vuelo, aun abierto y sin ninguna regla que lo
  pusiera (comprobado con `CSS.getMatchedStylesForNode`). Una serie al azar de
  abrir, cerrar, siguiente y play lo reproducía en el Vivo en los pasos 14, 32
  y 29. `.fp-hidden` ya no quita los toques (oculto está fuera de la
  pantalla): 0 fallos en 900 pasos.

## Registro · T5 y T6

Hecho el 2026-10-24 por la segunda sesión, en paralelo con la que hizo T0-T4.
Todo medido en Chrome (390×844, densidad 3, trazas como las de
`test/perf/pintado.mjs`) sobre una compilación aparte; **falta medirlo en el
Vivo**, que es lo que decide (ver «Lo aprendido con el scroll»).

### T5 · Las hojas

**La causa del repintado bajo una hoja** (la que el plan 19 vio y no explicó):
el grano del cristal, `:is(.glass-thin, .glass-regular, .glass-thick)::after`,
con `border-radius: inherit` y su imagen de fondo. Cuando un elemento de
cristal se anima (`transform` u opacidad), Chrome repinta la página entera y el
propio panel en cada fotograma. Se aisló quitando una cosa cada vez:

| Experimento («Ajustes») | Abrir: pintados (de la página) | Cerrar: pintados (de la página) |
|---|---|---|
| Hoy | 21 (10) | 37 (18) |
| Grano sin radio | **8 (4)** | **6 (3)** |
| Grano sin imagen, o sin grano | 8 (4) | 6 (3) |
| `will-change`, `contain: paint`, `isolation`, sin `mix-blend-mode`, grano con opacidad 0, panel sin `backdrop-filter` | sin cambio | sin cambio |
| El panel quieto (sin su transición) | 5 (3) | 5 (3) |

**El arreglo, con la misma imagen:**

- Los modales (`.auth-modal-content`) y el menú de formato (`.custom-options`)
  ya recortan su contenido con sus esquinas (`overflow`, comprobado en el móvil
  y en el ordenador), así que su grano va sin radio.
- La hoja de la cola no recorta: `overflow: clip` cambiaba la imagen (hasta
  14/255). El grano se recorta con un `clip-path` de las mismas esquinas.
- La sesión de T0-T4 aplicó lo mismo al mini reproductor durante el vuelo.

**Medido con la compilación real:**

| Escena | Antes | Después |
|---|---|---|
| Abrir «Ajustes» | 21 pintados, raster ~68-95 ms | 8 pintados, raster ~40 ms |
| Cerrar «Ajustes» | 37 pintados, raster ~56-66 ms | 6 pintados, raster ~7-20 ms |
| Abrir la cola | raster ~243-257 ms | raster ~35-42 ms |
| Cerrar la cola | 52 pintados, raster ~77 ms | 22 pintados, raster ~6 ms |

**Píxeles** (regla del píxel flexible, pendiente de que el usuario lo vea):
capturas de Ajustes, una confirmación, una ventana, la cola y el menú de
formato, en móvil y ordenador. El control (CSS vacío) sale idéntico; con el
arreglo cambian de 49 a 766 píxeles, todos a 2/255 como mucho, en el borde de
las esquinas.

**Al soltar una hoja arrastrada:** la vuelta va en el compositor con
`muelleEnCompositor` (`ui/motion/curva.js`), con la misma curva del muelle
ágil, desde `ui/hoja-vuelta.js`, que se carga aparte la primera vez que se
arrastra una hoja. En `sheets.js` quedan solo los enganches (unos 460 bytes de
arranque): agarrarla a mitad sigue desde donde iba, y cerrarla durante la vuelta
la quita. Sin Web Animations o con «Reducir movimiento», el muelle de siempre.
El cierre arrastrando ya era una transición de CSS: no cambia.

**Los esqueletos (encontrado al medir la letra):** el brillo animaba
`background-position` y repintaba en cada fotograma mientras cargaba algo. Con
el reproductor abierto y la letra cargando (sin red, con sus reintentos, puede
durar unos 10 s), `#lyricsSection` y la página se pintaban unas 70 veces por
segundo. Ahora el mismo degradado va en un `::before` cuatro veces más ancho que
se desliza con `transform`: el mismo recorrido, de −1 a +1 anchos.

| Escena (reproductor abierto, letra cargando) | Antes | Después |
|---|---|---|
| Quieto, 0,6 s | 91-93 pintados, raster 24 ms | 9 pintados, raster 0,4 ms |
| Abrir la cola | 147 pintados | 36 pintados |

Píxeles, con las animaciones congeladas en 5 instantes: casi todos los que
cambian, a 1/255 (unos 170.000 de 2,4 millones), y unos 50 de 2 a 6/255 en el
borde de las esquinas. Pendiente de que el usuario lo vea, como el grano.

**La isla de descargas: no se ha tocado.** Sus muelles escriben `width`,
`height` y `border-radius` en cada fotograma: mueven la maqueta. Medido
importando dos audios, el cambio de tamaño cuesta en 1,5 s unos 32 pintados de
la isla, 19 de la página, 24 maquetaciones y 15-20 ms de raster. `will-change`
no lo arregla, y con `transform` no sale la misma imagen: escalaría el texto y
el anillo, que hoy se reajustan mientras crece. **Decisión del usuario:**

- **a)** recortarla con un `clip-path` animado sobre la isla ya a su tamaño
  final: el contenido dejaría de reajustarse mientras crece;
- **b)** dejarla como está.

**La letra:** con 58 líneas sincronizadas desplazándose (`scrollTop` de 445 a
923 en 6 s), en 4 s no se pinta ni `#lyricsSection` ni ninguna línea; solo la
barra de progreso y la hora. Bien como está. De paso: la letra falsa de
`pintado.mjs` no traía título, artista ni duración y la app la descartaba
(plan 22), así que su escena «con la letra» no tenía letra. Lo arregla la
sesión de T0-T4.

### T6 · El fondo con la carátula

`ui/ambiente.js` sigue al reproductor completo sin tocarlo, con un
`MutationObserver` sobre la clase `fp-hidden` y el `data-presence` de
`#fullPlayer`:

- Abierto y quieto, el reproductor lo tapa entero: las animaciones se pausan
  cuando acaba su deslizamiento de llegada.
- En cuanto aparece `data-presence` (vuelo, fundido o arrastre) o `fp-hidden`,
  vuelven a moverse en el mismo microtask, antes del siguiente fotograma. La
  sesión de T0-T4 mantiene ese contrato.
- También se pausan con la app en segundo plano (`visibilitychange`) y al
  terminar de frenar con la música en pausa: antes seguían «running» a
  `playbackRate` 0, y el compositor seguía contándolas.
- `playbackRate` sigue igual que antes, así que el recorrido 132 vale tal cual.
- Siguen donde estaban: a la vista, nada cambia.

C7 (si el fondo roba GPU a lo demás) sigue siendo una hipótesis que solo
responde la T0 en el Vivo; si pesa también en las demás vistas, es P4.

### Pruebas

- `test/frontend/test_hoja_vuelta.mjs` (7): la curva fotograma a fotograma, al
  llegar el muelle queda en 0, agarrarla a mitad, cerrarla durante la vuelta, sin
  Web Animations y con «Reducir movimiento»; que se carga aparte.
- `test/frontend/test_repintados.mjs` (8): el grano sin radio donde ya se
  recorta y con `clip-path` en la cola, los esqueletos con `transform`, y el
  fondo que se para tapado, en segundo plano o frenado.
- `test_forma.mjs`: `border-radius: 0` (sin esquinas) cuenta como permitido.
- Recorridos 160 (el fondo: abierto, arrastrándolo, cerrado y con la música en
  pausa) y 161 (una hoja soltada vuelve con Web Animations y no deja nada).
- En verde: la unitaria completa (1255/1256, 0 fallos), la lint y los
  recorridos 160, 161, 132, 15, 11, 80, 111 y 115. `estetica.spec.js`: 21 de 22;
  «movil · selección múltiple y deshacer» falló 1 de 3 veces por la altura de
  desplazamiento (la carrera de tiempos de las recomendadas del plan 25), no
  por el pintado.
