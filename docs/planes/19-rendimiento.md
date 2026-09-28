# 19 — Rendimiento: la misma app, mucho más ágil

**Estado:** pendiente · **Prioridad:** 🟠 Alto (experiencia en el móvil) · **Depende de:** 13 (hecho)
**Origen:** el usuario nota la APK «lagueada» en un Vivo X200 Pro, un móvil
potente, cuando al principio, con menos funciones, no lo estaba. En un MacBook
M5 Pro va fluida.

> **Principio del plan: la misma imagen, menos trabajo.** Nada de lo que se ve
> cambia: ni el cristal esmerilado, ni su desenfoque, ni las animaciones, ni
> los colores. Se cambia *cómo* se consigue cada cosa. Toda tarea se acepta
> solo si las capturas de referencia (T1) salen iguales. Quitar o rebajar un
> efecto no es una opción de este plan.

---

## 1. Problema

Medición preliminar (2026-09-28), Chrome con la CPU frenada 6× (una
aproximación a una WebView de móvil) y 150 canciones:

| | Miniaturas incrustadas (como en la APK) | Miniaturas por enlace (como en la web) |
|---|---|---|
| HTML de la lista de la biblioteca | **3,9 MB** | 382 KB |
| Tocar un corazón hasta verlo marcado | **432 ms** | 297 ms |
| Tiempo bloqueado al arrancar | 828 ms | 650 ms |

Por encima de ~100 ms un toque se siente lento: hoy un corazón tarda de 3 a 4
veces eso.

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | Las miniaturas de la APK se guardan en base64 **dentro** de cada canción | `download.js` (`offlineBase64Thumb`), `save.js` | La biblioteca pesa megas; se lee, se procesa y se guarda entera en cada cambio |
| D2 | Cada fila lleva la canción entera serializada (`data-song`), miniatura incluida | `library.js` (`renderLibraryItem`) | 3,9 MB de HTML para 150 filas |
| D3 | La biblioteca se lee de IndexedDB en 32 sitios, entera cada vez; la sincronización (plan 13) añade otra lectura por guardado | `getLibrary()`, `saveLibrary()` | Trabajo repetido en cada gesto |
| D4 | Cada guardado en la APK escribe además la copia de seguridad entera en un fichero | `saveLibrary()`, `savePlaylists()` | E/S y serialización en cada toque |
| D5 | Cualquier cambio repinta la lista entera, la rejilla de listas y el panel de favoritos | `render()`, `renderGrid()`, `refrescarVistas()` | Un corazón reconstruye cientos de filas |
| D6 | La animación de las listas (FLIP) mide **todas** las filas antes y después de cada repintado | `ui/motion/list.js` (`measure`, `animateListChange`) | Dos cálculos de maqueta completos por cambio, aunque la fila esté fuera de pantalla |
| D7 | Las barras de progreso y volumen se animan cambiando `width` 4 veces por segundo **dentro** de superficies de cristal | `player.js`, `controls.js` | Maqueta y repintado continuos; el cristal vuelve a muestrear lo de detrás |
| D8 | Muelles calculados fotograma a fotograma en JavaScript aunque la animación no sea interactiva | `ui/motion/spring.js` y 9 módulos | Compiten con el resto del hilo principal; con un tirón, la animación se atasca |
| D9 | Las fuentes se cargan dos veces (`@import` en el CSS y `<link>` en el HTML) y desde Google, incluida la de iconos completa | `styles.css:5`, `index.html:17` | Bloquea el primer pintado y en la APK depende de la red |
| D10 | Todo el código se carga al arrancar: 296 KB de JS y 105 KB de CSS | `main.js` | Letras, visualizador, copia, editor y artistas se analizan aunque no se usen |
| D11 | El arranque espera migraciones y reparaciones antes de pintar; el trabajo de fondo (sonoridad, identidades, sincronización) no cede ante el usuario | `main.js`, `loudness-backfill.js`, `sync.js` | Tirones mientras se hace scroll o se toca algo |
| D12 | Seis escuchadores de `timeupdate` actualizan por su cuenta la barra, las letras, la sesión nativa… | reproductor | Trabajo repetido 4 veces por segundo mientras suena música |
| D13 | Las líneas de la letra se desenfocan una a una con `filter: blur`, y el desenfoque cambia en cada línea | `styles.css:3626` | Repintado de texto desenfocado en cada cambio de línea |
| D14 | La APK se compila en modo depuración (`assembleDebug`) | `scripts/sync-apk.sh` | Android optimiza menos la parte nativa (puente con los plugins, sesión multimedia) — **hipótesis a medir** |

---

## 2. Decisiones de diseño

### 2.1 Lo que no se toca

- El **cristal esmerilado** (`glass-thin/regular/thick`) con su desenfoque,
  saturación, brillo, borde especular y grano. En el Vivo sigue el cristal
  completo: el modo `data-glass="lite"` que ya existe es solo para equipos de
  4 GB o menos, y no cambia.
- Las **animaciones**: el vuelo del mini reproductor, las hojas, los muelles,
  el escalonado de las listas, la carátula que respira, el visualizador.
- Los **colores**, las **fuentes**, los **tamaños** y el **desenfoque de la letra**.

Si una optimización cambiara un píxel, no entra. Si un efecto es caro y no hay
forma de hacerlo igual con menos coste, se queda como está y se optimiza lo
que tiene alrededor.

### 2.2 Cómo se consigue lo mismo con menos

| Hoy | Igual a la vista, más barato |
|---|---|
| Miniatura en base64 dentro de la canción | Un fichero por miniatura (APK: `DATA/miniaturas/<id>.jpg`; web: blob en IndexedDB) y la canción guarda su ruta. Es la misma imagen |
| `getLibrary()` lee y procesa IndexedDB cada vez | La biblioteca vive en memoria; IndexedDB solo se escribe |
| Repintar toda la lista | Actualizar solo las filas que cambian (por `src`) |
| FLIP midiendo todas las filas | Medir solo las filas visibles: la animación se ve igual, porque fuera de pantalla no se ve |
| Filas fuera de pantalla pintadas | `content-visibility: auto` con su tamaño reservado: el navegador no las pinta hasta que se acercan |
| Barra de progreso con `width` | La misma barra, movida con `transform` o `clip-path` (con sus extremos redondeados intactos): sin maqueta ni repintado del cristal |
| Muelles en JavaScript para animaciones no interactivas | La misma curva como `linear()` (ya existe `springToLinear`) ejecutada por el compositor con Web Animations. El JS solo para lo que sigue al dedo o se reorienta a mitad |
| Grano del cristal con `feTurbulence` | El mismo grano pintado una vez a imagen |
| Fuentes de Google cargadas dos veces | Los mismos ficheros de fuente, servidos por la propia app y precargados; los iconos, solo los que se usan |

### 2.3 Medir antes, durante y después

Sin medir en el móvil real no se sabe qué pesa de verdad. La T0 deja una
**línea base en el Vivo** y en Chrome con la CPU frenada, con seis gestos
fijos, y cada bloque se vuelve a medir.

| Gesto | Qué se mide | Objetivo (Chrome 4×, 300 canciones) |
|---|---|---|
| Arrancar | Hasta ver la biblioteca e interactuar | < 1 s |
| Abrir la biblioteca | Del toque a la lista pintada | < 150 ms |
| Tocar un corazón | Del toque al corazón marcado | < 100 ms |
| Scroll de la biblioteca | Tareas de más de 50 ms durante 3 s de scroll | 0 |
| Abrir la pantalla completa | Fotogramas perdidos en el vuelo | < 5 % |
| Cambiar de canción | Del toque a la carátula y el título nuevos | < 150 ms |

---

## 3. Alcance

**Dentro:** D1-D14, en la APK, en la web desde el móvil y en ordenadores modestos.

**Fuera:**
- Cualquier cambio visual (§2.1).
- Reescribir la app en otro framework: el cuello de botella no es la ausencia
  de framework, es el trabajo de más que se hace.
- Cambiar de Capacitor 5 a una versión nueva: si la T0 lo señala como causa, se
  planifica aparte.

---

## 4. Tareas

### Bloque A — Medir y proteger la estética

#### T0 · Línea base en el Vivo y en Chrome

**Ficheros:** `test/perf/medir.mjs` (nuevo), `docs/planes/19-rendimiento.md` (resultados)

1. `medir.mjs`: Playwright con la CPU frenada 4× y 6×, una biblioteca sintética
   de 300 canciones (con miniaturas incrustadas y por enlace), los seis gestos
   de §2.3, y el recuento de tareas largas (`PerformanceObserver('longtask')`).
2. En el Vivo: una APK de perfilado (la de siempre con la depuración de la
   WebView activada, **sin publicar**) y `chrome://inspect` por USB. Una traza
   de Rendimiento por gesto; se anota qué se come el tiempo (script, maqueta,
   pintado, compositor).
3. Los números van a este plan, en §9. Las tareas siguientes se reordenan
   según lo que diga la traza.

#### T1 · Red de seguridad visual

**Ficheros:** `test/e2e/estetica.spec.js` (nuevo), `test/e2e/estetica.spec.js-snapshots/`

Capturas de referencia **antes de tocar nada**, con `toHaveScreenshot`:
Inicio, Biblioteca (canciones y artistas, con y sin canciones en la nube),
Listas, detalle de una lista, pantalla completa (con letra y con
visualizador), cola, hojas (ajustes, Tus datos, editar) y el aviso de
actualización. A 390 px (móvil) y 1280 px (escritorio), con datos fijos, las
animaciones congeladas y la fuente cargada. Tolerancia mínima (antialiasing).

Cada tarea de este plan termina con estas capturas en verde. Si una sale
distinta, la tarea no está hecha.

### Bloque B — Datos más ligeros (invisible)

#### T2 · Miniaturas fuera de la canción

**Ficheros:** `core/miniaturas.js` (nuevo), `features/download/save.js`, `features/download/download.js`, `core/storage.js` (migración)

1. Al descargar en la APK, la miniatura se guarda como fichero
   (`DATA/miniaturas/<videoId o id>.jpg`) y la canción guarda su ruta, que se
   resuelve con `convertFileSrc`. En la web ya es un enlace: no cambia.
2. Migración única `ytdl_miniaturas_v1`: cada base64 de la biblioteca, las
   listas y los favoritos pasa a fichero. El base64 se borra **solo después**
   de comprobar que el fichero se ha escrito y se lee.
3. Funciona sin conexión igual que antes: la miniatura sigue en el dispositivo.

#### T3 · La biblioteca en memoria

**Ficheros:** `features/library/library.js`, `features/playlists/store.js`, `features/sync/diario.js`

1. `getLibrary()` devuelve la copia en memoria (leída una vez al arrancar);
   `saveLibrary()` la actualiza y escribe en IndexedDB. Igual para las listas.
2. El diario de sincronización compara con la copia en memoria: sin lectura
   extra por guardado.
3. La copia de seguridad nativa (`library_backup_v1.json`) se escribe agrupada,
   unos segundos después del último cambio y al pasar a segundo plano, no en
   cada toque.
4. Si otra pestaña cambia la biblioteca (web), un `BroadcastChannel` invalida
   la copia en memoria.

#### T4 · Filas ligeras

**Ficheros:** `features/library/library.js`, `features/playlists/playlists.js`, `features/player/queue-sheet.js`

1. Fuera `data-song`: la fila solo lleva su `src`; la canción se busca en
   memoria.
2. Un escuchador por lista (delegación de eventos) en lugar de uno por botón y
   fila.
3. Las miniaturas de las filas con `loading="lazy"`, `decoding="async"` y su
   tamaño declarado.

### Bloque C — Pintar menos (idéntico a la vista)

#### T5 · Actualizaciones quirúrgicas

**Ficheros:** `features/library/library.js`, `features/favorites/store.js`, `features/playlists/playlists.js`

Un corazón cambia ese corazón; añadir, quitar o editar una canción cambia esa
fila; la rejilla de listas solo se repinta si cambian las listas. Un
`renderFila(src)` y un repintado completo solo cuando cambia el orden o el
filtro.

#### T6 · No pintar lo que no se ve

**Ficheros:** `styles.css`

`content-visibility: auto` y `contain-intrinsic-size` en las filas de la
biblioteca, las listas, la cola y los resultados de búsqueda; `contain:
layout paint` en tarjetas y filas. El navegador no maqueta ni pinta lo que
está lejos de la pantalla.

#### T7 · Animación de listas sin medir de más

**Ficheros:** `ui/motion/list.js`

`measure` y `animateListChange` trabajan solo con las filas que cruzan la
pantalla (más un margen). Lo que el usuario ve se anima igual; lo de fuera
llega a su sitio sin coste.

#### T8 · El cristal, igual y más barato

**Ficheros:** `styles.css`, `features/player/player.js`, `features/player/controls.js`

1. Las barras de progreso y volumen con `transform`/`clip-path` en lugar de
   `width`: la superficie de cristal que las contiene deja de repintarse 4
   veces por segundo.
2. Cada superficie de cristal en su propia capa y con `contain: paint`: lo que
   cambia dentro no obliga a recalcular lo de fuera.
3. El grano (`feTurbulence`) pintado una vez a imagen.
4. Durante una animación de hoja, lo que hay debajo no se repinta.
5. Cada cambio, comprobado con las capturas de la T1 y medido con la T0: si
   uno no mejora, se deshace.

#### T9 · Animaciones en el compositor

**Ficheros:** `ui/motion/spring.js`, `ui/sheets.js`, `ui/nav.js`, `ui/downloads-hud.js`, `features/player/full-player.js`, `features/lyrics.js`

Las animaciones que no siguen al dedo (abrir y cerrar hojas, la píldora de la
navegación, los avisos, la carátula que respira, el desplazamiento de la letra)
pasan a Web Animations con la **misma curva** en `linear()` (`springToLinear`
ya la calcula). Se ejecutan en el compositor aunque el hilo principal esté
ocupado. El `Spring` de JavaScript se queda para lo interactivo (arrastrar,
reorientar a mitad).

**Comprobación:** para cada animación migrada, fotogramas del antes y el
después a los mismos instantes; la posición no puede diferir más de 1 px.

### Bloque D — Arranque y trabajo de fondo

#### T10 · Fuentes propias

**Ficheros:** `frontend/public/fonts/` (nuevo), `styles.css`, `index.html`

Los mismos ficheros de Inter y Plus Jakarta Sans (solo latín y latín
extendido, en woff2) y Material Symbols recortada a los iconos que usa la app,
servidos por la app y precargados. Fuera el `@import` y el `<link>` a Google.
En la APK, las fuentes van dentro: sin red y sin esperar.

#### T11 · Cargar cada cosa al usarla

**Ficheros:** `main.js` y los módulos afectados

`import()` dinámico para la letra, el visualizador, la copia de seguridad y
«Tus datos», el editor, la vista de artistas, el aviso de actualización y la
página de descarga. Objetivo: JS inicial por debajo de 150 KB. Lo que se abre
con un toque se precarga cuando la app queda en reposo, para que el primer
toque no espere.

#### T12 · Arranque en dos tiempos y trabajo de fondo que cede

**Ficheros:** `main.js`, `ui/tareas.js` (nuevo), `loudness-backfill.js`, `sync/sync.js`, `sync/identidad.js`

1. Primero se pinta la biblioteca (de la copia en memoria de la T3). Las
   migraciones que ya se hicieron no se vuelven a comprobar en cada arranque.
2. Todo lo demás pasa por un planificador con prioridades (`ui/tareas.js`):
   sincronización, sonoridad, identidades, comprobar la actualización. Se
   **pausa** mientras hay scroll, un dedo en la pantalla o una animación, y
   se trocea en pasos de menos de 16 ms.

#### T13 · Un solo latido para la reproducción

**Ficheros:** `features/player/player.js`, `listens.js`, `transitions.js`, `lyrics.js`, `system-session.js`

Un único `timeupdate` reparte el tiempo a quien lo necesita: la barra solo si
se ve, la letra solo si cambia de línea, la sesión nativa solo si ha pasado
un segundo. Las transiciones y las escuchas no cambian.

### Bloque E — La parte nativa

#### T14 · APK de release con la misma firma

**Ficheros:** `mobile/android/app/build.gradle`, `scripts/sync-apk.sh`, `mobile/android/app/proguard-rules.pro`

1. Compilación de release (R8, sin `debuggable`), firmada con la **misma
   clave** de siempre para que se instale encima de la 1.4.x.
2. Reglas de ProGuard para Capacitor y sus plugins.
3. **Solo se adopta si la T0 y una segunda medición demuestran mejora** y la
   instalación encima de la versión anterior conserva los datos.

#### T15 · Menos viajes al puente nativo

**Ficheros:** `native/media-session.js`, `features/player/system-session.js`

La posición a la sesión del sistema, solo cuando cambia de verdad (pausa,
salto, cambio de canción) y no cada segundo con la música sonando; la
carátula, una vez por canción.

### Bloque F — Que no vuelva a pasar

#### T16 · Presupuesto de rendimiento

**Ficheros:** `test/perf/presupuesto.spec.js` (nuevo), `package.json` (`npm run test:perf`), `test/frontend/test_estructura.mjs`

1. Los objetivos de §2.3 como test con la CPU frenada 4× y 300 canciones: si
   una función nueva los empeora, el test falla.
2. Tamaño máximo del JS y el CSS iniciales en `test_estructura` (como ya se
   hace con las 600 líneas por módulo).

#### T17 · Tests del plan

| Qué | Dónde |
|---|---|
| La biblioteca en memoria: coherente tras guardar, tras sincronizar y con otra pestaña | `test/frontend/test_biblioteca_memoria.mjs` (nuevo) |
| Migración de miniaturas: pasa a fichero, no pierde ninguna si falla a mitad, idempotente | `test/frontend/test_miniaturas.mjs` (nuevo) |
| El planificador: prioridades, pausa durante el scroll, trozos < 16 ms | `test/frontend/test_tareas.mjs` (nuevo) |
| `springToLinear` frente al `Spring` de JavaScript: la misma curva (±0,5 %) | `test/frontend/test_motion_spring.mjs` |
| Filas sin `data-song`; un corazón no repinta la lista | recorridos |
| Capturas de la T1 en verde | `test/e2e/estetica.spec.js` |
| Presupuesto de la T16 en verde | `test/perf/presupuesto.spec.js` |

---

## 5. Qué no hacer

- **Quitar o rebajar efectos** para ganar fluidez: ni menos desenfoque, ni
  menos animación, ni el modo `lite` en el Vivo.
- Optimizar sin medir: cada cambio se mide con la T0 antes y después, y lo que
  no mejora se deshace.
- Guardar menos a menudo a costa de perder datos: lo que se agrupa se escribe
  también al pasar a segundo plano o cerrar.
- Borrar un base64 antes de comprobar que su fichero existe y se lee.

---

## 6. Orden de ejecución y despliegue

```
T0 → T1                 medir y fotografiar (sin cambios para el usuario)
T2 → T3 → T4            datos ligeros          → desplegar + APK 1.5.0
T5 → T6 → T7            pintar menos           → desplegar
T8 → T9                 cristal y animaciones  → desplegar
T10 → T11 → T12 → T13   arranque y fondo       → desplegar + APK 1.5.1
T14 → T15               nativo                 → APK (release, si la medición lo avala)
T16 → T17 con cada bloque
```

Tras cada bloque: las capturas de la T1 y la medición de la T0, en la web y
en el Vivo.

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Una optimización cambia algo a la vista | Media | Capturas de la T1 en cada tarea; si cambia, no entra |
| La copia en memoria se desincroniza de IndexedDB | Media | Un único punto de escritura; `BroadcastChannel` entre pestañas; tests de coherencia |
| La migración de miniaturas pierde alguna | Baja | El base64 se borra solo tras leer el fichero; idempotente; se reanuda si se interrumpe |
| Guardar agrupado pierde el último cambio si la app muere | Baja | Escritura inmediata en IndexedDB (lo agrupado es solo la copia de seguridad nativa) y vaciado al pasar a segundo plano |
| R8 rompe un plugin de Capacitor | Media | Reglas de ProGuard; la APK de release solo se adopta tras probarla entera en el emulador y en el Vivo |
| `linear()` no existe en una WebView antigua | Baja | Se detecta; en ese caso, el `Spring` de JavaScript como hasta ahora |
| Las capturas fallan por diferencias de la GPU o de la fuente | Media | Chromium fijo de Playwright, fuentes propias (T10), animaciones congeladas, zonas dinámicas enmascaradas |
| `content-visibility` hace saltar la barra de scroll | Media | `contain-intrinsic-size` con la altura real de cada fila |

---

## 8. Definición de hecho

- [ ] Línea base en el Vivo y en Chrome anotada (§9), y la medición final junto a ella.
- [ ] Los seis objetivos de §2.3 cumplidos en Chrome con la CPU 4×.
- [ ] En el Vivo, el scroll y los toques sin tirones perceptibles (prueba del usuario).
- [ ] Las capturas de la T1 idénticas al principio y al final del plan.
- [ ] Presupuesto de rendimiento (T16) como test permanente.
- [ ] Todas las suites en verde.

---

## 9. Mediciones

*(Se rellena en la T0 y al cerrar cada bloque.)*
