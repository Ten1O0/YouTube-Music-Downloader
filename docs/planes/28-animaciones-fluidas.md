# 28 — Animaciones fluidas en el móvil

**Estado:** pendiente · planeado con el usuario el 2026-10-22 · **Prioridad:** 🟠 Medio (experiencia en el móvil) · **Depende de:** 09 (muelles y vuelo), 19 (principio del plan, `animarConMuelle`, `test/perf/pintado.mjs`)

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

## Principio del plan

El mismo que el del plan 19: **la misma imagen, menos trabajo.** Nada de lo
que se ve cambia: ni el cristal, ni su desenfoque, ni el recorrido o la curva
de cada animación. Se aplica la regla del píxel flexible:

- Una diferencia subpíxel e invisible se acepta si hay una mejora medida.
- Cualquier cambio que se vea es una decisión del usuario, que se le presenta
  con capturas y números.

## Decisiones pendientes del usuario

Se presentan con los números de la T1 y capturas del antes y el después.

- **P1 · El fundido de la barra (C2).**
  - **a)** Animarla con Web Animations, si eso quita el repintado. No cambia
    nada a la vista; hay que medirlo.
  - **b)** Fundir solo el contenido de la barra (carátula, textos, botones) y
    dejar que el reproductor, al aparecer, tape el cristal. El cristal se
    vería hasta la mitad del vuelo, un instante más que hoy.
  - **c)** Dejarla como está.
- **P2 · El radio del clon (C1).**
  - **a)** Recortarlo con un `clip-path` animado. Es la misma imagen, si el
    compositor del WebView lo anima sin repintar; hay que medirlo.
  - **b)** Radio fijo, el del destino. En los primeros 2–3 fotogramas, la
    miniatura tendría las esquinas algo menos redondas (unos 2 px en vez de 8).
  - **c)** Dejarlo como está.
- **P3 · Cómo medir en el Vivo.** La traza por cable del plan 19 (T0) se
  descartó. Se propone el medidor de la T0, sin cables. La traza por USB queda
  como opción, si el medidor no basta.
- **P4 · El fondo con la carátula, si la T0 confirma C7.** Pararlo con el
  reproductor completo abierto, que lo tapa entero, no cambia nada a la vista y
  va en la T6 sin preguntar. Si, además, pesa en las demás vistas, las opciones
  (moverlo más despacio, pararlo durante las animaciones…) se consultan.

## Fuera de alcance

- Quitar o rebajar el cristal o su desenfoque.
- El dibujo del visualizador. Solo se retrasa su arranque (T3).
- El scroll de las listas, que va en su propio arreglo.
- Compilar la APK en release (T14 del plan 19, preparada y sin adoptar).

## Pasos

### T0 · Medir en el móvil, sin cables

**Comprobaciones previas que el usuario puede hacer ya, con la APK que tiene,**
abriendo y cerrando el reproductor unas cuantas veces en cada caso:

1. tal como está;
2. con «Fondo con la carátula» apagado en Ajustes (C7);
3. con el visualizador apagado;
4. sin el ahorro de batería (C8).

En las opciones de desarrollador de Android, «Mostrar frecuencia de
actualización» enseña a cuántos Hz va la pantalla.

**El medidor de animaciones:**

- **Qué hace:** con el medidor encendido, cada animación (el vuelo, el
  arrastre, las hojas, la carátula que respira) apunta el tiempo entre
  fotogramas con marcas de `requestAnimationFrame`. Al acabar, muestra un
  aviso pequeño, por ejemplo «Vuelo · 47 fps · peor fotograma 61 ms · 3
  tirones», y guarda las últimas 20 mediciones en una lista que se puede
  copiar y pegar.
- **Cómo se enciende:** con un ajuste escondido que se pueda tocar desde la
  APK, por ejemplo una pulsación larga en el número de versión de Ajustes.
  `localStorage` no se puede tocar a mano en la APK.
- **Peso:**
  - El medidor va en un módulo aparte (`import()`) porque el presupuesto de
    arranque solo tiene 360 bytes de margen.
  - Apagado, no cuesta nada.
  - Encendido, solo lee marcas de tiempo.

La **línea base** son estos gestos fijos, en los cuatro casos de arriba:

- abrir y cerrar el reproductor 5 veces;
- arrastrarlo para cerrarlo;
- abrir y cerrar «Ajustes»;
- pausar y reanudar.

Si C7 o C8 pesan más que el resto, se reordena el plan.

### T1 · Medir en Chrome lo que se repinta

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
- **Arranque:** `flight.js` y `full-player.js` van en el código de arranque.
  Se sustituye código, no se añade. Si no cabe, el vuelo se carga aparte la
  primera vez que se abre el reproductor.

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
- **APK en el emulador** (con `-gpu host`) con el medidor. Después, el usuario
  en el Vivo con los mismos gestos de la T0.

## Verificación

- Tabla del antes y el después en Chrome, por escena: pintados y rasterizado.
- En el Vivo, con el medidor: el vuelo y el arrastre sin tirones visibles,
  cerca de la frecuencia de la pantalla, frente a la línea base de la T0.
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
  360 bytes de margen. Ver T2.
- **El ordenador no es el móvil:** lo medido en Chrome orienta, pero manda la
  T0. Por eso se mide primero en el Vivo y se vuelve a medir allí al final.

## Orden

```
T0 + T1 (medir)  →  T2 + T3 (el vuelo)  →  probar en el Vivo  →  T4, T5, T6  →  T7 (durante todo el plan)
```
