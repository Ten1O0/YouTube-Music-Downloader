# 16 — Modo radio

**Estado:** hecho (2026-09-30) · con la APK 1.8.0 · diseño revisado con el usuario · **Prioridad:** 🟢 Bajo-medio · **Depende de:** 10 (T1), 12 (motor de reproducción), 14 (T2, descargas que sobreviven), 19 (miniaturas en fichero), 20 (lotes de 3 en 3), hoja de Ajustes (APK 1.7.0)
**Propuesta que cubre:** 4 (al acabar la cola, seguir con canciones parecidas).

> Cuando la cola se acaba, la música se para. Con la radio, sigue: canciones
> parecidas a lo último que sonó, sacadas de YouTube, que se pueden guardar en
> la biblioteca si gustan (al instante: ya están en el dispositivo) o
> descartar si no.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | La cola se acaba y todo para | `PlayerModule.next()` sin más canciones y sin repetir | Silencio; hay que volver a elegir |
| D2 | La app solo reproduce lo descargado | `resolveStreamSrc` (idb://, fichero local) | Para «seguir con algo parecido» hace falta sonar canciones que no están en la biblioteca, que es justo lo que la app no sabe hacer |

---

## 2. Decisiones de diseño

### 2.1 De dónde salen las parecidas: las mezclas de YouTube

YouTube genera para cada vídeo una mezcla (`watch?v=<id>&list=RD<id>`) con
25-50 canciones relacionadas: lo que en YouTube se ve como «Mix». El servidor
ya sabe leerlas: `build_playlist_cmd` trata las listas `RD…` y las corta a 35
(`MAX_CANCIONES_MIX`). No hace falta ningún servicio de recomendaciones.

**Filtrado** de las candidatas (función pura en el cliente):
- Fuera las que ya sonaron en esta sesión de radio y las vetadas.
- Fuera los duplicados por título normalizado (`limpiarTitulo` del plan 11): la
  misma canción en vídeo oficial, audio y letra.
- Fuera lo que dure más de 10 minutos (mezclas y recopilatorios) o menos de 60 s.
- **Si la candidata ya está en la biblioteca, se usa la copia local**: suena al
  instante y no gasta datos.

**Semilla:** la última canción de la cola. Cuando a la radio le quedan pocas
candidatas, pide otra mezcla sembrada **alternando** entre la semilla original y
la última canción que sonó entera, para que la radio no se aleje demasiado del
punto de partida.

### 2.2 Cómo suena lo que no está descargado

| Alternativa | Veredicto |
|---|---|
| El servidor retransmite el audio mientras lo baja | ❌ El `m4a` de YouTube se remuxea al final; empezar a sonar a mitad de descarga es frágil, y cada escucha tendría al servidor ocupado de principio a fin |
| El navegador pide el audio directamente a YouTube | ❌ Las URLs de `googlevideo.com` van firmadas para la IP del servidor: desde el móvil dan 403 |
| **Descargar por el camino normal, a una caché de radio, con antelación** | ✅ **Elegida** |

Se usa el mismo camino que una descarga normal (el servidor baja con yt-dlp y
la app recoge el fichero), pero el audio va a una **caché de radio**, no a la
biblioteca ni al historial. Por ser audio local, el motor del plan 12 (fundido,
sin cortes, volumen igualado) y los controles del sistema funcionan igual.

### 2.3 La ventana de canciones listas (adaptable)

Una canción dura unos 3 minutos; descargarla lleva 5-20 s, y el servidor baja
**3 a la vez** (como los lotes del plan 20): las 3 primeras están listas en
unos 20 s, y en marcha la radio repone una canción cada 2-7 s. La radio mantiene
siempre una **ventana** de canciones listas por delante de la que suena:

| Situación | Ventana | Por qué |
|---|---|---|
| **Normal** | **3 listas** | Si la primera no gusta, las siguientes ya están. Unos 12 MB por delante |
| **Saltando deprisa** (2 saltos en menos de 30 s, o saltar antes de 15 s de escucha) | **crece a 6** | Quien busca «algo que le guste» salta varias seguidas: con 6 no se queda esperando |
| Vuelve a escuchar canciones enteras | **baja a 3** | Solo se gastan datos y descargas cuando hace falta |
| Datos móviles (si se permite la radio fuera del Wi-Fi) | 2 normal, 4 como mucho | Menos datos gastados por adelantado |

- **Arranque:** la ventana se llena **cuando a la cola le queda una canción**,
  no cuando termina: la radio empieza ya con colchón.
- **Reponer:** cada vez que una canción de radio suena o se salta, se empieza a
  bajar otra para volver a llenar la ventana.
- Con 6 fijas se gastarían ~25 MB por adelantado aunque nadie saltara, y 6
  descargas de golpe dejarían poco margen en el límite del servidor (§3).

**Si aun así la ventana se vacía**, en este orden:
1. **Suena la primera que esté lista**, no necesariamente la siguiente de la
   lista: con 3 bajando a la vez casi siempre hay alguna terminada, y en una
   radio el orden exacto da igual.
2. **Relleno instantáneo:** una canción de la mezcla que ya esté en la
   biblioteca (suena al momento y no gasta nada).
3. Solo si no hay nada: **«Preparando la radio…»** con el progreso de la que
   va más avanzada. Nunca silencio sin explicación.

### 2.4 La caché de radio

| | Web | APK |
|---|---|---|
| Dónde | IndexedDB, almacén de blobs con prefijo `radio:` | `DATA/radio/` con `Filesystem` (privado de la app, no en Documentos) |
| Tope | 10 canciones o 150 MB (cabe la ventana de 6 y un poco de «volver atrás») | Igual |
| Se borra | La más antigua al pasar el tope; todo al desactivar la radio | Igual |

Lo que se salta y ya estaba bajado se queda en la caché hasta que sale por
antigüedad: volver atrás a una canción de radio reciente suena al momento.

### 2.5 «Guardar en la biblioteca»: casi instantáneo

Guardar una canción de radio **no la vuelve a descargar**: el audio ya está en
el dispositivo, solo cambia de sitio y se añade a la biblioteca.

| | Qué hace | Cuánto tarda |
|---|---|---|
| **Web** | Mueve el blob de la caché (`radio:<id>`) a la biblioteca (`idb://<id>`), dentro de IndexedDB, sin red | Milisegundos |
| **APK** | Mueve el fichero de `DATA/radio/` a `Documentos/YTMusic/`. Son almacenamientos distintos, así que puede tocar copiar y borrar en vez de renombrar | Una fracción de segundo (3-5 MB) |

- **Los datos de la canción** (título, artista, carátula, duración) se conocen
  desde que llegó de la mezcla, y la carátula se guarda en fichero como las
  demás (plan 19, T2): aparece completa en la biblioteca al momento.
- **Es idéntica a una descarga normal:** mismo camino, así que lleva su medida
  de sonoridad (plan 12) y se sincroniza con la cuenta (plan 13) como cualquier
  otra.
- **Formato:** la radio descarga en el formato elegido (M4A o MP3): lo que se
  guarda es exactamente lo que se habría descargado a mano, y guardar nunca
  obliga a convertir.
- **Historial de descargas:** lo guardado desde la radio entra en el historial,
  como una descarga más. Lo que solo suena en la radio, no.

**Cuándo no es instantáneo:**
1. **Guardar mientras aún se descarga:** queda marcada («Se guardará al
   terminar») y se guarda sola en cuanto termina.
2. **Ya salió de la caché** (de las más antiguas, fuera del tope de 10): se
   descarga como una canción normal, con su tiempo habitual. Solo pasa al volver
   atrás mucho después de oírla.

### 2.6 Cómo se usa

- En la hoja de la cola, junto a aleatorio y repetir: un interruptor **Radio**
  («Al acabar, sigue con canciones parecidas»). Se recuerda.
- En el menú de una canción: **«Iniciar radio»** (la reproduce y la usa de semilla).
- Las canciones de radio aparecen en la hoja de la cola en su propia sección,
  «Radio», con dos acciones: **Guardar** y **No me gusta** (salta y la veta; no
  vuelve a salir). Vetadas: `radio_vetadas`, hasta 500.
- Con «Repetir todo» activo, la radio no entra: repetir manda.
- **Sin conexión**, la radio no puede traer nada nuevo: al acabar la cola avisa
  («La radio necesita conexión») y para. Lo que ya estaba en la caché sí suena.
- **Datos móviles:** ajuste «Radio solo con Wi-Fi» en la hoja de **Ajustes**
  (sección Reproducción), activado por defecto. Hoy la APK no sabe si está en
  Wi-Fi: se añade el plugin oficial `@capacitor/network` (5.x), con
  `navigator.connection.type` de respaldo en la web.
- **Web y APK:** la radio funciona en las dos.

---

## 3. Seguridad y límites

Cómo cuentan hoy las descargas en el servidor, y cómo las usa la radio:

| Ruta | Límite actual | La radio la usa para |
|---|---|---|
| `POST /api/lotes` (plan 20) | 3 lotes por minuto, 20 por hora; hasta 100 canciones por lote; **300 canciones por hora** por usuario; el servidor baja de 3 en 3 | **Llenar la ventana**: al arrancar (3 canciones) y al crecer a 6 (3 más), **una sola petición** cada vez |
| `POST /api/start-download` | 10 por minuto, 100 por hora | **Reponer de una en una** en marcha normal |

Así, llenar la ventana no gasta el límite de descargas sueltas, y una sesión de
radio (15-20 canciones por hora escuchando, algunas más saltando) cabe de sobra.
Si aun así se llega a un límite (429), la radio no insiste: sigue con lo que
tenga listo y con el relleno de §2.3.

| Medida | Por qué |
|---|---|
| El `videoId` de la semilla se valida (`^[A-Za-z0-9_-]{11}$`) y la URL `RD` la construye el servidor | Nada del cliente llega tal cual a yt-dlp |
| `GET /api/radio`: 20 por minuto por IP; caché en el servidor de 30 min por semilla (tope de 200 semillas) | Cada mezcla es una llamada a yt-dlp |
| Las descargas de la radio cuentan contra los límites normales (tabla de arriba) | Nadie puede usar la radio para saltarse los límites |
| Títulos con `html\`…\`` (plan 10, T1) | Vienen de YouTube |
| La caché de la APK en `DATA` (privada), no en Documentos | Que otras apps no vean ni reproduzcan lo que no se guardó |

---

## 4. Alcance

**Dentro:** D1-D2, en la web y en la APK.

**Fuera:**
- Retransmitir en directo desde el servidor (§2.2).
- Emisoras temáticas («radio de rock»): exigiría búsquedas por género, otro diseño.
- Aprender de los gustos del usuario más allá de los vetos.

---

## 5. Tareas

### Bloque A — Servidor

#### T1 · Candidatas de radio

**Ficheros:** `backend/server.py` (o `backend/radio.py` nuevo, sin Flask, como `importar.py`)

1. `GET /api/radio?semilla=<videoId>`: construye `https://www.youtube.com/watch?v=<id>&list=RD<id>`,
   usa `build_playlist_cmd` y `parse_video_json_output`, y devuelve
   `{ candidatas: [ { id, title, channel, duration, thumbnail } ] }`.
2. Caché en memoria (`dict` con caducidad de 30 min, tope de 200 semillas) para
   no repetir la llamada a yt-dlp.
3. Límites de §3.
4. Si el módulo es nuevo, añadirlo a `scripts/deploy.sh` (FILES y `py_compile`):
   con `importar.py` se olvidó y el servidor no habría arrancado.

### Bloque B — Cliente

#### T2 · Elegir las siguientes

**Ficheros:** `frontend/src/features/radio/pick.js` (nuevo, puro)

`elegir(candidatas, { sonadas, vetadas, biblioteca, n })` con el filtrado de
§2.1. Devuelve canciones listas para la cola: locales si están en la biblioteca,
`{ radio: true, videoId, … }` si no. Y `ventana({ saltos, redMovil })`: cuántas
tener listas según §2.3 (función pura, con sus tests).

#### T3 · Descargar a la caché de radio y guardar

**Ficheros:** `features/download/download.js`, `features/download/save.js`,
`features/download/lotes.js`, `frontend/src/features/radio/cache.js` (nuevo), `core/storage.js`

1. La descarga suelta y la de lotes aceptan un destino: `'biblioteca'` (como
   hoy) o `'radio'`. Con `'radio'`: sin historial, sin biblioteca, sin aviso ni
   isla de descarga, y el audio (y su carátula) a la caché.
2. `cache.js`: `guardar`, `resolver(videoId)` (URL reproducible), `aBiblioteca(videoId)`
   (§2.5: mover sin descargar, con los datos, la carátula, la sonoridad y el
   historial), `recortar()` al tope, `vaciar()`.
3. «Guardar» mientras se descarga: marca y guarda al terminar.

**Cosas que no hacer:** no duplicar el camino de descarga para la radio. Un
único camino con destino, o se repite la historia del plan 05 (dos
constructores de comandos que se desincronizaron).

#### T4 · La radio en el reproductor

**Ficheros:** `frontend/src/features/radio/radio.js` (nuevo), `features/player/player.js`
(`next`, fin de cola), `features/player/queue-sheet.js` (sección e interruptor), traducciones

1. `radio.js`: estado (activa, semilla, sonadas, ventana, descargas en marcha),
   `alQuedarUna()` (pide la mezcla y llena la ventana con un lote),
   `siguiente()` (la primera lista; si no hay, relleno; si no, «Preparando la
   radio…»), `reponer()`, `guardar(cancion)`, `noMeGusta(cancion)`, y el
   crecimiento y la vuelta de la ventana según los saltos (§2.3).
2. `player.js`: cuando a la cola le queda una, avisa a la radio; al acabar, si
   la radio está activa, sigue con ella.
3. Hoja de la cola: interruptor, sección «Radio» con Guardar / No me gusta, y
   el estado de cada una (lista, bajando, se guardará al terminar).
4. Sesión del sistema: las canciones de radio se ven igual que las demás.

#### T5 · «Iniciar radio» y ajustes

**Ficheros:** menú de la fila (`features/library/library.js`), reproductor a
pantalla completa, hoja de Ajustes (`index.html`, `features/player/settings.js`),
`mobile/package.json` (`@capacitor/network`), traducciones

«Iniciar radio» en el menú de una canción; «Radio solo con Wi-Fi» en Ajustes,
activado por defecto. El plugin de red entra con la APK nueva.

### Bloque C — Tests

#### T6 · Tests del plan

| Qué | Dónde |
|---|---|
| `/api/radio`: valida la semilla, construye la URL `RD`, caché, límite | `test/backend/test_radio.py` (nuevo, yt-dlp simulado) |
| `elegir`: sonadas, vetadas, duplicados por título, duraciones, preferencia por lo local | `test/frontend/test_radio.mjs` (nuevo) |
| `ventana`: 3 normal, 6 saltando deprisa, vuelta a 3, menos con datos móviles | ídem |
| Caché: tope por número y por tamaño, vaciar al desactivar | `test/frontend/test_cache_radio.mjs` (nuevo, arnés) |
| Guardar: mueve sin volver a descargar (ninguna petición de red), con datos, carátula, sonoridad e historial; guardar mientras baja | ídem |
| El camino de descarga con destino `'radio'` no toca biblioteca ni historial | `test_plan01_datos.mjs` o nuevo |
| E2E 81 · cola de una canción con radio activa: al acabar suena una de la mezcla simulada, aparece en la sección Radio y «Guardar» la lleva a la biblioteca al momento | `recorridos.spec.js` + mezcla `RD` en `fake_ytdlp` |
| E2E 82 · «No me gusta» salta y la canción no vuelve | ídem |
| E2E 83 · saltar varias seguidas: la ventana crece y nunca hay silencio sin aviso | ídem |
| E2E 84 · sin conexión, al acabar la cola avisa y para | ídem |

---

## 6. Orden de ejecución, commits y despliegue

```
T1                  servidor                      → desplegar
T2 → T3             elegir, ventana y caché
T4 → T5             reproductor e interfaz        → desplegar + APK (plugin de red)
T6 con cada tarea
```

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La siguiente no llega a tiempo y hay silencio | Baja | Ventana de 3 (6 saltando), la primera lista suena primero, relleno de la biblioteca y, en el peor caso, «Preparando la radio…» en vez de pararse |
| Quien salta mucho agota los límites de descarga | Baja | Llenar la ventana va en lotes (una petición); reponer, de una en una; con un 429 se sigue con lo que haya |
| La radio se aleja del estilo original | Media | Semilla alternada (§2.1) |
| Gasta datos móviles sin que el usuario lo note | Media | «Solo con Wi-Fi» por defecto; con datos, ventana más pequeña; la caché se vacía al apagarla |
| Mover de `DATA` a Documentos falla en algún Android | Baja | Copiar y borrar si renombrar no puede; si todo falla, descarga normal |
| Carga del VPS con muchos oyentes | Baja (hoy) | Mismos límites que las descargas; la caché de mezclas evita repetir llamadas |
| YouTube cambia las mezclas `RD` | Baja | Si `/api/radio` falla, la radio avisa y para; nada más se rompe |

---

## 8. Definición de hecho

- [ ] Con la radio activa, la música sigue al acabar la cola, sin silencios.
- [ ] Ventana adaptable: 3 listas, 6 saltando deprisa.
- [ ] Guardar desde la radio es inmediato y la canción queda igual que una descargada a mano.
- [ ] Vetar desde la cola; iniciar radio desde una canción; «Solo con Wi-Fi».
- [ ] La caché respeta su tope y no ensucia la biblioteca.
- [ ] Todas las suites en verde, incluidos los recorridos 81-84.

---

## 9. Registro

Implementado en paralelo por dos sesiones (2026-09-30): T1, T2 y los
recorridos E2E en una; T3, T4 y T5 en la otra.

**Cómo quedó, respecto al diseño:**
- **La radio se carga aparte.** Con ella dentro, el JS inicial pasaba del
  presupuesto de la T16 del plan 19 (291 KB para 290): el test cumplió su
  función. `player.js` y la hoja de la cola hablan con un puente pequeño
  (`radio/puente.js`) que contesta «nada» con la radio apagada y carga
  `radio.js`, la caché, `pick.js` y `red.js` con `import()` al encenderla o al
  tocar «Iniciar radio».
- **Las de la radio entran en la cola real** al sonar, al final: el corazón,
  «anterior», el paso sin cortes y el fundido del plan 12 funcionan igual, y la
  siguiente de radio se prepara con antelación como cualquier otra.
- **Un solo camino de descarga, con un modo silencioso** (§5, T3): los lotes
  del plan 20 y una descarga suelta sin interfaz (`descargarEnSilencio`) aceptan
  un `recoger` propio. La descarga normal pintaba la barra de Inicio y la isla:
  la de la radio, a la vez que una del usuario, la habría pisado. La entrada de
  biblioteca y la del historial salen de las mismas funciones
  (`entradaDeBiblioteca`, `buildHistoryEntry`) en los dos casos.
- **«Iniciar radio»** va en el pie de la pantalla completa, en el hueco que dejó
  «Reproducción» al pasar a Ajustes. Deja la canción sola en la cola (lo de «a
  continuación» se respeta) y la usa de semilla. La radio también se enciende
  desde la cabecera de la cola y desde Ajustes; «Solo con Wi-Fi», en Ajustes,
  solo en la APK.
- **Los ajustes de la radio son de cada dispositivo:** el servidor descarta
  los campos de reproducción que no conoce, y el Wi-Fi depende del dispositivo.

**Comprobado en una prueba de humo** (servidor real, yt-dlp simulado): la
primera de la radio suena justo al acabar la semilla, sin silencio; la sección
«Radio» enseña las listas y las que van en camino; y «Guardar», sin nada en
camino, hace **0 peticiones de descarga**.

**Encontrado por el camino:**
- Si guardar una canción de un lote falla, el lote la seguía esperando y
  preguntaba al servidor cada segundo hasta caducar. En la radio, su `recoger`
  nunca lanza.
- El arnés de tests descarta en silencio los nombres exportados por dos
  módulos (`recortar` de la caché chocaba con el del resumen del año). Ahora
  un test de estructura falla con cualquier repetido nuevo; ya había 5, que
  quedan listados.
- El botón ⋮ de la cabecera de la pantalla completa no tiene ninguna acción:
  no hace nada al tocarlo.
- La mezcla simulada declaraba canciones de 20 s, que `elegir` descarta por
  cortas: la radio no elegía nada. Ahora declara la duración de una canción
  normal y genera un audio corto para que el test vaya rápido.

**El servidor, contra YouTube de verdad.** La orden de `/api/radio` con la
mezcla de `dQw4w9WgXcQ` tarda 2,6 s y da 35 vídeos: la semilla primero, como
se esperaba, y **26 candidatas únicas**, porque la mezcla repite canciones.
Todas traen duración. La lógica está en `backend/radio.py`, sin Flask, como
`importar.py`. Ya está en `scripts/deploy.sh` (FILES y `py_compile`).

**Tests:** `test_radio.py` (28), `test_radio.mjs` (17), `test_radio_red.mjs`
(9) y los recorridos 81-84 en verde, dos veces seguidas. E2E entera **80/80**,
backend 834, frontend 1056 y eslint y ruff sin avisos. El 81 comprueba que
«Guardar» no pide esa canción otra vez (mira la URL que va en el cuerpo de las
descargas): las demás de la radio siguen bajando por detrás mientras tanto.
