# 10 — Pulido y arreglos

**Estado:** hecho · sin desplegar · **Prioridad:** 🔴 T1 (seguridad) · 🟢 resto · **Depende de:** 08 (hecho)
**Propuestas que cubre:** 24, 25, 17, 22, 23 y 18 de la lista de mejoras, más un
fallo de seguridad encontrado al redactar este plan (D1).

> Una entrega corta y visible antes de los planes grandes: cerrar lo que dejó
> abierto el plan 08, que la web se maneje con el teclado, que la APK tenga
> icono temático y arranque propio, y que ninguna pantalla se quede en blanco
> mientras carga o cuando no tiene nada que enseñar.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | 🔴 **(nuevo)** Títulos y nombres insertados como HTML sin escapar | 28 plantillas en 12 módulos: `library.js`, `search.js`, `history.js`, `favorites/panel.js`, `youtube-playlist.js`, `queue-sheet.js`, `lyrics.js`, `playlists/*`… Solo `ui/downloads-hud.js` escapa (`escapar`) | El título de un vídeo lo escribe quien lo sube. Uno llamado `<img src=x onerror=…>` ejecuta código al aparecer en una búsqueda, y en la APK ese código tiene a mano los plugins nativos (ficheros, notificaciones) |
| D2 | `auth.init()` se llama dos veces al arrancar | `main.js`: primer `DOMContentLoaded` y arranque principal | Dos `google.accounts.id.initialize()` (aviso de Google en consola), dos `/api/auth/me` y dos sincronizaciones con sesión |
| D3 | Modal de ordenar listas huérfano | `index.html` `#playlistSortModal` y su CSS | HTML y estilos que nada abre desde el plan 08 |
| D4 | Sin atajos de teclado | — | En el escritorio todo es con ratón: ni espacio para pausar |
| D5 | Icono sin versión temática | `mobile/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher*.xml` sin `<monochrome>` | Con los iconos temáticos de Android 13 activados, el nuestro es el único a color |
| D6 | Arranque genérico de la APK | `styles.xml` · `AppTheme.NoActionBarLaunch` solo con `android:background` | En Android 12+ el sistema pinta un icono sobre fondo blanco y luego salta a la WebView en negro: un destello |
| D7 | Pantallas vacías y cargas sin diseño | `#libraryEmpty`, `#playlistsEmpty`, `#playlistDetailEmpty`, historial, favoritos, búsqueda sin resultados, cola vacía, letras no encontradas · `#libraryLoader` (rueda) | Texto suelto o una rueda girando; nada que invite a hacer algo |

---

## 2. Decisiones de diseño

### 2.1 D1: escapar siempre al construir HTML, no «cuando haga falta»

| Alternativa | Veredicto |
|---|---|
| Revisar las 28 plantillas y escapar a mano cada interpolación | ❌ Se olvida la siguiente |
| Reescribir los renderizados con `createElement` + `textContent` | ❌ Correcto pero enorme, y toca el movimiento del plan 09 |
| **Etiqueta de plantilla `html\`…\`` que escapa todo lo interpolado** | ✅ **Elegida**: cambio mecánico, se lee igual y lo nuevo nace seguro |

```js
// core/html.js
export const escapar = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ENTIDADES[c]);
export class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
/** Todo lo interpolado se escapa, salvo lo que ya es Seguro (otra plantilla html). */
export function html(partes, ...valores) { … return new Seguro(texto); }
```

- `el.innerHTML = html\`<div>${song.title}</div>\`` escapa el título.
- Anidar plantillas (`${lista.map(s => html\`…\`)}`) no escapa dos veces: los
  arrays de `Seguro` se unen tal cual.
- Los atributos también: `src="${song.thumbnail}"` escapa comillas. Para URLs se
  añade `urlSegura(u)`, que solo deja pasar `https:`, `http:`, `blob:`, `data:image/`
  y rutas relativas; el resto se sustituye por `favicon.png`.
- `ui/downloads-hud.js` pasa a usar `core/html.js` y se borra su `escapar` propio.

### 2.2 D2: una sola llamada, y un `init` que no se puede repetir

Se deja la llamada del arranque principal (después de `i18n.init()` y
`FavoritesModule.init()`, que es el orden que la sincronización necesita) y se
quita la del primer `DOMContentLoaded`. Además `AuthManager.init()` guarda su
promesa y devuelve la misma si se vuelve a llamar: el defecto no puede volver
por otro camino.

### 2.3 D4: atajos como Apple Music y YouTube, sin robar el teclado

| Tecla | Acción |
|---|---|
| `Espacio` · `K` | Reproducir / pausar |
| `←` / `→` | Retroceder / avanzar 10 s |
| `Mayús + ←` · `P` / `Mayús + →` · `N` | Canción anterior / siguiente |
| `↑` / `↓` | Volumen ±5 % |
| `M` | Silenciar |
| `L` | Favorito de lo que suena |
| `F` | Abrir / cerrar el reproductor a pantalla completa |
| `/` | Ir al buscador |
| `?` | Hoja con todos los atajos |
| `Esc` | Cerrar lo de arriba (ya existe, `ui/sheets.js`) |

Reglas, **en este orden**:
1. Con el foco en un `input`, `textarea`, `select` o `[contenteditable]`, no se hace nada (salvo `Esc`).
2. Con `Ctrl`, `⌘` o `Alt` pulsados, no se hace nada: son del navegador.
3. Con un modal abierto (`modales.arriba()`), solo `Esc`.
4. Sin canción cargada, las teclas del reproductor no hacen nada.
5. `Espacio` y las flechas llevan `preventDefault()` solo cuando se usan, para no desplazar la página.

La lógica es una función pura, `accionDeTecla(evento, contexto)`, que devuelve el
nombre de la acción o `null`: se prueba sin DOM.

### 2.4 D5 y D6: icono temático y arranque con la API de Android 12

- **Icono temático:** capa `<monochrome>` en el icono adaptativo, un *vector
  drawable* de un solo color con la silueta del logo. Android lo tiñe con el
  color del fondo de pantalla. `compileSdk` ya es 33, que es donde existe.
- **Arranque:** se usa el `SplashScreen` de AndroidX (`core-splashscreen`, ya
  en `build.gradle`) con el color de la app y el icono, y el plugin
  `@capacitor/splash-screen` para **mantenerlo hasta que la web haya pintado**:
  `launchAutoHide: false` y `SplashScreen.hide({ fadeOutDuration: 250 })`
  desde `main.js` cuando la biblioteca está pintada. Así desaparece el destello
  del icono sobre blanco seguido de la WebView en negro.

### 2.5 D7: ilustraciones de línea y esqueletos que no parpadean

- **Ilustraciones** SVG en línea, con el mismo trazo que los iconos (1,75 px,
  extremos redondeados, `currentColor`) y el dorado de la marca en un acento.
  Una por situación, no una genérica: biblioteca vacía (vinilo y nota), listas
  vacías (tres portadas apiladas), sin resultados (lupa y onda), cola vacía,
  historial vacío, letras no encontradas (bocadillo con pentagrama).
- Cada estado vacío lleva **una acción**: «Buscar música», «Crear lista»…
- **Esqueletos** con la forma real de lo que viene (filas de biblioteca,
  resultados de búsqueda, tarjetas de lista) y brillo animado. **Solo si la
  carga pasa de 150 ms**: si no, el esqueleto parpadea y es peor que nada. Con
  «Reducir movimiento», sin brillo.

---

## 3. Alcance

**Dentro:** D1-D7.

**Fuera:**
- Rehacer los renderizados con `createElement` (§2.1).
- Atajos globales del sistema o teclas multimedia del teclado: ya llegan por
  la sesión multimedia (`native/media-session.js`).
- Icono o arranque en iOS: no hay proyecto iOS.

---

## 4. Tareas

### Bloque A — Seguridad y arreglos

#### T1 · 🔴 Escapar todo lo que se inserta como HTML (D1)

**Ficheros:** `frontend/src/core/html.js` (nuevo), los 12 módulos con plantillas,
`frontend/src/ui/downloads-hud.js`, `eslint.config.mjs`

**Qué hacer**

1. Crear `core/html.js` con `escapar`, `Seguro`, `html` y `urlSegura` (§2.1).
   Sin dependencias: es base.
2. Inventario exacto con
   `grep -rnE '\$\{[^}]*\b(title|channel|name|artist|description|thumbnail)\b' frontend/src`
   y convertir **cada** plantilla que acabe en `innerHTML` o `insertAdjacentHTML`
   en `html\`…\``. Los `src`/`href` con datos de fuera pasan por `urlSegura`.
3. Los textos de i18n que llevan HTML a propósito (si los hay) se marcan con
   `new Seguro(...)` y un comentario que diga por qué.
4. Regla de ESLint `no-restricted-syntax` que prohíba asignar a `innerHTML` una
   plantilla que no sea `html\`…\``:
   ```js
   { selector: "AssignmentExpression[left.property.name='innerHTML'] > TemplateLiteral", message: 'Usa html`…` de core/html.js' }
   ```
   (Una cadena fija sin interpolación sigue permitida.)

**Por qué** Es la única tarea del plan con riesgo real para el usuario. Los
títulos llegan de YouTube y de las listas que cada uno escribe; con el plan 13
llegarán también de otro dispositivo.

**Cosas que no hacer**
- No escapar «solo los títulos»: el canal, la descripción de una lista y la
  miniatura son igual de externos.
- No escapar dos veces: la clase `Seguro` existe para eso. `&amp;amp;` en
  pantalla es un fallo de este arreglo.
- No usar `DOMPurify` ni similares: no se inserta HTML de fuera nunca, solo texto.

**Verificación** Test unitario de `html` (escapa `< > & " ' \``, no escapa
anidados, arrays), test de estructura (ninguna asignación a `innerHTML` con
plantilla sin `html`), y el recorrido E2E 24.

#### T2 · Una sola inicialización de la sesión (D2)

**Ficheros:** `frontend/src/main.js`, `frontend/src/features/auth.js`

1. Quitar `auth.init()` del primer `DOMContentLoaded` de `main.js`.
2. En `AuthManager`: `init() { return this.iniciando ??= this.#init(); }`, con el
   cuerpo actual en `#init`.

**Verificación** Test con el arnés: `google.accounts.id.initialize` simulado se
llama una vez aunque `init()` se llame dos. En producción, la consola ya no
muestra «initialize() is called multiple times».

#### T3 · Borrar el modal huérfano (D3)

**Ficheros:** `frontend/index.html`, `frontend/src/styles.css`, traducciones si tiene claves propias

Borrar `#playlistSortModal` y sus reglas (`grep -n "playlistSort\|pl-sort" frontend/src/styles.css`).
Comprobar que `test_cristal` y `test_hojas`, que cuentan modales, siguen en verde
o se ajustan (hay uno menos).

### Bloque B — Teclado

#### T4 · Atajos de teclado (D4)

**Ficheros:** `frontend/src/ui/shortcuts.js` (nuevo), `frontend/src/features/player/controls.js`,
`frontend/src/features/player/player.js`, `frontend/src/main.js`, `frontend/index.html`
(hoja de ayuda), traducciones (6 idiomas)

1. `ui/shortcuts.js`:
   - `accionDeTecla(e, { enCampo, modalAbierto, hayCancion })` → `'reproducir'`,
     `'adelante'`, `'atras'`, `'siguiente'`, `'anterior'`, `'volumen+'`,
     `'volumen-'`, `'silencio'`, `'favorito'`, `'pantallaCompleta'`,
     `'buscar'`, `'ayuda'` o `null`. Usa `e.key`, no `e.keyCode`.
   - `initAtajos(acciones)` registra un único `keydown` en `document` y llama a
     `acciones[nombre]()`.
2. `controls.js` devuelve desde `initBarras` una API: `{ cambiarVolumen(delta), alternarSilencio() }`,
   que mueve las dos barras a la vez (reutiliza `updateVolumeBar`).
3. `player.js` expone `seekBy(segundos)` y `hayCancion()`.
4. `main.js` monta el mapa de acciones y llama a `initAtajos`.
5. Hoja de ayuda `#shortcutsSheet` con la tabla de §2.3, siguiendo `ui/sheets.js`.
   Solo se ofrece en dispositivos con teclado físico
   (`matchMedia('(hover: hover) and (pointer: fine)')`); en el móvil no aparece.
6. Enlace «Atajos de teclado» en la barra lateral de escritorio.

**Cosas que tener en cuenta**
- `Espacio` sobre un `button` enfocado lo pulsa: si el foco está en un botón,
  se deja pasar (regla 1 ampliada a `button` para `Espacio` y `Enter`).
- Con el lector de pantalla, las flechas mueven su cursor: los atajos no se
  activan si `document.activeElement` está dentro de una lista con `role`.

### Bloque C — La APK

#### T5 · Icono temático (D5)

**Ficheros:** `mobile/android/app/src/main/res/drawable/ic_launcher_monochrome.xml` (nuevo),
`mipmap-anydpi-v26/ic_launcher.xml`, `mipmap-anydpi-v26/ic_launcher_round.xml`

1. Dibujar la silueta del logo como `<vector>` de 108×108 dp, un solo trazo
   `@android:color/white`, dentro de la zona segura de 66 dp (margen 21 dp).
   Partir del logo, no de una captura: bordes limpios a cualquier tamaño.
2. Añadir `<monochrome android:drawable="@drawable/ic_launcher_monochrome"/>` a
   los dos XML del icono adaptativo.

**Verificación** En el emulador: Ajustes → Fondo de pantalla y estilo → Iconos
temáticos. El nuestro se tiñe como los de Google. Sin la opción activada, el
icono de siempre.

#### T6 · Arranque propio (D6)

**Ficheros:** `mobile/package.json` (`@capacitor/splash-screen@^5`),
`mobile/capacitor.config.ts`, `mobile/android/app/src/main/res/values/styles.xml`,
`res/drawable/splash_icon.xml` (nuevo), `res/values-night/styles.xml` si hace falta,
`frontend/src/main.js`, `mobile/android/gradle/verification-metadata.xml`

1. Tema de arranque con la API de Android 12:
   ```xml
   <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
       <item name="windowSplashScreenBackground">#0A0C0A</item>
       <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
       <item name="windowSplashScreenAnimationDuration">500</item>
       <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
   </style>
   ```
   `splash_icon` es el logo en vector a 240 dp con zona segura de 160 dp.
2. `capacitor.config.ts`: `plugins.SplashScreen = { launchAutoHide: false, backgroundColor: '#0A0C0A', androidScaleType: 'CENTER', showSpinner: false }`.
3. `main.js`, al final del arranque (tras `LibraryModule.render()`):
   `globalThis.Capacitor?.Plugins?.SplashScreen?.hide({ fadeOutDuration: 250 })`.
   Con un **tope de seguridad** de 4 s por si el arranque falla: nunca una app
   atascada en su pantalla de arranque.
4. Regenerar `verification-metadata.xml` con
   `./gradlew --write-verification-metadata sha256 assembleDebug`.
5. Android 5.1-11 siguen con `@drawable/splash` (lo pinta la compatibilidad de
   AndroidX a partir del mismo tema).

**Cosas que no hacer** No animar el logo con un `AnimatedVectorDrawable` largo:
Android corta la animación en cuanto la app está lista, y una a medias queda
peor que ninguna.

### Bloque D — Estados vacíos y cargas

#### T7 · Estados vacíos con ilustración (D7)

**Ficheros:** `frontend/src/ui/empty-states.js` (nuevo), `frontend/index.html`
(los `library-empty`), módulos que pintan cada estado, `styles.css`, traducciones

1. `ui/empty-states.js`: `ILUSTRACIONES` (SVG en cadenas fijas) y
   `estadoVacio({ ilustracion, titulo, texto, accion })` que devuelve un
   elemento. Sin datos de fuera: todo es texto traducido.
2. Sustituir los ocho estados de la tabla D7. Cada uno con su acción:

   | Estado | Acción |
   |---|---|
   | Biblioteca vacía | «Buscar música» → Inicio con el foco en el buscador |
   | Sin listas | «Crear lista» |
   | Lista vacía | «Añadir canciones» → modal de añadir |
   | Sin resultados | «Probar con un enlace» |
   | Cola vacía | ninguna |
   | Historial y favoritos vacíos | ninguna |
   | Letra no encontrada | ninguna |

3. Entrada con `presence.show` (plan 09): aparecen, no saltan.

#### T8 · Esqueletos de carga (D7)

**Ficheros:** `frontend/src/ui/skeleton.js` (nuevo), `features/library/library.js`,
`features/search.js`, `features/playlists/playlists.js`, `features/lyrics.js`, `styles.css`

1. `conEsqueleto(contenedor, forma, n, promesa)`: si la promesa no se resuelve en
   150 ms, pinta `n` esqueletos con la forma pedida (`'fila'`, `'resultado'`,
   `'tarjeta'`, `'letra'`) y los retira cuando se resuelve.
2. Sustituye a `#libraryLoader` (la rueda) y a la rueda del botón de buscar en
   la lista de resultados (el botón mantiene la suya).
3. CSS: bloques con `--radius-*` del plan 09 y un degradado que se desplaza.
   Con `prefers-reduced-motion`, estáticos.

### Bloque E — Tests

#### T9 · Tests del plan

| Qué | Dónde |
|---|---|
| `html`, `escapar`, `urlSegura` con casos hostiles | `test/frontend/test_html.mjs` (nuevo, importación directa) |
| Ninguna asignación a `innerHTML` con plantilla sin `html` | `test_estructura.mjs` (y la regla de ESLint) |
| `init()` de la sesión, idempotente | `test_plan01_datos.mjs` o nuevo, con el arnés |
| `accionDeTecla`: cada tecla, campo enfocado, modificadores, modal abierto, sin canción | `test/frontend/test_atajos.mjs` (nuevo) |
| `conEsqueleto`: no pinta si resuelve en <150 ms, pinta y retira si tarda | `test/frontend/test_esqueletos.mjs` (nuevo, DOM mínimo) |
| El icono adaptativo tiene capa monocroma; el tema de arranque tiene sus cuatro elementos | `test/backend/test_build_config.py` (lee los XML) |
| E2E 23 · espacio pausa, `→` avanza, `N` pasa de canción, `?` abre la ayuda y en un campo de texto no pasa nada | `recorridos.spec.js` |
| E2E 24 · una búsqueda cuyo título lleva `<img src=x onerror=…>` se ve como texto y no ejecuta nada | `recorridos.spec.js` + un caso en `fake_ytdlp` |
| E2E 25 · biblioteca vacía con su ilustración y «Buscar música» lleva al buscador | `recorridos.spec.js` |

Prueba manual en el emulador: icono temático activado y desactivado, arranque
en frío sin destello, y la pantalla de arranque que no se queda colgada si se
corta la red.

---

## 5. Orden de ejecución, commits y despliegue

```
T1 → T2 → T3        seguridad y arreglos         → desplegar (web) cuanto antes
T4                  teclado                      → desplegar
T7 → T8             estados vacíos y esqueletos
T5 → T6             la APK                       → APK 1.3.0 + desplegar
T9 avanza con cada tarea
```

- **T1 no espera a nada**: si solo se hiciera una tarea de este plan, sería esta.
- Commits en `main`, agrupados por tarea, cuando los apruebes. Despliegues solo con permiso.
- La APK nueva lleva también T1 (su web va dentro).

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Se escapa dos veces y aparecen `&amp;` en pantalla | Media | Clase `Seguro` para lo anidado; tests con `&` en títulos reales («Simon & Garfunkel») |
| Se olvida una plantilla | Media | Regla de ESLint y test de estructura |
| Un atajo choca con el navegador o el lector de pantalla | Baja | Reglas 1-3 de §2.3 |
| La pantalla de arranque se queda puesta si la web falla | Baja | Tope de 4 s |
| El icono monocromo se ve mal a tamaño pequeño | Media | Silueta simplificada, sin detalles de menos de 2 dp; se revisa en el emulador |
| Los esqueletos parpadean en cargas rápidas | Media si no | Umbral de 150 ms |

---

## 7. Definición de hecho

- [ ] Ningún dato de fuera llega a `innerHTML` sin escapar; ESLint lo impide.
- [ ] Un título con HTML se ve como texto en búsqueda, biblioteca, cola, listas e historial.
- [ ] `auth.init()` una sola vez; sin aviso de Google en consola.
- [ ] Sin rastro de `#playlistSortModal`.
- [ ] Los atajos de §2.3 funcionan en el escritorio y no interfieren al escribir.
- [ ] Icono temático en Android 13+; arranque sin destello y con tope de seguridad.
- [ ] Los ocho estados vacíos con ilustración, y esqueletos en las cargas lentas.
- [ ] Todas las suites en verde, incluidos los recorridos 23-25.

---

## 8. Registro de ejecución (2026-09-27)

**T1 a T9 hechas.** Nada desplegado ni commiteado. APK 1.3.0 compilada (versionCode 8, misma firma).

| Tarea | Qué quedó |
|---|---|
| T1 | `core/html.js` (`html`, `escapar`, `urlSegura`, `seguro`). 29 plantillas en 13 módulos pasan por `html`; en `src` y `href` la URL se filtra sola. Regla de ESLint y test de estructura. El HUD deja su `escapar` propio |
| T2 | `auth.init()` una vez en `main.js` e idempotente (`#iniciar` + promesa guardada) |
| T3 | `#playlistSortModal` fuera de `index.html` (no tenía CSS ni textos propios) |
| T4 | `ui/shortcuts.js` (puro) y `ui/shortcuts-help.js` (la hoja); volumen, avance, favorito y pantalla completa expuestos por el reproductor; enlace en la barra lateral |
| T5 | `drawable/ic_launcher_monochrome.xml` al 70 %, el peso de los iconos de Google; comprobado en el emulador con los iconos temáticos activados |
| T6 | Tema de arranque de Android 12 con `splash_icon` y `@capacitor/splash-screen`; la web lo quita al pintar la biblioteca (1,2 s en el emulador) |
| T7 | `ui/empty-states.js` con 8 ilustraciones; estados con acción y `data-i18n` |
| T8 | `ui/skeleton.js`; esqueletos en biblioteca, búsqueda, listas y letras |
| T9 | Tests: `test_html`, `test_atajos`, `test_esqueletos`, `test_sesion`, estructura y configuración de la APK; recorridos 23-25 |

### Encontrado por el camino

- **Las letras tampoco se escapaban.** Vienen de lrclib, un servicio externo: el
  mismo agujero que los títulos. Cubierto por T1.
- **🔴 En el móvil la barra de pestañas arrancaba oculta.** `main.js` enfocaba el
  buscador al arrancar; en el móvil eso no abre el teclado pero activa la regla
  CSS que oculta la barra mientras se escribe. Pasaba en la web del móvil y en la
  APK. Ahora el foco automático es solo con ratón y teclado físico.
- **Dos textos en inglés fijo** en todos los idiomas: «No lyrics found for this
  track» y «Searching for lyrics...». Sustituidos por el estado vacío y el
  esqueleto, traducidos.
- **El tope de 4 s del arranque es nativo** (`launchAutoHide: true` +
  `launchShowDuration`), no un temporizador de JavaScript como decía el plan:
  si la web fallara al cargar, un temporizador de JavaScript tampoco correría.
- **El yt-dlp simulado** no sustituía la «/» de los títulos al guardar el fichero
  (el real sí): lo destapó el título hostil del recorrido 24.

### Definición de hecho

- [x] Ningún dato de fuera llega a `innerHTML` sin escapar; ESLint lo impide.
- [x] Un título con HTML se ve como texto en búsqueda, biblioteca, reproductor y cola (recorrido 24).
- [x] `auth.init()` una sola vez; sin el aviso de Google en consola.
- [x] Sin rastro de `#playlistSortModal`.
- [x] Los atajos funcionan en el escritorio y no interfieren al escribir (recorrido 23).
- [x] Icono temático en Android 13+; arranque sin destello y con tope nativo.
- [x] Estados vacíos con ilustración y esqueletos en las cargas lentas (recorrido 25).
- [x] Suites en verde: 523 backend, 455 frontend, 25 E2E.

