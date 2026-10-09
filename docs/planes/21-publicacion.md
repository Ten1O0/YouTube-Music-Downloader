# 21 — Publicación: la app y el repositorio, listos para todo el mundo

**Estado:** pendiente · **Prioridad:** 🔴 Alto (presentación pública) · **Depende de:** 16 (hecho, APK 1.8.0)

> La app se va a presentar en un post de LinkedIn: cientos o miles de personas
> entrarán en la web, sobre todo desde el móvil, se descargarán la APK y verán
> el código en GitHub, que pasa de privado a público con licencia MIT. Este
> plan reúne todo lo que hay que dejar bien antes: fallos, pulido, la firma de
> producción de la APK, el repositorio y su historial.

---

## 1. Qué hay que resolver

| id | Qué | Dónde | Efecto hoy |
|----|-----|-------|------------|
| D1 | Sin «repetir», la cola no se vacía: lo ya escuchado vuelve a salir como «siguiente» | `queue-sheet.js` (la cola se pinta dando la vuelta), `player.js` (`next` y `prev` dan la vuelta al llegar a un extremo) | La cola parece en bucle aunque no lo esté; con la radio, las escuchadas siguen ahí |
| D2 | «Cerrar sesión» desde Ajustes: la confirmación sale **detrás** de la hoja | Orden de los modales (`index.html`, `ui/sheets.js`): mismo `z-index`, y el último del HTML gana | No se puede cerrar la sesión desde Ajustes; «Continuar con Google» tiene el mismo problema |
| D3 | Guardar una canción de la radio solo se puede desde la hoja de la cola | Mini reproductor y pantalla completa | Demasiado escondido: no se sabe que es de la radio ni cómo quedársela |
| D4 | Unos 20 textos siempre en castellano | Hoja de la cola, títulos de botones, avisos de aleatorio y repetir, progreso, fecha del historial | Un visitante en inglés ve la app a medio traducir |
| D5 | El botón ⋮ de la pantalla completa no hace nada | `index.html` (`.full-player-more-btn`) | Botón muerto, a la vista |
| D6 | La APK se firma con la clave de depuración del portátil y es una compilación depurable | `mobile/android/app/build.gradle` | Si se pierde el portátil, no se pueden publicar más actualizaciones; la APK pública es depurable y pesa 10,6 MB |
| D7 | El historial de git lleva ficheros que no deben publicarse | Ver §2.4 | Música con derechos de autor, un token caducado de Spotify, la lista personal de canciones y 21 APK (203 MB) |
| D8 | Sin política de privacidad, y el inicio de sesión con Google puede seguir en modo «prueba» | Web y consola de Google Cloud | En modo prueba solo entran los usuarios añadidos a mano; con datos de usuarios, en la UE hace falta la política |
| D9 | Un pico de visitas puede hacer que YouTube bloquee la IP del servidor («confirma que no eres un bot») | `backend/server.py` (yt-dlp) | Las descargas dejarían de funcionar para todos, sin un mensaje que lo explique |
| D10 | Detalles del servidor | Cortafuegos y SSH | Una regla vieja abre el puerto 5001 sin nada detrás; fail2ban apagado |

---

## 2. Decisiones (tomadas con el usuario, 2026-10-04)

### 2.1 Dónde se publica

En la web (music.dannarita.es) y en GitHub, con la APK descargable desde las
dos. **Google Play no**: sus políticas no admiten apps que descargan
contenido de YouTube.

### 2.2 La cola sin «repetir» (D1)

- **Sin «repetir»:** la hoja de la cola enseña solo lo que viene después de la
  que suena; lo escuchado desaparece y no vuelve. «Siguiente» en la última,
  sin radio, no vuelve a la primera: la cola se acaba. «Anterior» sigue
  pudiendo volver a las escuchadas (están en la lista; solo dejan de verse
  como «siguientes»).
- **Con «repetir todo»:** como hoy, da la vuelta.
- **Con la radio:** la primera de la radio pasa a sonar, las otras suben un
  puesto y se empieza a preparar otra, de modo que siempre haya **al menos 3
  listas** además de la que suena (sea de la biblioteca o de la radio).

### 2.3 Guardar desde la radio, a la vista (D3)

Cuando la que suena es de la radio, el mini reproductor y la pantalla completa
lo dicen con una marca **«Radio»** y un botón **Guardar** (+) junto al corazón.
Al pulsarlo, se guarda al momento (o «se guardará al terminar» si aún se
prepara) y la marca desaparece: ya es de la biblioteca.

### 2.4 El historial de git (D7)

Se reescribe con `git filter-repo` y se sustituye el de GitHub. **Los 234
commits se conservan**, con sus mensajes, autores y fechas originales; solo
desaparecen estos ficheros de todas las versiones:

| Fichero | Por qué |
|---|---|
| `direct_test.mp3`, `test2.mp3`, `test_playlist.mp3` | Descargas de prueba del primer commit: música real con derechos de autor |
| `.spotdl-cache` | Un token de acceso de Spotify (caducado a la hora; no sirve, pero no pinta nada) |
| `downloaded_titles.txt` | La lista personal de canciones descargadas |
| `ytmusic.apk`, `releases/ytmusic.apk` | 21 versiones, 203 MB: las APK van a las *Releases* de GitHub |

- Dos commits quedan **vacíos**, porque solo tocaban esos ficheros: «Remove
  stuff» y «chore: Remove cached Spotify access token file». Se conservan
  (`--prune-empty never`) para que la historia siga siendo la misma.
- Los identificadores (hash) de **todos** los commits cambian: es inevitable al
  reescribir. Los que se citan en los planes se actualizan con el mapa que deja
  `filter-repo`.
- Revisión de seguridad hecha (2026-10-04, gitleaks y búsquedas a mano en los
  234 commits): **ninguna clave, token en vigor ni secreto**; el `JWT_SECRET` de
  producción no aparece nunca (comparado por huella con los 8 literales del
  historial); los fallos antiguos que documentan los planes están cerrados,
  comprobado desde fuera.

### 2.5 La firma de producción (D6)

Una clave propia, nueva, **solo para esta app**, que firmará todas las
versiones a partir de la **2.0.0**:

- Las contraseñas **nunca** van al repositorio: `build.gradle` las lee de
  `~/.gradle/gradle.properties` (fuera del repositorio). Sin ellas, las
  compilaciones de desarrollo siguen firmándose con la de depuración.
- **Copia de seguridad obligatoria** de la clave y sus contraseñas (gestor de
  contraseñas y un disco aparte): sin ella no hay más actualizaciones.
- Al cambiar de firma, Android no deja instalar la 2.0.0 encima de la 1.8.0:
  quien ya tenga la app tendrá que **desinstalarla y reinstalarla una vez**. Sus
  datos vuelven con su cuenta de Google o con la copia de «Tus datos». Las
  novedades de la 2.0.0 y la página de descarga lo dirán.
- La APK pública pasa a ser la **release** (R8, sin depuración, 4,4 MB),
  preparada desde el plan 19 (T14).

### 2.6 El botón ⋮ (D5)

Abre una hoja **«Opciones de la canción»** con lo que tiene sentido para lo
que suena: **Añadir a una lista**, **Ir al artista**, **Compartir** (Web Share
del sistema; si no hay, copiar el enlace de YouTube), **Abrir en YouTube** y,
si es de la radio, **Guardar en la biblioteca**.

### 2.7 Licencia

**MIT** (ya está en `LICENSE` y en el README). El README añade un aviso: la
app es para uso personal, y cada uno es responsable de respetar los derechos
de autor y las condiciones de YouTube.

---

## 3. Tareas

Reparto entre dos sesiones, como en los planes 16 y 19: **A**, la que coordina
(firma, historial, GitHub y lo del reproductor), y **B**, la otra. Cada fichero
tiene un dueño en cada fase; lo compartido se avisa antes.

### Bloque A — Fallos

#### T1 · La cola sin «repetir» (A)

**Ficheros:** `features/player/queue-sheet.js`, `features/player/player.js`, `features/radio/radio.js` (si hace falta), tests

1. La sección «Cola» pinta `q.slice(actual + 1)` sin «repetir» y da la vuelta
   solo con «repetir todo». De paso, los textos fijos de la hoja de la cola y
   de los avisos de aleatorio y repetir pasan a `i18n.t()` (ver T4).
2. `next()` en la última, sin «repetir» ni radio: no vuelve a la primera.
   `prev()` en la primera, sin «repetir»: vuelve al principio de la canción.
3. Con la radio: comprobar que tras cada canción quedan al menos 3 listas
   además de la que suena.
4. E2E 85: cola de 3 sin «repetir»; al pasar, las escuchadas desaparecen de la
   cola y al acabar no vuelve a la primera. E2E 86: con la radio, siempre 3
   listas.

#### T2 · «Cerrar sesión» y «Continuar con Google» detrás de Ajustes (B)

**Ficheros:** `ui/sheets.js` (la pila de modales), `index.html` o `styles.css`

El modal que se abre después queda **siempre encima**, venga de donde venga
en el HTML: la pila de `sheets.js` asigna el orden al abrir. E2E: desde Ajustes,
la confirmación de cerrar sesión recibe el toque (`elementFromPoint`) y cierra
la sesión; lo mismo con el inicio de sesión.

### Bloque B — Pulido

#### T3 · Guardar desde la radio, a la vista (A)

**Ficheros:** `index.html`, `styles.css`, `features/player/ui.js`, `features/radio/puente.js`, traducciones

Marca «Radio» y botón Guardar en el mini reproductor y en la pantalla completa
(§2.3). Capturas de estética nuevas con una canción de la radio. E2E 87:
guardar desde la pantalla completa la lleva a la biblioteca sin descargas.

#### T4 · Textos sin traducir (B)

**Ficheros:** `index.html`, `features/player/queue-sheet.js`, `features/player/player.js`, `features/search.js`, `features/youtube-playlist.js`, `features/history.js`, `features/favorites/panel.js`, `features/library/library.js`, `features/download/download.js`, `features/download/save.js`, `features/auth.js`, traducciones

| Dónde | Textos |
|---|---|
| Hoja de la cola | «Cola de reproducción», «Reproduciendo ahora», «A continuación», «Cola», «Quitar» |
| Avisos | «Aleatorio activado/desactivado», «Repetir desactivado / todo / canción» |
| Títulos de botones | «Escuchar preview», «Descargar», «Descargar de nuevo», «Quitar de favoritos», «Añadir a favoritos», «Favorito», «Añadir a playlist», «Eliminar», «Volver a descargar» |
| Progreso | «¡Descarga completada!», «Guardando en la app...», «Obteniendo canciones de la playlist...» |
| Google | «Intentando recargar...», «Reintentar Cargar Google» |
| Fecha del historial | `toLocaleDateString('es-ES')` → el idioma de la interfaz |

Los de `player.js` (avisos de aleatorio y repetir) y los de la hoja de la cola
(`index.html` y `queue-sheet.js`) los pasa **A** dentro de la T1, porque esos
ficheros son suyos en esta fase, con las claves que **B** añade a las
traducciones en su bloque «// Plan 21, T4» (B le pasa la lista antes). B pone
al final un test que falle si vuelve a aparecer un texto fijo en castellano en
un `title=` o en `showStatus` / `updateProgress`.

#### T5 · El botón ⋮ (B)

**Ficheros:** `index.html`, `styles.css`, `features/player/full-player.js` (o un módulo nuevo), traducciones

La hoja «Opciones de la canción» (§2.6), con las acciones que ya existen en la
app (añadir a una lista, ir al artista, guardar de la radio) y dos nuevas
(compartir, abrir en YouTube). Si la radio está en juego, usa el puente
(`radio/puente.js`, de A: avisar antes de tocarlo). E2E 88.

#### T6 · Política de privacidad (B)

**Ficheros:** `frontend/privacidad.html` (nuevo), `vite.config.js`, enlaces en Ajustes y en la página de descarga, traducciones

Qué se guarda (correo, nombre y foto de Google; biblioteca, listas, favoritos,
historial y escuchas de quien inicia sesión), para qué, dónde, cuánto tiempo y
cómo borrarlo; sin publicidad ni terceros. Castellano e inglés como mínimo.

**Hoy no hay forma de borrar una cuenta:** ninguna ruta borra el usuario y sus
datos (`users`, `download_history`, `favorites`, `library_items`, `playlists`,
`listens`, `user_settings`, `followed_*`), y `download_events` guarda el título
y el usuario de cada descarga sin caducidad. **A decidir por el usuario:**
- (a) un botón **«Borrar mi cuenta»** en Ajustes, con su ruta en el servidor y
  sus tests (trabajo nuevo, dentro de esta tarea), o
- (b) que la política diga «escríbeme a <correo> y lo borro», con el correo que
  el usuario quiera publicar.

Y un **plazo** para `download_events` y los registros de nginx (que guardan la
IP), que la política tiene que dar.
**Decidido (2026-10-08): la opción (a); 90 días para `download_events` y 30 para
los registros de nginx.**
**Paso del usuario:** en la consola de Google Cloud, pasar la pantalla de
consentimiento a **producción** con la página principal y la de privacidad.

#### T7 · Preparados para un pico de visitas (B)

**Ficheros:** `backend/server.py`, traducciones, `test/backend`

1. Si yt-dlp responde que YouTube pide confirmar que no es un bot, el servidor
   lo devuelve con un código propio y la app lo explica («YouTube está
   limitando las descargas; prueba en un rato») en vez de un error genérico.
2. Un tope global de descargas por hora, además del de cada IP, para no
   disparar el bloqueo de YouTube. **El valor lo elige el usuario**, a partir
   de lo que se ve hoy en `download_events` y de lo que aguanta el VPS.
   **Decidido (2026-10-08): 600 por hora en todo el servidor, y el máximo por
   cuenta o IP de los lotes baja de 300 a 100.** Datos de partida: 182 descargas
   en dos semanas, la hora más intensa con 103 (pruebas) y un VPS de 2 núcleos
   y 3,8 GB.
3. Medir yt-dlp y la memoria con varias descargas a la vez **en local o con el
   yt-dlp simulado**: hacerlo contra YouTube desde producción podría provocar
   el bloqueo que se quiere evitar. En el VPS, solo con permiso expreso y pocas
   descargas reales.

### Bloque C — La firma de producción

#### T8 · La clave de producción (A)

**Ficheros:** `mobile/android/app/build.gradle`, `scripts/sync-apk.sh`, `mobile/README.md`

1. `keytool`: RSA 4096, 10 000 días, en `~/.android/music-downloader.jks`.
2. `build.gradle` lee la ruta y las contraseñas de `~/.gradle/gradle.properties`;
   sin ellas, firma de depuración (desarrollo).
3. `sync-apk.sh --release` comprueba que la firma es la de producción (huella
   SHA-256) antes de copiar la APK, y se queja si no.
4. Copia de seguridad hecha por el usuario y comprobada (§2.5).

#### T9 · La APK 2.0.0 (A)

**Ficheros:** `build.gradle`, `frontend/public/app-version.json`, `frontend/download.html`

Release firmada con la clave nueva; novedades en seis idiomas, incluido el
aviso de desinstalar la anterior; la página de descarga lo explica. En el
emulador: la 2.0.0 se instala limpia, y encima de la 1.8.0 Android la rechaza
como se espera. **Despliegue con permiso del usuario.**

### Bloque D — GitHub

#### T10 · El README al día (A)

**Ficheros:** `README.md`, `docs/capturas/` (nuevo)

Lo que hace la app hoy (radio, Ajustes, importar listas, tu año en música,
rendimiento), capturas (las de estética, con datos de prueba), instalar la APK
desde *Releases* o la web, desarrollo en local, tests, arquitectura, el aviso
de uso personal (§2.7) y la licencia. Sin datos del servidor de producción.

#### T11 · Releases en GitHub (A)

`gh release create v2.0.0` con la APK y las novedades. La página de descarga
de la web sigue sirviendo la suya. `releases/` pasa a `.gitignore` (el
despliegue usa la APK local).

#### T12 · Repositorio presentable (A y B)

Descripción, temas, enlace a la web e imagen para redes (A). Los planes 01, 08,
09, 10 y 15 dicen «sin desplegar» o «implementado» en su fichero: al día (B).

#### T13 · La limpieza del historial (A, la última de todas)

1. Copia completa antes (`git clone --mirror` y un `git bundle`), fuera del
   repositorio.
2. `git filter-repo --invert-paths` con los ficheros de §2.4 y
   `--prune-empty never`.
3. Comprobar: 234 commits; para cada uno, mismo mensaje, autor y fechas que
   antes (lista comparada línea a línea); el último árbol, idéntico salvo lo
   quitado; gitleaks limpio.
4. Actualizar los hash citados en los planes con el mapa de `filter-repo`
   (un commit más).
5. **Con permiso del usuario:** `git push --force` y las etiquetas.
6. El usuario hace público el repositorio (o se hace con `gh`, con su permiso).

**Ensayo (2026-10-08), sobre una copia espejo, sin tocar el repositorio ni GitHub:**

- `git filter-repo` 2.47 tarda un segundo. El paquete baja de **52,3 a 20,0 MiB**.
  Lo que queda grande son las pantallas de arranque de Android y las capturas
  de referencia de la E2E, que son legítimas.
- **234 commits** antes y después. Autor, correo, fechas de autor y de commit, y
  asunto, idénticos en los 234 (comparados línea a línea).
- El cuerpo cambia en **un solo mensaje**: `filter-repo` reescribe el hash
  `dc3f3e2` citado en él por el nuevo, así que la referencia sigue siendo válida.
- El árbol del último commit es idéntico salvo `releases/ytmusic.apk`.
- gitleaks: solo quedan los dos falsos positivos de `MIGRATION_FLAG_KEY`. El token
  de `.spotdl-cache` ha desaparecido.
- Hash citados en ficheros (paso 4): 4, en `docs/planes/04-…`, `11-…` e `INDEX.md`.
- `test/e2e/ficheros/*.mp3|m4a` se quedan: son sintéticos y ocupan pocos KB.
- En GitHub: sin PR, issues ni forks. Hay una release antigua, «Version 1.0» (etiqueta
  `V1`), con la APK de la firma de depuración. La etiqueta se reescribe con el resto.
- GitHub puede seguir sirviendo por su hash los commits antiguos hasta que pase
  su recolector de basura. Hay dos opciones, a elegir por el usuario en el paso 5:
  **(a)** push forzado al mismo repositorio y, si se quiere, pedir a GitHub Support
  que limpie los objetos huérfanos; **(b)** borrar el repositorio y crearlo de nuevo
  con el mismo nombre, lo más limpio, pero se pierden la estrella y la release antigua.

### Bloque E — Servidor (B, con permiso del usuario en el momento)

#### T14 · Ordenar el servidor

Quitar la regla del puerto 5001 del cortafuegos y activar fail2ban para SSH.

### Bloque F — Tests

#### T15 · Tests del plan

Los de cada tarea (E2E 85-88, unidad y servidor), las capturas de estética
nuevas y la suite entera en verde antes de cada fase.

#### T16 · Borrador del post (opcional, A)

Si el usuario lo quiere: un borrador del post de LinkedIn con enlaces a la web,
a GitHub y a la APK.

---

## 4. Orden

```
Fase 1 (en paralelo)   A: T1, T3          B: T2, T4, T5, T6, T7      → E2E entera → commits (con permiso)
Fase 2                 A: T8, T9                                     → despliegue + APK 2.0.0 (con permiso)
Fase 3                 A: T10, T11, T12   B: T12 (docs), T14 (con permiso)
Fase 4                 A: T13             → push forzado (con permiso) → el repositorio se hace público → el post
```

El historial se limpia **al final**, cuando ya no quedan commits por hacer:
así se reescribe una sola vez y no hay que rehacer trabajo a medias.

---

## 5. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Se pierde la clave de producción | Baja | Copia en el gestor de contraseñas y en un disco aparte antes de publicar la 2.0.0 (T8) |
| Usuarios de la 1.8.0 pierden datos al reinstalar | Media | Aviso en las novedades y en la página de descarga; los datos vuelven con la cuenta o la copia de «Tus datos» |
| La reescritura del historial sale mal | Baja | Copia `--mirror` y `bundle` antes; comprobación commit a commit antes del push |
| YouTube bloquea la IP del servidor con el pico de visitas | Media | T7: tope global y mensaje claro; si pasa, se ve en el registro y se puede pausar |
| Algo de producción en el repositorio público | Baja | Revisión hecha (§2.4); el README no lleva datos del servidor |

---

## 6. Definición de hecho

- [ ] La cola sin «repetir» se vacía y con la radio siempre hay 3 listas.
- [ ] Cerrar sesión e iniciarla funcionan desde Ajustes.
- [ ] Guardar desde la radio está a la vista en el reproductor.
- [ ] Ningún texto fijo en castellano; el botón ⋮ hace algo útil.
- [ ] Política de privacidad publicada y Google en producción.
- [ ] APK 2.0.0 release con la firma de producción, con copia de la clave.
- [ ] README al día, *Release* en GitHub, historial limpio y verificado.
- [ ] Suites en verde; repositorio público.

---

## 7. Registro

### Sesión B: T2, T4, T5, T6 y T7 (2026-10-08)

**T2 · Las hojas, en el orden en que se abren.** `ui/sheets.js` sube el
`z-index` de la hoja que se abre por encima de las abiertas y lo devuelve al
cerrarla. Antes ganaba la última del HTML, y «Cerrar sesión» y «Continuar con
Google» quedaban detrás de Ajustes. Recorrido 89 (comprueba quién recibe el
toque con `elementFromPoint`; falla si se quita el arreglo).

**T4 · Sin textos fijos.** Unas 110 claves nuevas en los seis idiomas: los de
la tabla, más lo que salió al recorrer la app en inglés (las hojas de listas,
permisos y la APK, títulos y `aria-label`). `language-manager.js` entiende
`data-i18n-aria`. `test_textos_fijos.mjs` falla con cualquier `title`,
`placeholder` o `aria-label` sin traducir en `index.html`, y con textos fijos
en `title=`, `showStatus`, `avisar`, `updateProgress` o fechas en el código.

**T5 · El botón ⋮.** «Opciones de la canción» (`player/opciones.js`, cargado al
primer toque): añadir a una lista, ir al artista, compartir (o copiar el
enlace), abrir en YouTube y, si es de la radio sin guardar (`song.radio`),
guardarla. Recorrido 88. Por el camino, dos fallos que ya existían:
- Cerrar «Añadir a playlist» encima de la pantalla completa la cerraba también:
  `add-sheet.js` ocultaba la hoja al instante y el «atrás» del historial que
  llegaba después ya no veía ninguna abierta.
- Escape con una hoja encima de la pantalla completa también la cerraba: la
  hoja salía de la pila antes de que el reproductor mirara. Ahora cede si el
  evento ya viene atendido (`defaultPrevented`).

**T6 · Privacidad.** `DELETE /api/account` (con sesión, 5 por hora) borra la
cuenta y todo lo suyo (el resto de tablas, por `ON DELETE CASCADE`, y su
registro de descargas aparte); un test falla si mañana aparece una tabla con
`user_id` sin cascada. «Borrar mi cuenta» en Ajustes, con confirmación. El
registro de descargas se borra solo a los 90 días (`purgar_eventos`, en el
barrido diario). La política (`/privacidad`, castellano e inglés): responsable
Dan Narita, contacto por correo, servidor en la UE; sus plazos salen de las
mismas constantes que el servidor (`test_privacidad.mjs`). Recorrido 90.
**Falta en el servidor (T14):** que nginx guarde sus registros 30 días, como
dice la política.

**T7 · El pico de visitas.** `backend/pico.py`:
- Reconoce en la salida de yt-dlp que YouTube limita al servidor («not a bot»,
  «rate-limited», captcha, HTTP 429; «confirm your age» no cuenta). La búsqueda,
  las listas y la radio responden **503 `youtube_limit`**; una descarga termina
  con **`error_youtube_limit`**. Y durante 10 minutos no se lanza nada nuevo:
  insistir alarga el bloqueo.
- Tope global de **600 canciones por hora** (descargas sueltas, lotes, ZIP y
  radio), **429 `server_busy`**; el de cada cuenta o IP baja de 300 a **100**
  (`lotes.py`, **429 `hour_limit`**). El cliente traduce los tres códigos.
- **Medido** en local, con el yt-dlp actual (2026.08.19) y las opciones del
  servidor: 5 descargas a la vez en 13 s, unos 95 MB cada una (la primera,
  406 MB: arranca el resolutor de JavaScript), 634 MB en el pico. El servidor
  hace como mucho 5 a la vez (`MAX_WORKERS`), así que necesita ~0,7 GB libres
  en el peor momento. 600 por hora son 10 por minuto: el tope es por YouTube,
  no por la máquina.

### Sesión A: T1, T3, T8, T9, T10, T11 a T13 preparadas y T16 (2026-10-04 a 2026-10-08)

**T1 · La cola sin «repetir».** `next()` y `prev()` ya no dan la vuelta sin
«repetir todo». La hoja de la cola deja de enseñar como siguientes las ya
escuchadas, y se repinta si está abierta cuando cambia la canción. Con la radio,
la que suena no aparece como «siguiente». Recorridos 85 y 86.

**T3 · Guardar desde la radio.** Marca «Radio» junto al artista y botón dorado
para guardar en la barra y en la pantalla completa, solo con `song.radio`.
Recorrido 87. Por el camino salió un fallo: al guardar, la canción cambia de
`src` y `actualizarCancion` comparaba con el viejo, así que el botón seguía a la
vista. Ahora compara con los dos.

**T7 (la parte de la radio).** `frenarSi` pausa la radio un minuto con un 429 o
con `youtube_limit`, `server_busy` o `hour_limit`, y avisa con el motivo en vez
de «no encuentra canciones». Salió un fallo: la semilla se marcaba como pedida
antes de saber la respuesta, así que tras un límite no se volvía a pedir nunca.
Ahora se olvida si falla por un límite o por la red. Recorrido 92.

**T8 y T9 · La firma de producción y la 2.0.0.**
- Clave RSA 4096 en `~/.android/music-downloader.jks`. La huella SHA-256 está
  en el README y en `sync-apk.sh`, que se niega a dejar en `releases/` una APK
  con otra firma. `sync-apk.sh` compila la release por defecto y `--debug` hace
  una de prueba.
- La APK release ocupa 4,6 MB, no es depurable y está probada en el emulador:
  instalación limpia y, después, otra 2.0.0 encima (`install -r`) sin desinstalar.
- Instalada encima de la 1.8.0 da `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, como se
  esperaba; la página de descarga y las novedades lo explican.

**Las hojas con scroll en el móvil.** Venía del plan 09 y salió al probar la
APK, en Ajustes (en producción también pasaba). El anillo especular de las
hojas (`::before`, `absolute; inset: 0`) se desplazaba con el contenido, así
que sus lados y su línea de abajo quedaban a media altura. En el móvil ahora
solo pinta el borde de arriba, como el de la hoja. La estética sigue 14/14.

**E2E completa: 88 de 88.** El 63 falló a la primera: «Nueva» se traduce desde
la T4, y en francés «Nouvelle» partía «Mes playlists» en dos líneas a 360 px.
Ahora es «Créer».

**T10 · README.** Reescrito con las funciones actuales, la instalación, la API
al día (incluidos los códigos de los topes) y las capturas.
`scripts/capturas-readme.mjs` las genera con artistas inventados y portadas
dibujadas en el navegador.

**T11 a T13.** `releases/` deja de versionarse: está en `.gitignore`, el test
lo vigila y `sync-apk.bat` ya no copia ahí una APK de depuración. Las notas de
la versión, la imagen para compartir el repositorio y el ensayo de la limpieza
del historial (ver T13) están preparados. Falta el permiso del usuario.

### T14 · El servidor ordenado (sesión A, 2026-10-09)

Con permiso del usuario, y con copia previa en `/root/copias` de `jail.local` y
de las reglas de ufw:

- **Puerto 5001:** se quita la regla de ufw (v4 y v6). No escuchaba nada, y
  desde fuera ya sale cerrado.
- **fail2ban:** estaba instalado y apagado, con 32 MB de `auth.log` de intentos
  de entrada por SSH con usuarios inventados. Ahora arranca con el sistema. La
  cárcel `sshd` no tenía acción (detectaba, pero no bloqueaba): se le añade
  `iptables[name=sshd, port=ssh]`. Queda «suave», como pidió el usuario: 5
  fallos en 10 minutos, una hora de bloqueo, y su IP en `ignoreip`. Nada más
  arrancar, bloqueó 7 IP que estaban atacando.
- **Registros de nginx:** music.dannarita.es escribe en el `access.log` común,
  que se rota cada día y guarda 14. Ya cumple los 30 días que promete la
  política, así que no se toca.
- **Fuera de este plan:** n8n escucha en el 5678 por HTTP y Docker se salta ufw,
  así que está abierto a internet. El usuario lo mirará después de publicar.
