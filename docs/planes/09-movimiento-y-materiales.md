# 09 — Movimiento y materiales

**Estado:** hecho · **Prioridad:** 🟡 Medio (experiencia) · **Depende de:** 06 y 07 (hechos) · coordinación con 08
**Laboratorio:** [Muelles y cristal](https://claude.ai/artifact/5PikMNLjQzSNsNkUtR6SVa): cada propuesta de este plan, en movimiento y comparada con lo que hay hoy.

> Que Music Downloader se sienta como una app de Apple sin dejar de ser la
> nuestra. **De Apple, la física y la continuidad; de la casa, los materiales.**
> Este plan no cambia qué hace la aplicación: cambia cómo se mueve, cómo
> responde al dedo y de qué están hechas sus superficies.

### Decisiones ya tomadas

| Tema | Decisión |
|---|---|
| Del mini reproductor al completo | **Transformación**: la carátula vuela desde el mini reproductor hasta su sitio |
| Superficies translúcidas | **Cristal esmerilado tirando a cristal**: un punto intermedio entre los tres materiales y el cristal puro del laboratorio, más cerca del cristal (§2.6) |
| Resto de propuestas | Todas, tal como se presentaron en el laboratorio |
| Nombre de la app en pantalla (D17) | **Music Downloader** en todas partes, para no apoyarse en la marca de YouTube |
| Alineación de las letras en el móvil | **A la izquierda**, como Apple Music |

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | Una sola curva para todo y 12 duraciones sueltas | `styles.css` · `:root`, `--transition-smooth`, `--transition-fast` y 20 usos de `cubic-bezier(0.16, 1, 0.3, 1)` | Movimiento sin física: se interrumpe con un frenazo y cada pieza dura lo que alguien decidió en su día |
| D2 | 65 reglas `transition: all` | `styles.css` | Animan también propiedades de layout sin querer, y son lo primero que da tirones en un Android modesto |
| D3 | Entradas y salidas con `display: none` | `.hidden { display: none !important }` · 63 usos en `app.js` | Los 13 modales y hojas, las hojas y las vistas de detalle aparecen y desaparecen de golpe |
| D4 | Sin «Reducir movimiento» ni «Reducir transparencia» | `styles.css` · 0 reglas | Quien tiene activada la preferencia en el sistema recibe todas las animaciones igualmente |
| D5 | El reproductor completo no tiene continuidad | `showFullPlayer` / `hideFullPlayer` · `.full-player` | Sube un 100 % desde el borde, sin relación con el mini reproductor; solo se cierra con la flecha; la carátula no reacciona a la pausa |
| D6 | Pulsación al revés que en Apple | 2 reglas `:active`, 9 `:hover` con `translateY` | Se reacciona al pasar el ratón y apenas al pulsar; en el móvil no hay ratón |
| D7 | Superficies sin escala | 12 superficies con `backdrop-filter`, 7 intensidades (4-30 px), más `blur(80px)` en el fondo del reproductor | Cada una se ve distinta; el desenfoque grande es el efecto más caro en Android |
| D8 | **(nuevo)** La tarjeta de descarga no tiene salida ni estado en espera | `QueueManager` · `.leaving` y `.pending` sin CSS · `entering` nunca se quita | La tarjeta desaparece de golpe a los 400 ms; las descargas en espera no se distinguen de las activas; en el móvil tapa la cabecera |
| D9 | Las listas se repintan enteras | `LibraryModule.render()` con `innerHTML` · `removeSong` con `setTimeout` de 50 y 350 ms | Ninguna fila entra animada; el borrado depende de temporizadores y de `max-height` |
| D10 | Deslizar para añadir a la cola choca con un tope | `initSwipeEvents` · tope en 1,3 × 120 px | Sin resistencia ni velocidad; «háptico» con `navigator.vibrate(30)` |
| D11 | **(nuevo)** Reordenar frena en seco | `new Sortable(...)` · `easing: 'cubic-bezier(0.11, 0, 0.5, 0)'` | Es una curva que **acelera al llegar**: justo lo contrario de algo que se asienta |
| D12 | Letras con desplazamiento del navegador | `LyricsModule.updateActiveLine` · `scrollIntoView({ behavior: 'smooth' })` | Duración fija del navegador, `scrollIntoView` puede mover también el contenedor con *scroll snap* del reproductor, y no hay profundidad entre líneas |
| D13 | **(nuevo)** Las letras sin sincronizar son casi ilegibles | `renderLyrics` · todas con clase `past` | Se pintan al 22 % de opacidad |
| D14 | **(nuevo)** Tocar una línea de la letra no salta a ese momento | `app.js:7773` · `window.PlayerModule` | `PlayerModule` es un `const` de un módulo: `window.PlayerModule` siempre es `undefined` |
| D15 | **(nuevo)** El botón dice «Descargar MP3» con M4A elegido | `TRANSLATIONS` · `download_btn` y `subtitle`, en los 6 idiomas | El texto no sigue al selector de formato |
| D16 | **(nuevo)** Etiqueta de depuración visible en producción | `app.js` · `debug-env-label` (creación ~7485, actualización ~21) | Se ve «v=74 [N:false]» en la esquina inferior derecha |
| D17 | Detalles de marca | `index.html` · ☕ ×2, banderas PNG de `flagcdn.com`, dos nombres, CSS muerto de `.full-player.lyrics-mode` | Emoji entre iconos de línea; las banderas son una petición a un tercero en cada carga y no se ven sin conexión; nadie añade `lyrics-mode` |
| D18 | La APK no se comporta como una app | `mobile/package.json` · sin `@capacitor/haptics` ni `@capacitor/status-bar` · 0 reglas de `user-select`, `overscroll-behavior` o `-webkit-touch-callout` | Sin hápticos; una pulsación larga selecciona texto de la interfaz; barras del sistema sin coordinar |

---

## 2. Principios y decisiones de diseño

### 2.1 La filosofía

**De Apple tomamos cómo se mueve:**

| Principio | Qué significa aquí |
|---|---|
| Respuesta en el mismo fotograma | Al tocar, algo cambia al instante. Ninguna interacción espera a que termine una animación |
| Todo viene de algún sitio | El reproductor nace del mini reproductor y vuelve a él; una hoja entra por donde se irá |
| Muelles, no cronómetros | La física decide la duración; si se interrumpe, el movimiento cambia de rumbo conservando la velocidad |
| Deferencia | La interfaz se aparta; el color lo pone la carátula |
| Contención | Una animación por intención. Rebote solo en momentos de gozo (favorito, descarga terminada, isla) |
| Accesible por defecto | «Reducir movimiento» convierte los desplazamientos en fundidos; nada depende de ver algo moverse |

**Lo que es nuestro:** el oliva carbón, la arena y la salvia; Plus Jakarta Sans para
títulos e Inter para leer (SF Pro no se puede usar fuera de los sistemas de Apple);
bordes finos color arena y sombras profundas.

**Lo que no haremos:** parallax decorativo, destellos (*shimmer*) en las cargas,
rebotes en todo, desenfoques grandes en el móvil, animaciones de más de medio
segundo en una interacción.

### 2.2 Muelles descritos como en Apple

Cada muelle se define por dos números: la **duración percibida** y el **rebote**.
Es la misma parametrización que usa SwiftUI desde iOS 17 y la que presentó Apple
en *Animate with springs* (WWDC 2023). Con masa 1:

```
rigidez        k = (2π / duración)²
amortiguación  c = 4π · (1 − rebote) / duración
```

| Token | Nombre | Duración percibida | Rebote | k | c | Se asienta en | Sobrepaso | Uso |
|---|---|---|---|---|---|---|---|---|
| `--spring-smooth` | suave | 0,45 s | 0 | 195,0 | 27,93 | 683 ms | 0 % | Vistas, hojas, transformación, desplazamientos |
| `--spring-snappy` | ágil | 0,30 s | 0,15 | 438,6 | 35,60 | 433 ms | 0,5 % | Pulsaciones, controles, indicadores, volver a su sitio |
| `--spring-bouncy` | vivo | 0,50 s | 0,32 | 157,9 | 17,09 | 833 ms | 5,3 % | Favorito, isla, carátula al reproducir |

En CSS, cada muelle es una curva `linear()` con un punto cada 1/60 s (42, 27 y
51 puntos) y dura lo que tarda en asentarse. Para lo que sigue al dedo hace falta
un muelle con velocidad inicial, que CSS no tiene: eso lo hace el motor en
JavaScript (§2.3). **Los dos se calculan con la misma función**, así que una
transición CSS y un gesto se sienten igual.

| Alternativa | Veredicto |
|---|---|
| Seguir con `cubic-bezier` y retocar duraciones | ❌ No hay velocidad ni interrupción natural: es D1 |
| Calcular `linear()` en tiempo de ejecución, como el laboratorio | ❌ Un parpadeo de curvas de respaldo en el primer fotograma y código que no hace falta en producción |
| **Curvas generadas por un script y escritas en `styles.css`, con un test que comprueba que coinciden con la física** | ✅ **Elegida**: cero coste en tiempo de ejecución y nadie puede editarlas a mano sin que salte un test |

### 2.3 Motor propio, no una biblioteca

| Alternativa | Veredicto |
|---|---|
| `motion` (antes Framer Motion / Motion One), `popmotion` | Resuelven esto y más, pero añaden una dependencia para unas 150 líneas de física, y sus muelles no se describen con los mismos dos números que los tokens CSS |
| **Motor propio de ~150 líneas en `src/ui/motion/spring.js`** | ✅ **Elegido**: la misma función que genera los tokens, sin dependencias, con un planificador inyectable para los tests. Es el del laboratorio, ya probado |

### 2.4 Entradas y salidas: un único ayudante de presencia

Hoy mostrar es quitar `hidden`, y ocultar es ponerlo: no hay estado intermedio
donde animar. La propuesta es un estado explícito en `data-presence`:

```
          show()                    (fin de transición)
 oculto ─────────► entering ──────────────────────► shown
   ▲                  │  hide() a mitad: se invierte    │
   │                  ▼                                  │ hide()
   └──── (fin) ─── leaving ◄─────────────────────────────┘
```

| Alternativa | Veredicto |
|---|---|
| `@starting-style` + `transition-behavior: allow-discrete` (CSS puro) | Elegante y ya soportado en Chrome 117+, Safari 17.5+ y Firefox 129+, pero no devuelve una promesa al terminar, que es lo que necesitan `NavigationModule`, el foco y las pruebas |
| View Transitions API | Pensada para cambios de página enteros y sin muelles con velocidad |
| `<dialog>` y `popover` nativos | Buen destino a largo plazo para los modales; cambian el marcado y la gestión del foco: **fuera de este plan** |
| **`presence.show(el)` / `presence.hide(el)` que devuelven una promesa** | ✅ **Elegido**: CSS pone las poses; el ayudante gestiona `hidden`, el estado, las interrupciones y el respaldo por tiempo si `transitionend` no llega |

### 2.5 La transformación del reproductor

La carátula es el **elemento compartido**. Todo lo demás se ordena a su alrededor:

| Qué | Cómo |
|---|---|
| Carátula | Un clon vuela del rectángulo del mini reproductor (`#playerThumb`) al de la carátula grande (`#fullPlayerThumb`) con **FLIP**: se coloca con el tamaño final y se anima un `transform` de la pose inicial a la identidad. Solo `transform`, nunca `width` o `top` |
| Radio | Se anima a la vez y se divide por la escala en cada fotograma, para que no se deforme al escalar |
| Fondo del reproductor | Opacidad `min(1, 1,6 p)`: llega antes que la carátula |
| Cabecera, título, barra y controles | Aparecen desde `p = 0,35`, con opacidad y 16 px de desplazamiento |
| Mini reproductor | Se desvanece con `min(1, 2 p)` |
| Progreso `p` | Un único muelle suave de 0 a 1. **Cerrar a mitad invierte el mismo muelle con su velocidad**: no se bloquea nada mientras vuela |

Se usa la imagen de la carátula grande para el clon, porque escalar hacia arriba
la miniatura la haría borrosa. En escritorio es la misma idea: el reproductor
ocupa el área principal (`left: 240px`) y la carátula sale de la barra inferior.

### 2.6 El material: cristal esmerilado tirando a cristal

Un punto intermedio entre los tres materiales y el cristal del laboratorio, más
cerca del cristal. Conserva el borde especular y la saturación del cristal, pero
con algo más de tinte y desenfoque, para que el texto se lea siempre, y un grano
muy fino que le da el aspecto esmerilado.

| Grosor | Token | Tinte (`rgba(16,20,16,·)`) | Desenfoque | Saturación | Brillo | Para qué |
|---|---|---|---|---|---|---|
| Fino | `--glass-thin-*` | 0,22 | 12 px | 180 % | 1,04 | Barras que cruzan contenido: cabecera móvil al hacer scroll |
| Normal | `--glass-regular-*` | 0,32 | 18 px | 190 % | 1,05 | Lo que flota: mini reproductor, barra de pestañas, banners, menús desplegables |
| Grueso | `--glass-thick-*` | 0,50 | 28 px | 180 % | 1,03 | Lo que hay que leer entero: hojas, modales, panel de la cola |

Común a los tres:

| Capa | Valor |
|---|---|
| Luz de superficie | `linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.015))` |
| Borde especular | anillo de 1 px con `linear-gradient(135deg, rgba(255,255,255,.42), rgba(255,255,255,.05) 30%, rgba(255,255,255,.02) 70%, rgba(255,255,255,.22))` |
| Brillo interior | `inset 0 1px 0 rgba(255,255,255,.18)` |
| Grano | ruido fractal en un `data:` SVG, opacidad 0,035, fusión `soft-light` |

Comparado con lo que se vio en el laboratorio:

| | Materiales | **Esmerilado (elegido)** | Cristal |
|---|---|---|---|
| Tinte del normal | 0,55 | **0,32** | 0,18 + luz blanca |
| Desenfoque del normal | 26 px | **18 px** | 9 px |
| Borde especular | no | **sí, suave** | sí, fuerte |
| Grano | no | **sí** | no |

**Degradación:**
- «Reducir transparencia» → superficies opacas `#151A15` con el mismo borde.
- Equipos modestos (`navigator.deviceMemory ≤ 4` o `hardwareConcurrency ≤ 4`) → `html[data-glass="lite"]`: la mitad de desenfoque, sin grano y con la saturación al 140 %.

La isla de descarga **no** es de cristal: es negra, como la de verdad.

### 2.7 Hápticos con intención

Solo en la APK (`@capacitor/haptics`). En la web no se usan: `navigator.vibrate`
es tosco y en iPhone no existe.

| Momento | Háptico |
|---|---|
| Cambiar de pestaña · cruzar el umbral al deslizar · coger una fila para reordenar | selección |
| Marcar favorito · reproducir/pausar · soltar al reordenar · añadir a la cola | impacto ligero |
| Descarga terminada | éxito |
| Descarga fallida | error |
| Cerrar una hoja arrastrando | impacto ligero |

### 2.8 «Reducir movimiento»

Los gestos **siguen al dedo** igual: son manipulación directa, no animación. Lo que
cambia es lo que ocurre solo:

| Animación | Con «Reducir movimiento» |
|---|---|
| Transformación del reproductor | Fundido de 180 ms, sin clon |
| Hojas y modales | Fundido de 150 ms, sin desplazamiento |
| Isla y banner | Aparecen ya abiertos, con fundido |
| Carátula que respira | Sin escala |
| Letras | Sin desenfoque; salto directo a la línea |
| Filas que entran y salen | Fundido; sin cambio de altura animado |
| Pulsación | Oscurecimiento en lugar de escala |
| Muelles de JavaScript | `to()` salta al destino y resuelve su promesa |

### 2.9 Presupuesto de rendimiento

- Solo se animan `transform`, `opacity` y, en las letras, `filter`. Nunca `width`,
  `height`, `top`, `left` ni `box-shadow`. La excepción controlada es la altura
  de las filas que entran y salen (T14), que se limita a listas visibles de
  hasta 20 cambios.
- Como mucho **tres superficies con desenfoque de fondo** visibles a la vez en el
  móvil: mini reproductor, barra de pestañas y cabecera. Las hojas y los banners
  son pasajeros.
- `will-change` solo mientras dura el vuelo, nunca fijo.
- Objetivo: **60 fps en un Android de gama media**, medido con la depuración
  remota de Chrome sobre la APK (§5).

---

## 3. Alcance

**Dentro:** `styles.css`, `app.js` (reproductor, `QueueManager`, listas, modales,
navegación, letras), `index.html` (marcado de iconos y modales), módulos nuevos en
`src/ui/`, `test/`, `playwright.config.js`, `.github/workflows/ci.yml`, y en la APK
`mobile/package.json` y `mobile/android/.../styles.xml`.

**Fuera:**
- Rediseñar pantallas o cambiar qué hace la app. Solo movimiento, respuesta y materiales.
- Modo claro: la app es oscura y lo sigue siendo.
- Migrar los modales a `<dialog>`/`popover` (§2.4): candidato a un plan futuro.
- La extracción de módulos del plan 08: aquí solo nace código nuevo en `src/ui/`.
- iOS: no hay objetivo iOS en Capacitor.
- Sonidos de interfaz.

---

## 4. Tareas

### Bloque A — Cimientos

Apenas cambia lo que se ve, pero todo lo demás se apoya aquí.

#### T1 · Infraestructura: módulos en `src/ui/`, arnés y Playwright

**Ficheros:** `src/ui/motion/` (nuevo), `app.js` (cabecera), `test/frontend/harness.mjs`,
`playwright.config.js`, `.github/workflows/ci.yml`, `server.py` (comentario de `PUBLIC_FILES`)

**Qué hacer**

1. Crear la estructura del plan 08 para lo nuevo:
   ```
   src/ui/motion/spring.js      física, tokens y motor de muelles
   src/ui/motion/presence.js    entradas y salidas
   src/ui/motion/gesture.js     arrastre, goma y velocidad
   src/ui/motion/flight.js      el vuelo de un elemento compartido (FLIP)
   src/ui/haptics.js            puente a @capacitor/haptics
   src/ui/palette.js            colores de una carátula
   ```
   Módulos ES sin efectos al importarse: nada toca el DOM hasta que se llama a
   una función.
2. Importar desde `app.js`, que ya se carga con `type="module"`:
   ```js
   import { Spring, prefersReducedMotion } from './src/ui/motion/spring.js';
   ```
   Cuando el plan 08 mueva `app.js` a `src/legacy/`, las rutas pasan a
   `'../ui/…'`: es un cambio de una línea por import.
3. **Arnés de tests.** Hoy carga `app.js` con `vm.runInContext` como si fuera un
   script: con un `import` dentro, los 155 tests de frontend dejarían de cargar.
   El arnés tiene que resolver los `import` de `app.js` antes de ejecutarlo:
   leer cada módulo importado, quitarle las palabras `export`, envolverlo en una
   función que devuelva sus exportaciones y anteponer
   `const { A, B } = (() => { …código del módulo…; return { A, B }; })();`.
   Si un módulo importa a otro, se resuelve igual, en orden de dependencias y sin
   repetir ninguno. Así los módulos viven en el mismo *realm* que `app.js` y ven
   su `window` y su `document` simulados. Los tests de los propios módulos no
   pasan por el arnés: los importan directamente en Node.
4. **Playwright siempre contra un bundle recién hecho.** El servidor sirve
   `dist/` si existe y, si no, el `index.html` de la raíz con `app.js` sin
   empaquetar. Con `import` de `src/` ese respaldo ya no funciona, porque
   `PUBLIC_FILES` no publica `src/`, ni debe. Y un `dist/` viejo ya nos engañó
   una vez con la tarjeta de descarga. Por eso:
   - `playwright.config.js`: `webServer.command` pasa a ser `npm run build && python3 server.py`.
   - `ci.yml`, job de Playwright: se queda como está, porque el comando ya compila.
   - `server.py`: actualizar el comentario de `PUBLIC_FILES`. `app.js` solo lo
     necesita el `index.html` sin compilar, que deja de ser una ruta soportada.

**Por qué** Sin el punto 3 se pierde la red de tests en el primer commit, y sin el
punto 4 las pruebas en navegador verían código viejo sin avisar.

**Verificación** `node --test test/frontend/*.mjs` sigue con 155 tests en verde
con un `import` real en `app.js`, y `npx playwright test` compila antes de probar.

#### T2 · Tokens de muelles y motor

**Ficheros:** `src/ui/motion/spring.js`, `scripts/generate-springs.mjs` (nuevo), `styles.css` (`:root`)

**Qué hacer**

1. `spring.js` exporta:
   ```js
   export const SPRINGS = {
     smooth: { duration: 0.45, bounce: 0 },
     snappy: { duration: 0.30, bounce: 0.15 },
     bouncy: { duration: 0.50, bounce: 0.32 },
   };
   export function physics({ duration, bounce })      // → { stiffness, damping }
   export function springToLinear(preset)              // → { easing: 'linear(…)', durationMs }
   export class Spring {
     constructor({ value, preset = 'smooth', onUpdate, precision = 0.01 })
     to(target, { preset, velocity } = {})             // → Promise que resuelve al asentarse
     jump(value)                                       // sin animación
     stop()                                            // se queda donde está, velocidad 0
     get value(); get velocity();
   }
   export const scheduler = { now, request, cancel };  // inyectable en los tests
   export function prefersReducedMotion()             // matchMedia en vivo
   ```
   Integración semi-implícita con paso de 1/600 s y `dt` limitado a 1/30 s, para
   que una pestaña en segundo plano no produzca saltos. Con «Reducir movimiento»,
   `to()` salta al destino.
2. `scripts/generate-springs.mjs` importa `springToLinear` y reescribe en
   `styles.css` el bloque entre `/* springs:begin */` y `/* springs:end */`:
   ```css
   --spring-smooth: linear(0, 0.0176, 0.0641, …, 1);
   --spring-smooth-duration: 683ms;
   ```
   Lo mismo para `snappy` y `bouncy`, más un bloque `@supports not
   (transition-timing-function: linear(0, 1))` con respaldos `cubic-bezier`. Se
   ejecuta con `npm run springs`.
3. Tokens de fundido para lo que no se desplaza: `--fade-fast: 150ms` y `--fade: 220ms`.
4. `--transition-smooth` y `--transition-fast` desaparecen. Sus usos pasan a
   propiedades explícitas en T4.
5. Ayuda para depurar: si `localStorage['motion-debug-slow']` vale `4`, el motor y
   una variable `--motion-slow` multiplican el tiempo por 4, como el mando del
   laboratorio. No afecta a nadie que no lo active.

**Por qué** Es D1. Un sistema de tres muelles con nombre sustituye a una curva y
doce duraciones.

**Verificación** El test de T23 recalcula las tres curvas y las compara con el
bloque de `styles.css`.

#### T3 · Presencia: entradas y salidas animables

**Ficheros:** `src/ui/motion/presence.js`, `app.js` (`NavigationModule.pushOverlayState`,
`closeOverlay` y las funciones que abren modales), `styles.css`

**Qué hacer**

1. API:
   ```js
   export function show(el, { reduced } = {})   // → Promise<void>
   export function hide(el, { reduced } = {})   // → Promise<void>; deja el.hidden = true al final
   export function isShown(el)
   ```
   `show` quita `hidden`, pone `data-presence="entering"` y, en el fotograma
   siguiente, `shown`. `hide` pone `leaving` y, cuando llega `transitionend` de
   `opacity` o `transform`, `hidden = true`. Tiene un respaldo por tiempo: la
   duración calculada más 50 ms. Si llega un `hide` durante `entering`, cambia
   el estado y la transición CSS se invierte sola desde donde esté.
2. CSS por tipo de pieza: la pose de entrada en `[data-presence="entering"]` y en
   `[data-presence="leaving"]`, y la de reposo en `[data-presence="shown"]`.
3. **Refinado al implementar.** Los 13 modales se abren y cierran desde 28 sitios
   distintos con `.hidden`. En vez de cambiar cada uno, entran con
   `@starting-style` y salen con `transition: display … allow-discrete`, que
   mantiene el `display` vivo mientras dura la salida. Es CSS puro, anima todos
   los sitios existentes sin tocarlos, y como `.hidden` se sigue poniendo al
   instante, «¿hay un modal abierto?» (`NavigationModule.goBack`) se responde
   igual que antes. Medido en Chromium: a los 40 ms de cerrar, el modal sigue
   visible desvaneciéndose; a los 440 ms, `display: none`.
4. `presence.show` y `presence.hide` quedan para las piezas que otro código
   tiene que esperar: la isla y los banners (T13), la vista de detalle (T18) y
   las hojas que se cierran arrastrando (T17). Botones y mensajes de vacío siguen
   con `hidden`.

**Por qué** Es D3. Sin un estado intermedio no hay animación de salida posible.

**Verificación** Abrir y cerrar cada modal con el botón, con el fondo, con Escape
y con el botón atrás de Android: siempre se ve la salida y nunca quedan dos
abiertos.

#### T4 · Transiciones explícitas y pulsación en todo lo pulsable

**Ficheros:** `styles.css`

**Qué hacer**

1. Las 65 `transition: all` pasan a enumerar lo que cambia de verdad en sus
   estados `:hover`, `:active` o `.active`. Casi siempre es
   `background-color, border-color, color` con `var(--fade-fast)`, y `transform`
   con `var(--spring-snappy)` cuando hay escala.
2. Fuera los 9 `:hover` con `translateY`: `.result-item`, `.select-btn`,
   `.playlist-item`, `.history-item`, `.playlist-card`, `.add-playlist-option`,
   `.download-apk-final-btn` (y su `svg`) y `.lyrics-back-to-player-btn`. Al
   pasar el ratón solo cambia el fondo o el borde.
3. Pulsación: tres escalas según el tamaño.
   ```css
   .press-sm { --press: 0.90 }  /* botones de icono */
   .press    { --press: 0.96 }  /* botones */
   .press-lg { --press: 0.98 }  /* filas y tarjetas */
   :is(.press-sm, .press, .press-lg) {
     transition: transform var(--spring-snappy-duration) var(--spring-snappy);
   }
   :is(.press-sm, .press, .press-lg):active {
     transform: scale(var(--press));
     transition-duration: 90ms;   /* hundirse es inmediato; volver, con muelle */
   }
   ```
   Se aplica a `.download-btn`, `.nav-btn`, los controles del reproductor, los
   de la barra, `.library-item`, `.playlist-card`, `.result-item` y los botones
   de los modales.
4. `-webkit-tap-highlight-color: transparent` en `html`. Hoy solo está en un selector.

**Por qué** Son D2 y D6.

**Verificación** El test estático de T23 no encuentra `transition: all` ni
`:hover` con `translateY`. Al pulsar en el móvil se ve el hundimiento.

#### T5 · «Reducir movimiento» y «Reducir transparencia»

**Ficheros:** `styles.css`, `src/ui/motion/spring.js`, `presence.js`

**Qué hacer**

1. `@media (prefers-reduced-motion: reduce)`: las transiciones con `transform`
   pasan a `opacity` con `var(--fade-fast)`, y las poses de entrada y salida
   pierden el desplazamiento y la escala. Aplica la tabla de §2.8 pieza a pieza.
2. En JavaScript, `prefersReducedMotion()` escucha el cambio en vivo. `Spring.to`
   salta, `presence` hace fundido y el vuelo de la carátula no se lanza.
3. `@media (prefers-reduced-transparency: reduce)`: los tokens de cristal pasan a
   ser opacos (§2.6). Donde el navegador no exponga esta preferencia, no pasa nada.
4. «Eliminar animaciones» de Android llega a la WebView como
   `prefers-reduced-motion`: se comprueba en un dispositivo real.

**Por qué** Es D4, y la tabla de §2.8 es la que hace que el plan sea accesible y
no solo bonito.

**Verificación** Recorrido E2E con `emulateMedia({ reducedMotion: 'reduce' })`
(T23), y prueba manual en Android con «Eliminar animaciones».

#### T6 · Detalles que rompen la ilusión

**Ficheros:** `app.js`, `index.html`, `styles.css`, `public/` (banderas)

**Qué hacer**

1. **D15:** `download_btn` pasa a `'Descargar {format}'`, y sus equivalentes en
   los 6 idiomas, con `i18n.t('download_btn', { format })`. Se actualiza al
   cambiar el selector de formato y al cambiar de idioma. `subtitle` deja de
   nombrar un formato: «Descarga tu música favorita».
2. **D16:** quitar la creación de `debug-env-label` y su actualización en
   `updateEnvironment`.
3. **D14:** `window.PlayerModule` pasa a `PlayerModule` en `renderLyrics`. El test
   de guardas se amplía para que `window.X` cuente igual que `globalThis.X` (T23).
4. **D13:** las letras sin sincronizar dejan de usar la clase `past` y pasan a
   opacidad 0,75.
5. **D17:**
   - El emoji ☕ (`index.html`, líneas 35 y 164) pasa a un icono SVG de línea.
   - Las 6 banderas pasan a SVG locales en `public/flags/`: dejan de ser una
     petición a un tercero y se ven sin conexión.
   - Borrar las reglas de `.full-player.lyrics-mode` y la franja base de 72 px de
     `.lyrics-section`, tras confirmar con `grep` que nada añade esa clase.
   - El nombre de la app queda pendiente de tu decisión.

**Por qué** Son pocas líneas y cada una rompe, por sí sola, la sensación de
producto cuidado.

**Verificación** Con M4A elegido, el botón dice «Descargar M4A» en los 6
idiomas. Tocar una línea de una letra sincronizada salta a ese momento. Sin
conexión se ven las banderas.

### Bloque B — Reproductor

El momento estrella.

#### T7 · La transformación: del mini reproductor al completo

**Ficheros:** `src/ui/motion/flight.js`, `app.js` (`PlayerModule.showFullPlayer` y
`hideFullPlayer`, ~5254), `styles.css` (`.full-player`)

**Qué hacer**

1. `flight.js`:
   ```js
   // Vuela un clon de `from` a `to` mientras un muelle recorre p ∈ [0, 1].
   export function fly({ from, to, source, radiusFrom, radiusTo, onProgress, spring })
   // → { promise, reverse() }  reverse() invierte el mismo muelle con su velocidad
   ```
2. Abrir:
   1. Medir `#playerThumb`.
   2. Mostrar el reproductor con `data-presence="flying"`: fondo y controles a
      opacidad 0, carátula real oculta.
   3. Medir `#fullPlayerThumb` ya colocado. Si está en pausa, su rectángulo ya
      incluye la escala 0,82 de T9.
   4. Crear un `<img>` con la carátula grande, `position: fixed` y el tamaño
      final, y animar `transform: translate() scale()` desde la pose del mini
      reproductor hasta la identidad. El radio va de 6 a 12 px, dividido por la
      escala en cada fotograma.
   5. Aplicar las opacidades de §2.5 a fondo, controles y mini reproductor.
   6. Al asentarse, quitar el clon y mostrar la carátula real.
3. Cerrar: lo mismo en sentido inverso. Si se cierra **durante** la apertura, se
   llama a `reverse()`: el muelle da la vuelta con la velocidad que llevaba.
   Cerrar con el botón atrás de Android (`NavigationModule`) usa el mismo camino.
4. Escritorio: el origen es la carátula de la barra inferior y el destino, el
   centro del área principal.
5. Si el mini reproductor no está visible, se hace un deslizamiento hacia abajo
   con el muelle suave.
6. «Reducir movimiento»: fundido de 180 ms sin clon.

**Por qué** Es D5, la continuidad más literal que se puede ofrecer: se ve de
dónde sale todo.

**Verificación** Recorrido E2E (T23), y a cámara lenta con `motion-debug-slow`:
la carátula no se deforma y abrir y cerrar a mitad no produce saltos.

#### T8 · Arrastrar hacia abajo para cerrar (móvil)

**Ficheros:** `src/ui/motion/gesture.js`, `app.js` (`PlayerModule`), `styles.css`

**Qué hacer**

1. `gesture.js`:
   ```js
   export function rubberBand(overshoot, dimension, constant = 0.55)
   // (1 − 1 / (overshoot · constant / dimension + 1)) · dimension
   export function velocityFrom(samples, windowMs = 80)          // px/s
   export function trackVerticalDrag(el, { canStart, onMove, onEnd })
   ```
2. **Convivir con el *scroll snap* de las letras.** `.full-player-content` hace
   scroll vertical hasta la vista de letras. El arrastre para cerrar **solo empieza**
   si `scrollTop === 0` y el primer movimiento es hacia abajo; si no, el gesto es
   del scroll. Se usan `touchstart`/`touchmove` con `{ passive: false }` y
   `preventDefault()` solo cuando el arrastre ya es nuestro. Los *pointer events*
   no sirven aquí: con `touch-action: pan-y` el navegador cancela el puntero en
   cuanto decide desplazar.
3. Mientras se arrastra: el reproductor sigue al dedo 1:1 y el radio de sus
   esquinas crece hasta 28 px. Hacia arriba, `rubberBand` con dimensión 90 px.
4. Al soltar: cierra si `velocidad > 550 px/s` o si el desplazamiento supera el
   28 % de la altura. Si cierra, se desliza hacia abajo con esa velocidad inicial
   y el mini reproductor reaparece con fundido. Si no, vuelve con el muelle ágil
   y la velocidad de soltar. Impacto ligero al cerrar.
5. Escritorio: sin arrastre. **Escape cierra el reproductor**, que hoy no lo hace.

**Por qué** Es D5. Cerrar con el pulgar donde está es lo natural en el móvil;
alcanzar la flecha de arriba, no.

**Verificación** E2E con toques emulados por CDP (T23). En un dispositivo: desde
la vista de letras, deslizar hacia abajo desplaza las letras y no cierra.

#### T9 · Carátula que respira y reproducir/pausar

**Ficheros:** `app.js` (`PlayerModule`), `styles.css`

**Qué hacer**

1. Escuchar `play` y `pause` del propio `<audio id="mainAudio">`, que es la fuente
   de verdad y cubre también la pantalla de bloqueo y MediaSession. No escuchar
   los clics.
2. `#fullPlayerThumb`: escala 1 con el muelle vivo al reproducir y 0,82 con el
   suave al pausar. Una variable `--shadow` (0 a 1) acompaña a la escala.
3. Icono de reproducir/pausar: los dos glifos superpuestos; el saliente escala a
   0,6 y se desvanece, y el entrante crece desde 0,6 con el muelle ágil. Un
   *morph* de trazado real exigiría dos formas con los mismos puntos, y esto se
   percibe igual.
4. Impacto ligero en la APK.

**Por qué** Es el detalle más reconocible de Apple Music, y cuesta muy poco.

**Verificación** E2E: al pausar, la escala calculada de la carátula se asienta en 0,82.

#### T10 · Barras que engordan al agarrarlas

**Ficheros:** `styles.css`, `app.js` (`#fullPlayerSeek`, `#playerSeek`, `#playerVolume`)

**Qué hacer**

1. Al pulsar (`pointerdown`), el contenedor recibe `.is-scrubbing`: la pista se
   escala `scaleY(2.5)` con el muelle ágil y los tiempos pasan de 0,6 a 1 de
   opacidad. Al soltar, vuelve. Es solo `transform`: no mueve el layout.
2. El tirador del `input range` se hace invisible, como en Apple Music: la pista
   gruesa es el tirador.
3. Lo mismo para el volumen en escritorio.
4. Cifras tabulares en los tiempos (T22).

**Verificación** Arrastrar la barra: engorda, el tiempo sigue al dedo y nada de
alrededor se mueve.

#### T11 · Fondo con el color de la carátula

**Ficheros:** `src/ui/palette.js`, `app.js` (`PlayerModule`, donde hoy se pone
`fullPlayerBg.style.backgroundImage`), `styles.css` (`.full-player-bg`)

**Qué hacer**

1. `palette.js`:
   ```js
   export function extractPalette(pixels /* Uint8ClampedArray RGBA */, k = 3)
   // → [c1, c2, c3]: los k colores dominantes (k-means, 8 iteraciones, sobre 24×24)
   export async function paletteFromImage(src)    // canvas de 24×24; null si falla
   export const FALLBACK = ['#DFCDAC', '#6F8F6A', '#1A201A'];
   ```
   `c3` se oscurece hasta una luminancia de ≤ 0,08 para que sea el fondo.
2. **Origen de la imagen.** En la APK, `song.thumbnail` ya es un `data:` en base64
   (`offlineBase64Thumb`), así que se lee sin restricciones. En la web es una URL
   de `i.ytimg.com`, que responde con `access-control-allow-origin: *`
   (comprobado el 24-09-2026): se carga con `crossOrigin = 'anonymous'` y el
   canvas no queda contaminado. Si aun así falla, se usa `FALLBACK`.
3. Sustituir el `filter: blur(80px)` de `.full-player-bg` por las capas del
   laboratorio (`radial-gradient` con `--art-c1`, `--art-c2` y un
   `linear-gradient` a `--art-c3`), más el oscurecido de legibilidad.
4. Al cambiar de canción: dos capas superpuestas y fundido cruzado de 600 ms con
   el muelle suave.
5. Caché en memoria de las paletas por `videoId` (LRU de 50).
6. La paleta alimenta también la barra de estado de la APK (T20).

**Por qué** Es más fiel a la carátula que una imagen desenfocada y se ahorra el
efecto más caro de toda la app en Android (D7).

**Verificación** Test unitario de `extractPalette` con imágenes sintéticas (T23).
En la APK, sin conexión, el fondo toma el color de una canción descargada.

#### T12 · Letras con profundidad

**Ficheros:** `app.js` (`LyricsModule.updateActiveLine`, `renderLyrics`), `styles.css`
(`.full-player-lyrics-view .lyrics-line`)

Lo que ya funciona se queda: letra grande (1,25 rem; 1,4 rem en el móvil), varias
líneas y pausa del auto-desplazamiento durante 5 s cuando el usuario desplaza a
mano.

**Qué hacer**

1. Sustituir `scrollIntoView({ behavior: 'smooth', block: 'center' })` por un
   muelle suave sobre `lyricsSection.scrollTop`, que deja la línea activa al
   35 % de la altura. Mover solo el `scrollTop` de la sección evita arrastrar el
   contenedor con *scroll snap* del reproductor (D12).
2. Profundidad por distancia `d` a la línea activa: opacidad 1 en la activa;
   0,45, 0,32 y 0,22 a partir de `d = 3`; desenfoque de `0,6 px × min(d, 3)`
   **solo en las ±4 líneas cercanas**, por coste; escala 0,97 con origen a la
   izquierda en las inactivas.
3. Fuera el `text-shadow` de la activa y la `transition: all .28s`: pasan a
   `opacity`, `transform` y `filter` con el muelle suave.
4. Alineación a la izquierda también en el móvil (pendiente de tu visto bueno).
5. Salto al tocar: arreglado en T6. Se añade un leve pulso de la línea tocada.
6. «Reducir movimiento»: sin desenfoque y salto directo.

**Verificación** E2E con la respuesta de `lrclib.net` interceptada con
`page.route` (T23): tocar una línea cambia `currentTime`, y la línea activa queda
a un 35 % ± 5 % de la altura.

### Bloque C — Avisos, listas y navegación

#### T13 · Isla en el móvil y banner en el escritorio

**Ficheros:** `app.js` (`QueueManager`, ~4756-4990), `src/ui/motion/presence.js`, `styles.css`
(`.queue-panel`, `.queue-card` y los estilos nuevos)

**Qué hacer**

1. `QueueManager` se queda con el **estado**: añadir, actualizar, completar,
   cancelar, fallar. La **vista** se delega en `IslandView` o
   `BannerStackView`, según `matchMedia('(max-width: 767px)')`, en vivo.
2. **Isla** (móvil):
   - Cápsula negra centrada en `top: calc(env(safe-area-inset-top) + 8px)`.
   - Reposo de 96 × 30 px; se expande a `100% − 20px` × 64 px con el muelle vivo
     en ancho y alto, y el contenido aparece a los 90 ms.
   - Muestra carátula, título, «Descargando · 42 %» con cifras tabulares y un
     anillo SVG cuyo `stroke-dashoffset` avanza con el muelle suave.
   - Con varias descargas: «3 descargas · 58 %» y hasta tres carátulas solapadas.
     Tocar la isla la despliega en una lista con el botón de cancelar de cada
     una, que sustituye a la X de las tarjetas.
   - Al terminar, el anillo se convierte en un check dibujado en 360 ms, suena el
     háptico de éxito y la isla se recoge tras 1,3 s. Si falla, el anillo pasa a
     arcilla, se lee «Error» y suena el háptico de error.
3. **Banners** (escritorio):
   - 320 px en la esquina superior derecha, de cristal grueso.
   - Entran desde x = +340 con el muelle ágil y los nuevos se colocan arriba; los
     demás bajan con el mismo muelle.
   - Como mucho tres visibles, más una píldora «+2 más».
   - Al pasar el ratón se detiene el cierre automático y aparece el botón de
     cancelar.
   - Al terminar, el icono pasa a check con el muelle vivo y el banner se va a
     los 1,8 s.
4. Desaparecen `entering`, `leaving` y `pending` (D8), sustituidas por `presence`.
5. Una región `aria-live="polite"` anuncia el inicio y el final de cada descarga.

**Por qué** Es D8. En el móvil, una tarjeta ancha tapa la cabecera; la isla
informa sin quitar sitio.

**Verificación** Los recorridos 8 y 9 se adaptan a los selectores nuevos, y hay
uno nuevo para dos descargas simultáneas en escritorio (T23).

#### T14 · Filas que entran y salen

**Ficheros:** `app.js` (`LibraryModule.render`, `removeSong`, `PlaylistModule.renderPlaylistSongs`,
`renderQueuePanel`), `src/ui/motion/flight.js` (FLIP de listas)

**Qué hacer**

1. Antes de repintar, guardar los rectángulos por `data-id`. Después, las filas con
   un id nuevo **entran**: la altura va de 0 a la medida, con el muelle suave, y
   la opacidad desde 0. Las que ya estaban y han cambiado de sitio se mueven:
   se aplica la diferencia como `translateY` y vuelve a 0 con el muelle suave.
2. `removeSong`: la cadena `setTimeout(50)` → `setTimeout(350)` con `max-height`
   pasa a un muelle de altura a 0 más opacidad, y la fila se quita al asentarse.
   Nada de temporizadores.
3. Límites: solo si la lista está visible y cambian 20 filas o menos. Si no, sin
   animación.
4. Primera vez que se abre una vista en la sesión: aparición escalonada de 25 ms
   entre filas, hasta 8 filas, con 8 px de desplazamiento y fundido.

**Verificación** E2E: tras una descarga, la fila nueva existe y llega a su altura;
al borrar, desaparece en menos de 1 s. Con 30 cambios no se anima nada.

#### T15 · Deslizar para añadir a la cola

**Ficheros:** `app.js` (`initSwipeEvents`, ~7515, y `handleSongSwipeAddToQueue`), `src/ui/motion/gesture.js`

**Qué hacer**

1. Pasar a *pointer events*, para que funcione también con ratón, con
   `touch-action: pan-y` en la fila. Aquí el gesto es horizontal, así que el
   problema de T8 no aplica.
2. Hasta el umbral de 120 px, uno a uno. A partir de ahí,
   `120 + rubberBand(d − 120, 70)`. Se mantiene la exclusión de los 30 px del
   borde, que respeta el gesto atrás de Android.
3. Al cruzar el umbral, el icono salta desde 0,55 con el muelle vivo y suena el
   háptico de selección.
4. Al soltar: se añade a la cola si `d ≥ 120` o si
   `velocidad > 900 px/s y d > 50`. La fila vuelve con el muelle ágil,
   conservando la velocidad solo si ya iba de vuelta.
5. `navigator.vibrate(30)` pasa a impacto ligero (T19).

#### T16 · Reordenar

**Ficheros:** `app.js` (`new Sortable`, ~6799), `styles.css`

**Qué hacer**

1. `easing`: la curva `linear()` del muelle ágil. Sortable la aplica tal cual a
   sus transiciones CSS. `animation`: 433, el tiempo que tarda en asentarse.
2. `.sortable-chosen` y `.sortable-fallback`: escala 1,03, sombra profunda y
   cristal normal. `.sortable-ghost`: opacidad 0,35.
3. `onStart` con háptico de selección y `onEnd` con impacto ligero.

**Por qué** Es D11: la curva actual acelera al llegar.

#### T17 · Hojas en el móvil y modales en el escritorio

**Ficheros:** `styles.css`, `app.js` (apertura de los modales), `src/ui/motion/gesture.js`

**Qué hacer**

1. Clasificar los 13 modales y hojas (anexo C):
   - **Hojas:** contenido, formularios y listas.
   - **Alertas:** confirmaciones de una o dos opciones.
2. **Móvil, hojas:**
   - Anclada abajo, esquinas superiores de 20 px, asa arriba y cristal grueso.
   - Entra desde `translateY(100%)` con el muelle suave, con el fondo oscurecido
     al 40 % y **sin desenfoque**, que en el móvil es caro.
   - Se cierra arrastrando, con la misma lógica que T8 y sin el problema del
     *scroll*: el arrastre empieza en el asa o cuando el contenido está arriba del
     todo. Impacto ligero al cerrar.
3. **Móvil, alertas:** centradas, de escala 0,92 a 1 más fundido, con el muelle ágil.
4. **Escritorio, todo:** centrado, de escala 0,96 a 1 más fundido, con un fondo
   oscurecido y desenfocado 8 px.
5. Foco: al abrir va al primer control y al cerrar vuelve a quien lo abrió.
   Mantener el foco dentro mientras está abierto (hoy no se hace).

#### T18 · Navegación

**Ficheros:** `app.js` (`NavigationModule.switchView`, `PlaylistModule.openPlaylistDetail`), `styles.css`

**Qué hacer**

1. **Pestañas:** el contenido sigue cambiando **al instante**, como en iOS. Se
   añade un indicador de la pestaña activa, una píldora en la barra inferior y en
   la lateral, que se desliza con el muelle ágil. El icono pulsado rebota de 0,9
   a 1 con el muelle vivo. Háptico de selección.
2. **Entrar en un detalle** (una playlist): la vista entra desde la derecha
   (`translateX(100%)` → 0, muelle suave) y la cuadrícula de detrás se desplaza
   a −25 % y se oscurece. Volver, o el botón atrás de Android, lo invierte. En
   escritorio: fundido con 16 px de desplazamiento.
3. **Título grande que se compacta:** al hacer scroll, `.view-title` se encoge y
   se funde en la cabecera. Con `animation-timeline: scroll()` donde exista,
   dentro de un `@supports`; donde no, se queda como está. La cabecera móvil
   solo gana cristal fino cuando hay contenido pasando por debajo, lo que se
   detecta con un `IntersectionObserver` sobre un centinela.

### Bloque D — La APK

#### T19 · Hápticos

**Ficheros:** `mobile/package.json`, `src/ui/haptics.js`, los puntos de §2.7

**Qué hacer**

1. `npm install @capacitor/haptics@^5` en `mobile/` y `npx cap sync android`. El
   complemento añade él mismo el permiso `VIBRATE`.
2. `haptics.js`:
   ```js
   export const haptics = {
     selection(),                      // selectionStart + selectionChanged + selectionEnd
     impact(style = 'LIGHT'),          // 'LIGHT' | 'MEDIUM' | 'HEAVY'
     success(), warning(), error(),    // notification({ type: 'SUCCESS' | … })
   };
   ```
   Llama a `globalThis.Capacitor?.Plugins?.Haptics`, que es como la app ya llega a
   `Browser`. En la web no hace nada y nunca lanza un error.
3. Conectar cada momento de la tabla de §2.7.

**Verificación** Test con un `Capacitor` simulado (T23). En el dispositivo, con los
hápticos del sistema desactivados, no se nota nada: el sistema manda.

#### T20 · Barras del sistema y comportamiento de app

**Ficheros:** `mobile/package.json`, `mobile/android/app/src/main/res/values/styles.xml`,
`app.js`, `styles.css`

**Qué hacer**

1. `@capacitor/status-bar@^5`:
   - Al arrancar: `setStyle({ style: 'DARK' })`, que pone el texto claro, y
     `setBackgroundColor({ color: '#0A0C0A' })`.
   - Al abrir el reproductor, el color `c3` de la paleta de T11; al cerrarlo, se
     restaura.
2. Barra de navegación de Android en `#0A0C0A` desde el tema:
   `<item name="android:navigationBarColor">`. Capacitor 5 no tiene API para ella.
3. Comportamiento de app. En la APK y en la PWA instalada
   (`html.is-native, @media (display-mode: standalone)`), y los controles en
   todas partes:
   - `user-select: none` en controles, filas y navegación. Los campos de texto
     siguen siendo seleccionables.
   - `-webkit-touch-callout: none` en las imágenes.
   - `overscroll-behavior: none` en `body`: sin tirón ni estiramiento de la página
     entera.
   - `contextmenu` cancelado sobre las carátulas en la APK.

### Bloque E — Materiales y forma

#### T21 · Cristal esmerilado

**Ficheros:** `styles.css`, `app.js` (detección de equipo modesto)

**Qué hacer**

1. Tokens de §2.6 en `:root`, y tres clases: `.glass-thin`, `.glass-regular` y
   `.glass-thick`. El borde especular va en un `::before` con
   `mask-composite: exclude` y el grano en un `::after`.
2. Reasignar las 12 superficies según el anexo B. Donde no pasa contenido por
   detrás, la superficie pasa a ser **opaca**: el desenfoque ahí no aporta nada y
   cuesta.
3. **La barra de pestañas del móvil pasa a flotar:**
   - Cápsula con 12 px de margen lateral y `bottom: calc(env(safe-area-inset-bottom) + 10px)`,
     radio 29 px y cristal normal.
   - El mini reproductor se sitúa encima.
   - El `padding-bottom` de las vistas se ajusta para que no quede nada tapado.
4. Equipos modestos: `html[data-glass="lite"]` al arrancar si
   `navigator.deviceMemory ≤ 4` o `hardwareConcurrency ≤ 4`.
5. Calibrar los valores definitivos en el laboratorio, opción «Esmerilado».

**Por qué** Es D7 y la decisión de §2.6.

**Verificación** El test estático comprueba que `backdrop-filter` solo aparece
dentro de las clases `.glass-*`. Con «Reducir transparencia», nada es translúcido.

#### T22 · Forma y tipografía

**Ficheros:** `styles.css`

**Qué hacer**

1. Escala de radios: `--radius-xs: 6px`, `--radius-sm: 10px`, `--radius-md: 14px`,
   `--radius-lg: 20px`, `--radius-xl: 28px` y `--radius-full: 999px`. Sustituye a
   los más de doce valores sueltos. Las pistas de progreso usan `--radius-full`.
2. **Radios concéntricos:** el interior es igual al exterior menos el relleno. Por
   ejemplo, el mini reproductor de radio 16 con 8 px de relleno lleva la carátula
   a 8.
3. `corner-shape: squircle` dentro de `@supports`, como mejora progresiva: es una
   propiedad nueva y no se da por hecha.
4. `font-variant-numeric: tabular-nums` en tiempos, porcentajes, contadores y la
   isla.

### Bloque F — Tests

#### T23 · Tests del movimiento

**Ficheros:** `test/frontend/test_motion_spring.mjs`, `test_motion_gesture.mjs`, `test_presence.mjs`,
`test_palette.mjs`, `test_haptics.mjs`, `test_estilos_movimiento.mjs` (nuevos); `test_globales.mjs`,
`test_i18n.mjs` y `test/e2e/recorridos.spec.js` (ampliados)

**Qué hacer**

1. **Unitarios, importando los módulos directamente en Node:**

   | Comprobación |
   |---|
   | `physics()` da la rigidez y la amortiguación de la tabla de §2.2 |
   | Cada muelle se asienta en su tiempo (± 1 fotograma) y con su sobrepaso (± 0,5 %) |
   | Redirigir un muelle a mitad **conserva la velocidad**, con un planificador falso |
   | Con «Reducir movimiento», `to()` salta y resuelve en el mismo tic |
   | `springToLinear` es monótona para `smooth`, empieza en 0 y termina en 1 |
   | **Los tokens de `styles.css` coinciden con `springToLinear`**: nadie los edita a mano |
   | `rubberBand` es creciente, nunca supera su dimensión y es ≈ lineal cerca de 0 |
   | `velocityFrom` usa solo los últimos 80 ms y no divide entre cero |
   | Decisión de cierre: 551 px/s cierra, 549 no; el 28 % de la altura cierra |
   | `presence`: `show` llega a `shown`, `hide` deja `hidden = true`, un `hide` durante `entering` no se queda a medias y el respaldo por tiempo funciona sin `transitionend` |
   | `extractPalette` con una imagen sintética de dos colores devuelve esos dos colores; `c3` queda por debajo de la luminancia 0,08 |
   | `haptics` no hace nada sin Capacitor y llama al complemento con los argumentos de §2.7 cuando lo hay |

2. **Estáticos sobre `styles.css` y `app.js`:**

   | Comprobación |
   |---|
   | No hay `transition: all` ni `var(--transition-smooth\|fast)` |
   | No hay `:hover` con `translateY` |
   | `backdrop-filter` solo dentro de `.glass-*` |
   | Existen los bloques `prefers-reduced-motion` y `prefers-reduced-transparency` |
   | Los `border-radius` usan la escala, con una lista explícita de excepciones |
   | Los modales y la hoja de la cola entran con `@starting-style` y salen con `display … allow-discrete` |
   | **`window.X` sobre un `const` del módulo cuenta como guarda rota**, igual que `globalThis.X` (D14) |
   | `download_btn` lleva `{format}` y `subtitle` no nombra formatos, en los 6 idiomas (D15) |
   | No queda `debug-env-label` (D16) |

3. **Recorridos en navegador** (los 9 actuales siguen, y el 8 y el 9 se adaptan a T13):

   | Recorrido | Qué comprueba |
   |---|---|
   | 10 · Transformación | Al abrir hay un clon en vuelo; al asentarse ha desaparecido y se ve la carátula grande; al cerrar vuelve a verse el mini reproductor |
   | 11 · Cerrar arrastrando | En un viewport móvil, con toques emulados por CDP (`Input.dispatchTouchEvent`): arrastrar poco vuelve a su sitio y un tirón rápido cierra |
   | 12 · La carátula respira | Al pausar, la escala calculada se asienta en 0,82; al reproducir, en 1 |
   | 13 · Letras | Con `lrclib.net` interceptado, tocar una línea cambia `currentTime` |
   | 14 · Dos descargas en escritorio | Dos banners apilados, y el primero sube cuando el otro se va |
   | 15 · Reducir movimiento | Con `emulateMedia({ reducedMotion: 'reduce' })`, abrir el reproductor no crea clon y la isla aparece sin expandirse |
   | 16 · Hoja en el móvil | «Añadir a playlist» se abre anclada abajo y Escape la cierra |
   | 17 · Formato en el botón | Elegir MP3 cambia el texto del botón |

**Por qué** El movimiento es la parte de la interfaz que más fácil se rompe sin que
nadie lo note: un `transition: all` que vuelve, un muelle editado a mano o una
guarda que nunca se cumple. Los estáticos lo atrapan en el CI.

**Verificación** `node --test test/frontend/*.mjs` y `npx playwright test` en verde.

---

## 5. Orden de ejecución, commits y despliegues

```
Fase 1 · Cimientos        T1 → T2 → T3 → T4 → T5 → T6       → desplegar
Fase 2 · Reproductor      T7 → T8 → T9 → T10 → T11 → T12    → desplegar
Fase 3 · Avisos y listas  T13 → T14 → T15 → T16 → T17 → T18 → desplegar
Fase 4 · La APK           T19 → T20                          → APK nueva + desplegar
Fase 5 · Materiales       T21 → T22                          → desplegar + APK
T23 avanza con cada fase: cada tarea entra con sus tests
```

- **T1 va primero sin excepción**: sin él, el primer `import` deja sin tests el frontend.
- Commits directamente en `main`, agrupados por tarea, y **solo cuando los apruebes**.
- Cada fase se despliega por separado y **solo con tu permiso**. Después de cada
  una: prueba en el Mac, en Chrome del móvil y en la APK.
- La APK nueva que tenemos pendiente encaja al final de la fase 4, con los
  hápticos y las barras dentro. La fase 5 cambia la barra de pestañas, así que
  pide otra APK al terminar.
- **Relación con el plan 08:** lo nuevo nace en `src/ui/` con la estructura del
  08, y lo que se toca de `app.js` se queda ahí. Cuando el 08 extraiga esos
  módulos, el movimiento viaja con ellos. Hacer el 09 antes que el resto del 08
  no genera trabajo doble: solo cambian las rutas de los `import`.

**Medición de rendimiento, al final de las fases 2, 3 y 5:** depuración remota de
Chrome (`chrome://inspect`) sobre la APK en un Android de gama media. Grabar abrir
y cerrar el reproductor, desplazar las letras y deslizar filas. Ningún fotograma
de animación debe pasar de 16,7 ms.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El desenfoque tira los fps en Android | **Alta** sin control | Tope de tres superficies (§2.9), `data-glass="lite"`, fondo del reproductor sin blur (T11), sin desenfoque en los fondos de las hojas en el móvil |
| El arrastre para cerrar choca con el *scroll snap* de las letras | **Alta** si se hace con *pointer events* | T8 punto 2: solo con `scrollTop === 0` y movimiento inicial hacia abajo, con eventos táctiles no pasivos |
| El arnés deja de cargar `app.js` al primer `import` | **Segura** sin T1 | T1 punto 3 antes que nada |
| Playwright prueba un `dist/` viejo | Media | T1 punto 4: el servidor de pruebas siempre compila antes |
| La barra de pestañas flotante tapa contenido | Media | `padding-bottom` de cada vista calculado desde la altura real; recorrido en viewport móvil |
| El desenfoque en las letras cuesta demasiado | Media | Solo en las ±4 líneas cercanas; sin desenfoque con «Reducir movimiento» o `data-glass="lite"` |
| El gesto atrás de Android se confunde con el deslizamiento de las filas | Baja | Se mantiene la exclusión de 30 px del borde |
| La miniatura no deja leer sus píxeles | Baja (hoy hay CORS abierto) | `FALLBACK` y `try/catch`; en la APK la miniatura ya es `data:` |
| Sortable no entiende `linear()` en una WebView antigua | Baja | Respaldo con `cubic-bezier` según `CSS.supports` |
| Las letras alineadas a la izquierda no te convencen | — | Es una línea de CSS; queda como decisión pendiente |
| Se pierde el sentido del plan a mitad | Media | Cada fase se despliega entera y se puede usar sola; el laboratorio sirve de referencia visual |

---

## 7. Definición de hecho

- [ ] No queda `transition: all` ni `:hover` con `translateY`, y los tokens de muelles coinciden con la física.
- [ ] Los 13 modales y hojas, el panel de la cola y la vista de detalle tienen entrada y salida, también con el botón atrás de Android.
- [ ] Con «Reducir movimiento», nada se desplaza solo, y los gestos siguen al dedo.
- [ ] Con «Reducir transparencia», ninguna superficie es translúcida.
- [ ] El botón dice el formato elegido en los 6 idiomas y no se ve la etiqueta de depuración.
- [ ] Tocar una línea de la letra salta a ese momento.
- [ ] Abrir el reproductor hace volar la carátula desde el mini reproductor, y cerrarlo a mitad no produce saltos.
- [ ] En el móvil, el reproductor se cierra arrastrando hacia abajo, y desde las letras deslizar hacia abajo desplaza las letras.
- [ ] La carátula encoge al pausar, también si se pausa desde la pantalla de bloqueo.
- [ ] El fondo del reproductor toma el color de la carátula sin `blur(80px)`.
- [ ] Las descargas aparecen en una isla en el móvil y en banners apilados en el escritorio.
- [ ] Las filas entran y salen con muelle, y borrar no usa temporizadores.
- [ ] Deslizar una fila se resiste pasado el umbral y avisa al cruzarlo.
- [ ] En la APK hay hápticos en los momentos de §2.7, y las barras del sistema van a juego.
- [ ] Las superficies son de cristal esmerilado con tres grosores, y la barra de pestañas flota.
- [ ] 60 fps en las animaciones medidas en un Android de gama media.
- [ ] `node --test test/frontend/*.mjs`, `pytest test/backend` y `npx playwright test` en verde, incluidos los recorridos 10 a 17.

---

## Anexo A · Valores de referencia

| Token | Valor |
|---|---|
| `--spring-smooth` / `-duration` | `linear()` de 42 puntos / 683 ms |
| `--spring-snappy` / `-duration` | `linear()` de 27 puntos / 433 ms |
| `--spring-bouncy` / `-duration` | `linear()` de 51 puntos / 833 ms |
| `--fade-fast` / `--fade` | 150 ms / 220 ms |
| Escalas de pulsación | 0,90 (icono) · 0,96 (botón) · 0,98 (fila y tarjeta) |
| Carátula en pausa | 0,82 |
| Umbral de deslizar | 120 px; goma de 70 px a partir de ahí |
| Cerrar arrastrando | > 550 px/s o > 28 % de la altura; goma hacia arriba de 90 px |
| Radios | 6 · 10 · 14 · 20 · 28 · 999 |

## Anexo B · Las 12 superficies con desenfoque y su destino

| Línea | Selector | Hoy | Destino |
|---|---|---|---|
| 134 | `.sidebar` | `blur(30px) saturate(110%)` | Opaca: no pasa contenido por detrás |
| 389 | `.mobile-header-bar` | `blur(20px)` | Cristal fino, solo con contenido debajo (T18) |
| 471 | `.bottom-nav` | `blur(24px)` | Cristal normal, **flotante** (T21) |
| 520 | `.card` | `blur(24px) saturate(120%)` | Opaca: es contenido, no una capa flotante |
| 875 | `.custom-options` | `blur(20px) saturate(125%)` | Cristal grueso |
| 1022 | `.buy-coffee-btn` | `blur(8px)` | Cristal normal |
| 2289 | `.player-bar` | `blur(28px) saturate(145%)` | Cristal normal |
| 3026 | `.pq-backdrop` | `blur(4px)` | Solo oscurecido en el móvil; 8 px en escritorio |
| 3037 | `.pq-panel` | `blur(24px)` | Cristal grueso (hoja) |
| 3210 | `.auth-modal-backdrop` | `blur(6px)` | Igual que `.pq-backdrop` |
| 3221 | `.auth-modal-content` | `blur(28px) saturate(125%)` | Cristal grueso |
| 3535 | `.queue-card` | `blur(24px) saturate(120%)` | Sustituida: isla negra en el móvil y banner de cristal grueso en el escritorio (T13) |

Aparte, el fondo del reproductor usa `filter: blur(80px)` y pasa a degradados (T11).

## Anexo C · Los 13 modales y hojas

| Modal | Tipo en el móvil |
|---|---|
| `addToPlaylistModal`, `createNewPlaylistModal`, `createPlaylistModal`, `editPlaylistModal` | Hoja |
| `playlistSearchModal`, `playlistSortModal`, `playbackQueueSheet` | Hoja |
| `authModal`, `downloadApkModal`, `permissionOnboardingModal` | Hoja |
| `customAlertModal`, `logoutConfirmModal`, `playlistDeleteConfirmModal` | Alerta centrada |

Los cinco `close…Modal` que también aparecen al buscar en `index.html` son los botones de
cierre de estos modales, no modales en sí.
