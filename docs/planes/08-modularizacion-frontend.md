# 08 — Modularización del frontend

**Estado:** pendiente · **Prioridad:** 🔵 Estructural · **Depende de:** 01, 06 (duras) · 05 (recomendada)
**Puntos del análisis:** 15 (+ tres hallazgos nuevos, ver D2 a D4)

> El monstruo. Va solo y va último.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | 7.420 líneas en un único fichero, cargado con `type="module"` y **cero `import`/`export`** | `app.js`, `index.html:1219` | Vite no puede dividir código ni eliminar lo muerto: todo se descarga siempre |
| D2 | **(nuevo)** Dos constantes distintas para la misma URL base | `API_BASE` (app.js:13) y `API_URL` (app.js:1581) | Dos fuentes de verdad con **lógica distinta** para decidir si estamos en nativo |
| D3 | **(nuevo)** 68 comprobaciones `typeof X !== 'undefined'` y 85 accesos por `globalThis` | `app.js` | Son parches al orden de carga: el código no sabe qué existe cuando se ejecuta |
| D4 | **(nuevo)** Hay más código suelto que código en módulos | `app.js` | 122 funciones y 93 constantes en el ámbito global, contra 14 módulos |

### La estructura real de `app.js`

Los módulos IIFE no son el problema; el problema es **lo que hay entre ellos**:

| Bloque | Desde | Líneas | Composición |
|---|---:|---:|---|
| Preámbulo (entorno, `getApiBase`) | 1 | 29 | Suelto |
| `NativeMediaSession` + **38 funciones sueltas** | 30 | 997 | El IIFE ocupa una fracción |
| `OnboardingModule` | 1028 | 131 | Limpio |
| `StorageModule` | 1160 | 164 | Limpio |
| `FavoritesModule` | 1325 | 265 | Limpio |
| `TRANSLATIONS` | 1591 | 370 | Datos puros |
| `LanguageManager` | 1962 | 118 | Limpio |
| `AuthManager` | 2081 | 548 | Limpio |
| `AudioUrlCache` + **55 funciones sueltas** | 2630 | 1.607 | Descarga, búsqueda, progreso, utilidades… |
| `QueueManager` | 4238 | 244 | Limpio |
| `PlayerModule` | 4483 | 809 | Limpio |
| `NavigationModule` | 5293 | 166 | Limpio |
| `LibraryModule` | 5460 | 266 | Limpio |
| `PlaylistModule` | 5727 | 1.308 | Limpio, pero enorme |
| `LyricsModule` | 7036 | 384 | Limpio |

Es decir: **unas 2.600 líneas de funciones sueltas** —la descarga, la búsqueda,
el progreso, el guardado nativo, la importación de audio, la recuperación PWA—
viven en el ámbito global, entre módulo y módulo. El análisis decía que «cada
módulo IIFE es ya un fichero candidato tal cual», y es cierto; lo que no es
trivial es decidir dónde va todo lo demás.

### D2 · Dos verdades sobre dónde estamos corriendo

```js
// app.js:5-13
const getIsNative = () => (
    (globalThis.Capacitor !== undefined && globalThis.Capacitor.isNative) ||
    (globalThis.Capacitor !== undefined && ['android','ios'].includes(globalThis.Capacitor.platform)) ||
    (navigator.userAgent.includes('Capacitor'))
);
let API_BASE = getApiBase();

// app.js:1581 — mil quinientas líneas más abajo
const API_URL = globalThis.Capacitor?.isNative
    || window.location.protocol.includes('file')
    || window.location.protocol.includes('capacitor')
    ? 'https://music.dannarita.es' : '';
```

Dos detecciones distintas, dos constantes, y las dos se usan: `API_BASE` en
`resolveStreamSrc` y `API_URL` en todas las peticiones. `API_BASE` además se
recalcula (`updateEnvironment()`), y `API_URL` es `const`: se evalúa una vez al
cargar y **no se entera** si Capacitor se inyecta después. Es el mismo patrón de
«dos fuentes de verdad» que el plan 01 encontró en los favoritos.

### D3 · Los `typeof` son el síntoma, no la causa

```js
if (typeof LibraryModule !== 'undefined') { ... }
if (typeof showStatus === 'function') showStatus('Añadido a favoritos', 'success');
if (globalThis.queueManager !== undefined) queueManager.add(...);
```

68 veces. No hay ninguna razón para que `LibraryModule` no exista cuando se llama
—está en el mismo fichero— salvo la incertidumbre de no tener declaradas las
dependencias. Con `import`, esa incertidumbre desaparece por construcción y las
68 comprobaciones se pueden borrar.

---

## 2. Decisiones de diseño

### 2.1 Por qué depende del plan 06 y por qué eso no es negociable

Un refactor de 7.400 líneas no se verifica leyendo. Lo que se necesita es poder
responder «¿hace lo mismo que antes?» después de cada paso, y eso son los
**siete recorridos de Playwright del plan 06 T7**, que no dependen de cómo esté
organizado el código por dentro.

> Si el plan 06 T7 se recortó a tres recorridos (descarga, recarga, favoritos),
> este plan sigue siendo viable pero hay que añadir una pasada manual por
> playlists, reproductor y letras después de cada bloque.

**Y depende del plan 01** porque no se mueve código y se arreglan bugs de datos a
la vez: cuando algo falle a mitad del refactor, hay que poder descartar que sea el
refactor.

### 2.2 Una fase intermedia con puente de globales

El salto directo —convertir los 14 módulos en ficheros con `export` de golpe— es
una noche entera sin poder probar nada. La alternativa es un puente:

```js
// src/bridge.js — TEMPORAL, se borra en el último paso
import { LibraryModule } from './library/library-module.js';
globalThis.LibraryModule = LibraryModule;
```

Mientras un módulo ya está extraído pero sus consumidores todavía no, el puente lo
publica como global y **el código sin migrar sigue funcionando igual**. Cada paso
queda mergeable y desplegable.

| Alternativa | Veredicto |
|---|---|
| Big bang: todo a la vez | ❌ Imposible de revisar, imposible de revertir por partes |
| **Módulo a módulo con puente de globales** | ✅ **Elegida**: cada paso es un commit desplegable |
| Convivencia larga (dejar el puente indefinidamente) | ❌ Es el peor de los dos mundos; el puente **tiene** que morir en T9 |

### 2.3 Orden: las hojas primero

Se extrae primero lo que no depende de nada, y se va subiendo:

```
Nivel 0  config/env.js · config/constants.js        (D2 se arregla aquí)
Nivel 1  core/storage.js · i18n/translations.js · i18n/language-manager.js
Nivel 2  core/audio-url-cache.js · core/api.js · ui/status.js
Nivel 3  features/favorites.js · features/library.js · features/queue.js
Nivel 4  features/player.js · features/playlists.js · features/lyrics.js
Nivel 5  features/auth.js · features/download.js · features/search.js
Nivel 6  ui/navigation.js · ui/onboarding.js · native/*
Nivel 7  main.js  (arranque y enlace de eventos)
```

Regla: **un módulo solo se extrae cuando todo lo que importa ya está extraído.**
Así nunca hay un `import` apuntando a algo que todavía vive en el global.

### 2.4 Los ciclos son el riesgo real

`PlayerModule` llama a `LibraryModule.setPlaying`, `LibraryModule` llama a
`PlayerModule.play`, y `PlaylistModule` llama a los dos. Con globales eso
funciona; con módulos ES, un ciclo puede dar `ReferenceError: Cannot access 'X'
before initialization` (zona muerta temporal) **solo en ciertos órdenes de
carga**, que es la peor clase de fallo.

| Técnica | Cuándo usarla |
|---|---|
| Mover lo compartido a un módulo de nivel inferior | Primera opción siempre |
| Importar la **función**, no el objeto, y llamarla tarde | Ciclos suaves |
| Bus de eventos (`emit('song:changed', …)`) | Cuando A avisa a B sin necesitar su respuesta: es el caso de `setPlaying` |
| Inyección en el arranque (`player.setLibrary(library)`) | Último recurso |

**Detectar los ciclos antes de tener el problema** con `madge --circular src/`,
como parte de T9.

### 2.5 Lo que este plan rompe: ya no se puede servir sin build

Hoy `server.py:280` sirve `index.html` desde `dist/` **o**, si no hay build,
desde la raíz — y esa segunda vía funciona porque `app.js` es un fichero suelto
que el navegador puede cargar tal cual. Con módulos ES repartidos en `src/`, eso
deja de ser cierto: **`npm run build` pasa a ser obligatorio**.

Consecuencias que hay que atender en T9:
- `deploy.sh` sube `app.js` en crudo en su array `FILES`: hay que quitarlo.
- `server.py` debería fallar con un mensaje claro si no hay `dist/`, en vez de
  servir un `index.html` que no puede funcionar.
- El plan 02 T0 metió `app.js` en `PUBLIC_FILES`: hay que quitarlo de ahí.
- El plan 04 D6 ya avisaba de esto: sin Node en el portátil no hay despliegue de
  frontend posible. **Con este plan, eso pasa de inconveniente a bloqueante**, y
  por eso el plan 04 T1 debería estar hecho antes.

---

## 3. Alcance

**Dentro:** `app.js` → `src/**`, `index.html` (la etiqueta del script),
`vite.config.js`, `deploy.sh`, `server.py` (solo el respaldo sin build) y los
tests unitarios de JS que ahora sí son posibles.

**Fuera:**
- Cambiar comportamiento. **Ni un arreglo de paso.** Si aparece un bug, se anota y
  se arregla en un PR aparte: es la única forma de que «no rompió nada» sea
  demostrable.
- `styles.css` (4.344 líneas): merece su propio plan.
- `index.html` (1.239 líneas) más allá de la etiqueta del script.
- Añadir un framework. Esto es reorganizar lo que hay, no reescribirlo.
- TypeScript. Tentador tras separar módulos, pero es otro plan.

---

## 4. Tareas

### Bloque A — Preparación

---

#### T1 · Inventario de dependencias reales

**Ficheros:** `docs/planes/08-inventario.md` (nuevo, temporal)

**Qué hacer**

1. Para cada uno de los 14 módulos y para las 122 funciones sueltas, anotar qué
   usa y quién lo usa. Se puede arrancar mecánicamente:

   ```bash
   grep -nE "^(async )?function [a-zA-Z0-9_]+" app.js | sed 's/.*function \([a-zA-Z0-9_]*\).*/\1/' \
     | while read -r fn; do printf "%-40s %s\n" "$fn" "$(grep -c "\b$fn(" app.js)"; done | sort -k2 -rn
   ```

2. Marcar las que tienen **0 llamantes**: son código muerto y se borran antes de
   mover nada. Ya se sabe de una, `downloadBlobAndSave` (app.js ~6547), que **no
   tiene ningún llamante** — dato relevante porque el plan 01 escribió sobre ella.

3. Dibujar el grafo entre los 14 módulos y marcar los ciclos.

**Por qué** Mover código sin saber quién lo llama es cómo aparecen los
`typeof X !== 'undefined'`. Este inventario es el que decide el orden de §2.3 y
detecta los ciclos de §2.4 **antes** de tropezar con ellos.

**Verificación** El documento existe, los 14 módulos tienen sus dependencias
anotadas y los ciclos están marcados.

---

#### T2 · Borrar el código muerto

**Ficheros:** `app.js`

**Qué hacer**

Eliminar lo que T1 haya marcado con cero llamantes, empezando por
`downloadBlobAndSave` y su cadena de auxiliares si no los usa nadie más.

> ⚠️ **Antes de borrar `downloadBlobAndSave`**, comprobar el estado de la
> reapertura del plan 01 (ver `INDEX.md`, hallazgo D6): si se decidió hacer que
> el camino web real (`saveDownloadToApp`) persista el audio en IndexedDB, es
> posible que esa función pase a usarse de verdad. Coordinar antes de borrar.

**Por qué** Mover 200 líneas que nadie ejecuta cuesta lo mismo que mover 200 que
sí, y además hay que decidir en qué módulo colocarlas. Borrar primero reduce el
trabajo y el riesgo.

**Verificación** Los siete recorridos de Playwright en verde tras el borrado.
`node --check app.js` pasa.

---

#### T3 · Esqueleto de `src/` y puente de globales

**Ficheros:** `src/` (nuevo), `index.html:1219`, `vite.config.js`

**Qué hacer**

1. Crear `src/main.js` que, de momento, **importe el `app.js` actual sin tocarlo**:

   ```js
   import './legacy/app.js';
   ```
   con `app.js` movido a `src/legacy/app.js` y nada más cambiado.

2. Apuntar `index.html` a `/src/main.js` (`<script type="module" src="/src/main.js">`).

3. Comprobar que `vite build` sigue generando un `dist/` equivalente y que
   `npm run dev` funciona.

4. Crear `src/bridge.js`, vacío de momento, con un comentario que diga que es
   temporal y que T9 lo borra.

**Por qué** Es el paso que no cambia nada y lo habilita todo: a partir de aquí,
cada módulo extraído sale de `legacy/app.js` y entra en su fichero, y el resto
sigue funcionando.

**Verificación** `npm run build` y `npm run dev` funcionan, y los siete
recorridos de Playwright pasan contra la build nueva. Comparar el tamaño de
`dist/assets/*.js` antes y después: debe ser casi idéntico.

---

### Bloque B — Extracción, por niveles

---

#### T4 · Nivel 0-1: entorno, constantes, almacenamiento e i18n

**Ficheros:** `src/config/env.js`, `src/config/constants.js`, `src/core/storage.js`, `src/i18n/translations.js`, `src/i18n/language-manager.js`

**Qué hacer**

1. **`config/env.js`** — y aquí se corrige **D2**, que es la razón de empezar por
   aquí:

   ```js
   export const isNative = () => (
       globalThis.Capacitor?.isNative === true ||
       ['android', 'ios'].includes(globalThis.Capacitor?.platform) ||
       navigator.userAgent.includes('Capacitor') ||
       location.protocol.startsWith('capacitor') ||
       location.protocol.startsWith('file')
   );

   export const REMOTE_API = 'https://music.dannarita.es';
   export const apiBase = () => (isNative() ? REMOTE_API : '');
   ```

   Una sola detección, que **une las dos lógicas actuales** (la de `getIsNative`
   y la de `API_URL`, que miraba el protocolo). Y una **función**, no una
   constante: así deja de importar si Capacitor se inyecta después de cargar el
   módulo, que es el fallo latente de `const API_URL`.

   Sustituir los usos de `API_BASE` y `API_URL` por `apiBase()`. Son unos pocos y
   `grep -c "API_URL\|API_BASE"` da el número exacto.

2. **`core/storage.js`**: `StorageModule` tal cual, con `export`. Es el módulo
   más limpio y el que más cosas importan; buen primer paciente.

3. **`i18n/translations.js`**: las 370 líneas de `TRANSLATIONS`, que son datos
   puros y no dependen de nada.

4. **`i18n/language-manager.js`**: `LanguageManager` + la instancia `i18n`,
   importando lo anterior.

5. Publicar cada uno en `bridge.js` a medida que salen.

**Por qué** Son las hojas del grafo: no importan nada del resto. Y arreglar D2
aquí, al principio, evita arrastrar dos constantes a través de 20 ficheros.

**Verificación** Playwright en verde. `grep -c "API_URL" src/` → 0.
`grep -rn "TRANSLATIONS" src/legacy/app.js` → solo el import del puente.

---

#### T5 · Nivel 2-3: caché de audio, API, avisos, favoritos, biblioteca y cola

**Ficheros:** `src/core/audio-url-cache.js`, `src/core/api.js`, `src/ui/status.js`, `src/features/favorites.js`, `src/features/library.js`, `src/features/queue.js`

**Qué hacer**

1. **`core/api.js`** es nuevo: hoy las llamadas `fetch` están repartidas por todo
   `app.js` repitiendo cabeceras y tratamiento de errores. Concentrarlas:

   ```js
   export async function apiFetch(path, options = {}) { ... }   // añade apiBase(), cabeceras y token
   ```
   Es el único módulo que este plan **crea** en vez de mover, y se justifica
   porque sin él cada `feature` importaría `apiBase()` y repetiría el mismo
   preámbulo.

2. **`ui/status.js`**: `showStatus` / `hideStatus` / `updateProgress`. Lo llaman
   desde todas partes, así que tiene que estar abajo en el grafo.

3. **`features/favorites.js`**: `FavoritesModule` **ya limpio tras el plan 01**
   (sin la capa legacy de globales), que por eso es dependencia de este plan.

4. **`features/library.js`** y **`features/queue.js`**: `LibraryModule` y
   `QueueManager` + `queueManager`.

**Por qué** Es la capa donde el `typeof` empieza a desaparecer: con `import`
declarado, las 68 comprobaciones de D3 pierden su razón de ser. Borrarlas **a
medida que se extrae cada módulo**, no al final.

**Verificación** Playwright en verde tras cada módulo.
`grep -c "typeof .* !== 'undefined'" src/` baja en cada commit.

---

#### T6 · Nivel 4: reproductor, playlists y letras

**Ficheros:** `src/features/player.js`, `src/features/playlists.js`, `src/features/lyrics.js`, `src/core/events.js`

**Qué hacer**

1. Crear **`core/events.js`**, un bus mínimo, para romper los ciclos de §2.4:

   ```js
   const handlers = new Map();
   export const on = (evt, fn) => { ... };
   export const emit = (evt, payload) => { ... };
   ```

2. Extraer `PlayerModule` (809 líneas). Donde hoy llama a
   `LibraryModule.setPlaying(src)`, emitir `emit('player:song-changed', { src })`
   y que `library.js` se suscriba. Eso rompe el ciclo player ↔ library sin
   inyección ni importaciones perezosas.

3. Extraer `PlaylistModule` (1.308 líneas). **Es el más grande y conviene
   partirlo**: `playlists/store.js` (datos y persistencia), `playlists/render.js`
   (DOM) y `playlists/actions.js` (crear, borrar, reordenar). Es el único módulo
   donde este plan hace algo más que mover.

4. Extraer `LyricsModule` (384 líneas), que es casi independiente.

**Por qué** Es el corazón funcional de la app y donde están los ciclos. El bus de
eventos se introduce aquí y no antes porque es donde se necesita; meterlo en el
nivel 0 «por si acaso» sería inventar infraestructura sin caso de uso.

**Verificación** Playwright en verde, con atención especial a los recorridos 5
(playlists) y 6 (reproductor). `madge --circular src/` no encuentra ciclos.

---

#### T7 · Nivel 5-6: auth, descarga, búsqueda, navegación y nativo

**Ficheros:** `src/features/auth.js`, `src/features/download.js`, `src/features/search.js`, `src/ui/navigation.js`, `src/ui/onboarding.js`, `src/native/media-session.js`, `src/native/filesystem.js`, `src/native/recovery.js`

**Qué hacer**

Aquí caen las ~2.600 líneas de funciones sueltas de D4. El reparto propuesto:

| Fichero | Qué se lleva |
|---|---|
| `features/download.js` | `downloadFromUrl`, `saveDownloadToApp`, `handleDownload`, el progreso y los lotes |
| `features/search.js` | `searchAndShowResults`, `renderSearchResults`, `showNextPage`, `fetchAndShowPlaylist` |
| `features/auth.js` | `AuthManager` completo |
| `native/media-session.js` | `NativeMediaSession` |
| `native/filesystem.js` | `writeBlobToNativeFilesystem`, `writeBlobToDocumentsFilesystem`, `saveToNativeCapacitor`, `resolveStreamSrc` |
| `native/recovery.js` | `runNativeRecovery`, `scanPublicFolder` y sus auxiliares |
| `ui/navigation.js`, `ui/onboarding.js` | Los dos módulos, tal cual |

Las utilidades que no encajen en ningún sitio (`sanitizeFilename`,
`arrayBufferToBase64`, `extractVideoId`, `formatDuration`…) van a
`src/core/utils.js`. **Regla:** si una función la usan dos features distintas, es
una utilidad; si la usa una sola, se va con ella.

**Por qué** Es la parte con más criterio y menos mecánica del plan, y por eso va
después: cuando se llega aquí, los niveles de abajo ya están estables y se sabe
qué importa cada cosa.

**Verificación** Playwright completo. `src/legacy/app.js` debe haber quedado
prácticamente vacío.

---

### Bloque C — Cierre

---

#### T8 · `main.js`: arranque y enlace de eventos

**Ficheros:** `src/main.js`, `src/legacy/app.js` (se borra)

**Qué hacer**

1. Llevar a `main.js` lo que queda: el `DOMContentLoaded`, `migrateStorage()`,
   `i18n.init()`, el enlace de los botones y la inicialización de módulos, en el
   mismo orden que hoy.

2. Borrar `src/legacy/app.js`.

3. Declarar las dependencias globales que vienen de fuera (`Sortable`,
   `jsmediatags`, `google.accounts`, `YT`), que siguen cargándose como `<script>`
   en `index.html`. **No** convertirlas en `import`: `Sortable.min.js` está
   versionado en la raíz y los otros tres son CDN de terceros. Lo que sí hay que
   hacer es concentrar su acceso en un `src/core/vendor.js`:

   ```js
   export const getSortable = () => globalThis.Sortable;
   export const getJsMediaTags = () => globalThis.jsmediatags;
   ```
   Así queda **explícito y en un solo sitio** qué depende de un global externo.

**Por qué** El orden de arranque es la parte más frágil de la migración y merece
un fichero propio y legible, en vez de quedar disperso al final de un fichero de
7.000 líneas.

**Verificación** Playwright completo, en navegador **y** en la APK.

---

#### T9 · Quitar el puente y cerrar la cadena de build

**Ficheros:** `src/bridge.js` (se borra), `deploy.sh`, `server.py`, `vite.config.js`, `sync-apk.sh`

**Qué hacer**

1. Borrar `bridge.js` y todos los `globalThis.X = X`. Cada rotura que aparezca es
   un consumidor que se quedó sin migrar: se arregla con su `import`.

2. Comprobar que no quedan restos:

   ```bash
   grep -rn "typeof .* !== 'undefined'" src/ | wc -l     # objetivo: ~0
   grep -rn "globalThis\." src/ | grep -v vendor.js      # solo Capacitor y APIs del navegador
   madge --circular src/                                  # sin ciclos
   ```

3. Cerrar §2.5, **que es lo que puede romper el despliegue**:
   - quitar `app.js` del array `FILES` de `deploy.sh`;
   - quitar `app.js` de `PUBLIC_FILES` en `server.py` (plan 02 T0);
   - que `index()` devuelva un error explícito si no existe `dist/index.html`, en
     vez de servir el de la raíz;
   - comprobar que `sync-apk.sh` copia `dist/` (ya lo hace) y que la APK arranca.

4. Activar la división de código, que es el objetivo del punto 15 y solo ahora es
   posible:

   ```js
   const LyricsModule = await import('./features/lyrics.js');   // bajo demanda
   ```
   Buenos candidatos: letras, onboarding y la recuperación nativa. Medir antes y
   después.

**Por qué** Es lo que convierte el refactor en beneficio medible. Sin este paso,
se ha reorganizado el código y el usuario descarga exactamente lo mismo.

**Verificación** Playwright completo. Comparar `dist/assets/*.js`: el bundle
inicial debe ser **menor** que el de T3, con los trozos diferidos aparte.

---

#### T10 · Tests unitarios de JS

**Ficheros:** `vitest.config.js`, `src/**/*.test.js`, `.github/workflows/ci.yml`

**Qué hacer**

Ahora que hay `export`, los tests de JS dejan de necesitar el arnés.

**Punto de partida:** ya existen `test/frontend/test_utils.mjs` y
`test/frontend/test_plan01_datos.mjs` (84 tests en verde), que hoy cargan
`app.js` en un contexto `vm` a través de `test/frontend/harness.mjs`.

**Esta tarea incluye migrarlos:**

1. Sustituir `import { app } from './harness.mjs'` por imports directos de los
   módulos nuevos (`import { sanitizeFilename } from '../../src/core/utils.js'`).
2. Quitar el helper `plain()`: deja de hacer falta en cuanto los objetos ya no
   cruzan realms.
3. Devolver `atob` al comportamiento nativo: el arnés lo simulaba porque el de
   Node es más permisivo que el del navegador.
4. **Borrar `harness.mjs`.** Que desaparezca es la señal de que el plan ha
   cumplido su objetivo.

Los 84 tests deben seguir pasando **antes y después** de la migración: son la red
que permite mover 7.000 líneas sin romper nada.

Y además, escribir los que el plan 06 §2.2 dejó pendientes:

| Módulo | Qué probar |
|---|---|
| `config/env.js` | `isNative()` y `apiBase()` con los cuatro entornos simulados (web, Capacitor, `file:`, UA) |
| `core/utils.js` | `extractVideoId`, `sanitizeFilename`, `formatDuration` con casos borde |
| `i18n/language-manager.js` | `t()` con interpolación, clave ausente, idioma ausente |
| `core/audio-url-cache.js` | El desalojo al llegar al máximo, y que revoca (plan 01 T6) |
| `core/events.js` | Suscribir, emitir, desuscribir |
| `features/favorites.js` | Con `StorageModule` simulado: alternar, actualizar, listar |

Añadir `npx vitest run` al job `frontend` de CI.

**Por qué** Cierra el círculo con el plan 06: la razón por la que allí no se
pudieron escribir tests de JS era la falta de `export`, y este plan la elimina.

**Verificación** `npx vitest run` en verde en local y en CI, y
`test/frontend/harness.mjs` ya no existe en el repositorio.

---

## 5. Orden de ejecución y commits

```
T1 → T2 → T3                 (preparación: inventario, limpieza, esqueleto)
T4 → T5 → T6 → T7            (extracción por niveles; un commit por módulo)
T8 → T9 → T10                (cierre, división de código y tests)
```

**Un commit por módulo extraído**, no por nivel: un commit de «extraer
`StorageModule`» se revisa; uno de «extraer el nivel 1» no. Y **los recorridos de
Playwright se ejecutan en cada commit**, no al final del bloque.

Se puede mergear al terminar cada bloque. Lo que **no** se debe hacer es dejar el
puente de globales (`bridge.js`) vivo entre merges durante semanas: es deuda con
fecha de caducidad, y T9 es quien la paga.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| **Ciclos de importación con fallo intermitente (TDZ)** | **Alta** | Orden por niveles (§2.3), bus de eventos (T6) y `madge --circular` en T9 |
| Se cuela un cambio de comportamiento «de paso» | **Alta** | Regla explícita en §3: ni un arreglo; los bugs se anotan y van en otro PR |
| Romper el despliegue al dejar de servir `app.js` suelto | **Media** | §2.5 y T9 punto 3; probar `deploy.sh` en un entorno de prueba |
| Los recorridos de Playwright no cubren un camino y la regresión llega a producción | Media | Los caminos poco cubiertos (importar audio, recuperación nativa, letras) se prueban a mano en T7 y T8 |
| Romper la APK: `mobile/www` se queda con un build viejo | Media | `npm run sync:apk` (plan 04) tras T8, y probar en el móvil |
| El refactor se queda a medias y convive con el puente meses | **Media** | Mergear por bloques, pero T9 en el mismo trimestre; el puente tiene fecha |
| El bundle no adelgaza y el esfuerzo no se nota | Media | T9 punto 4 con medida antes/después; si no hay ganancia, decirlo |
| Conflictos con trabajo en paralelo sobre `app.js` | **Alta** | Este plan **exige congelar `app.js`**: nada más se mergea sobre él mientras dura |

---

## 7. Definición de hecho

- [ ] `app.js` ya no existe; `src/` tiene entre 20 y 25 módulos, ninguno de más de ~500 líneas.
- [ ] `src/bridge.js` borrado y sin `globalThis.X = X` en ningún sitio.
- [ ] `grep -rn "typeof .* !== 'undefined'" src/` → prácticamente 0, y cada resto justificado.
- [ ] Existe **una** forma de saber la URL base (`apiBase()`); no quedan `API_URL` ni `API_BASE`.
- [ ] `madge --circular src/` no encuentra ciclos.
- [ ] Los siete recorridos de Playwright pasan.
- [ ] `npx vitest run` pasa, con tests de al menos seis módulos.
- [ ] `npm run build` produce un bundle inicial **menor** que antes, con trozos diferidos.
- [ ] `./deploy.sh` despliega y la web funciona sin `app.js` en la raíz.
- [ ] `npm run sync:apk` produce una APK que arranca, descarga y reproduce.
- [ ] CI en verde: `ruff`, `pytest`, `vitest`, `npm run build` y Playwright.
