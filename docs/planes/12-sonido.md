# 12 — Sonido

**Estado:** pendiente · **Prioridad:** 🟡 Medio (experiencia) · **Depende de:** 10 (T1), 11 (T5, el contador de escuchas convive con el motor)
**Propuestas que cubre:** 2 (fundido y reproducción sin cortes), 3 (volumen igualado) y 19 (visualizador).

> Las tres piezas tocan lo mismo: cómo suena y cómo se pasa de una canción a
> otra. Hoy hay un único `<audio id="mainAudio">` que empieza cada canción en
> seco, a su volumen de origen, sin nada que se vea moverse con la música.

---

## 1. Problema

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | Un corte entre canciones | `PlayerModule.play` asigna `audio.src` al terminar la anterior (`'ended'` → `next()`) | Silencio de medio segundo o más mientras se resuelve el `src` y el navegador carga: se nota en discos en directo y en mezclas |
| D2 | Sin fundido | — | Cambio brusco, sobre todo al saltar a mitad de canción |
| D3 | Volúmenes muy distintos entre canciones | Cada fichero suena a su volumen de origen | Una canción de 2020 puede sonar 8-10 dB más alta que una de los 80: el usuario tiene que tocar el volumen |
| D4 | Nada se mueve con la música | Pantalla completa | La carátula respira al pausar (plan 09), pero la música no se ve |

---

## 2. Decisiones de diseño

### 2.1 La decisión clave: no pasar el audio por Web Audio

Lo habitual para fundidos y ecualización es enrutar el `<audio>` por un
`AudioContext` (`createMediaElementSource` → `GainNode` → altavoces). Aquí **no**:

| Riesgo de enrutar por Web Audio | Por qué importa aquí |
|---|---|
| En la APK, al apagar la pantalla, la WebView puede suspender el `AudioContext` | **La música se cortaría con el móvil bloqueado**, que es el uso principal de la app |
| `createMediaElementSource` es irreversible | Si algo falla, el elemento queda mudo hasta recargar |
| Cualquier fuente de otro origen sin CORS suena en silencio | La radio del plan 16 y el envío a teles del 18 cargarán audio del servidor desde la APK |

**Elegido: motor de dos elementos con volumen, y Web Audio solo para mirar.**

```
<audio A> ──► altavoces     (volumen A)
<audio B> ──► altavoces     (volumen B)      ← fundidos y sin cortes
             │
             └── captureStream() ──► AnalyserNode ──► <canvas>   ← visualizador
```

- La salida sigue siendo la del navegador: la reproducción en segundo plano de
  la APK no cambia en nada.
- Los fundidos y la igualación se hacen con `audio.volume`.
- El visualizador **escucha** una copia (`captureStream()`) y no puede cortar
  el sonido aunque falle.

El precio: `audio.volume` solo baja (máximo 1). La igualación **atenúa** las
canciones fuertes y no puede subir las flojas (§2.4).

**Antes de construir nada, T1 lo comprueba en un móvil real** con la pantalla
apagada diez minutos. Si `captureStream` o los dos elementos dieran problemas en
segundo plano, se sabrá el primer día.

### 2.2 Dos elementos, una sola «canción actual»

El resto del reproductor (barras, letras, sesión del sistema, contador de
escuchas, E2E) usa hoy `document.getElementById('mainAudio')` o la constante
`audio` de `player.js`. Para no reescribirlo:

- `features/player/engine.js` crea el segundo elemento y lleva la cuenta de cuál
  es el **actual**.
- **Invariante:** el elemento actual lleva siempre `id="mainAudio"`; al cambiar,
  los ids se intercambian. Los tests y cualquier código que busque por id
  siguen funcionando.
- `engine.audio` es un envoltorio con la misma interfaz que un `<audio>`
  (`play`, `pause`, `currentTime`, `duration`, `paused`, `volume`, `src`,
  `addEventListener`) que reenvía al actual. `player.js`, `controls.js`,
  `system-session.js` y `listens.js` reciben `engine.audio` en lugar del elemento.
- Los eventos del elemento **saliente** no llegan a los escuchadores: una
  canción que se apaga no actualiza la barra de la que entra.

### 2.3 Fundido y sin cortes

| Ajuste | Comportamiento |
|---|---|
| **Sin cortes** (0 s, por defecto) | La siguiente canción se precarga en el elemento libre en cuanto quedan 20 s; se arranca cuando quedan 0,25 s, y el `ended` de la anterior ya no espera a nada |
| **Fundido** de 2 a 12 s | Cuando quedan N s, arranca la siguiente a volumen 0 y se cruzan con curva de igual potencia (`cos`/`sin`), que no hunde el volumen a mitad |

- El cruce avanza con `timeupdate` (llega unas 4 veces por segundo también en
  segundo plano) y no con temporizadores, que Android frena con la app en
  segundo plano. A 4 Hz, un fundido de 2 s tiene 8 pasos, suficiente para el oído.
- **No hay fundido** al pulsar anterior o siguiente ni al elegir otra canción: ahí
  el usuario quiere el cambio ya. El fundido es solo para el paso natural al
  terminar, y con «Repetir una» tampoco (se repetiría a sí misma cruzándose).
- Con la canción en pausa o arrastrando la barra, el cruce se cancela.

> **Límite honesto de «sin cortes».** Con dos `<audio>` quedan 10-30 ms entre
> pistas, y los AAC llevan un relleno de codificador que YouTube no quita. Para
> un disco en directo se nota mucho menos que hoy, pero no es un corte de
> muestra exacta. La reproducción exacta exige decodificar a memoria cada
> canción entera (unos 20 MB por canción de 4 minutos en un móvil): no compensa.

### 2.4 Volumen igualado: medir una vez, atenuar al reproducir

**Medir** según la norma **ITU-R BS.1770 / EBU R128**: sonoridad integrada en
LUFS y pico real.

| Canción | Quién mide | Cómo |
|---|---|---|
| Descargadas a partir de ahora | El servidor, al terminar la descarga | `ffmpeg -i fichero -af loudnorm=print_format=json -f null -`, que devuelve `input_i` (LUFS) e `input_tp` (pico) |
| Ya descargadas e importadas del móvil | El cliente, en segundo plano | `core/loudness.js`: `OfflineAudioContext` mono a 22.050 Hz, filtro K de la norma y compuerta de −70 LUFS y −10 LU. Una canción cada vez y solo con la app inactiva |

**Aplicar:** `ganancia = min(1, 10^((objetivo − lufs) / 20))`, limitada para que
el pico no pase de −1 dBTP. **Objetivo: −16 LUFS.** Es algo más bajo que el de
Spotify (−14) a propósito: como solo se puede bajar, un objetivo bajo deja
iguales a más canciones. El volumen del usuario multiplica por encima.

- Ajuste «Igualar volumen», activado por defecto.
- Se guarda en la canción: `loudness: { lufs, pico, fuente: 'servidor' | 'cliente' }`.
- Sin medida todavía, ganancia 1: suena como hoy.

**Coste en el servidor:** decodificar un AAC de 4 minutos para medirlo lleva
unos 2-3 s de CPU. Se hace después de entregar el progreso «completado», con
`nice 10`, y bajo el mismo semáforo que las conversiones a MP3
(`MAX_TRANSCODES`), para no competir con las descargas.

### 2.5 El visualizador

- Barras bajo la carátula de la pantalla completa, con el color de la carátula
  (la paleta del plan 09, T11). 32 barras con escala logarítmica de frecuencias.
- `AnalyserNode` con `fftSize: 256` y `smoothingTimeConstant: 0.8`.
- **Solo dibuja con la pantalla completa visible**, la pestaña en primer plano y
  sin «Reducir movimiento». Tope de 30 fps. Si no se ve, no gasta nada.
- Si `captureStream` no existe o falla, el visualizador no aparece: nunca un
  lienzo vacío.
- Ajuste «Visualizador», activado por defecto.

### 2.6 Dónde se ajusta

Una hoja «Reproducción» (`#playbackSettingsSheet`), accesible desde un botón
nuevo en el pie de la pantalla completa y desde la barra lateral:

- Transición: **Sin cortes** · Fundido de 2 · 4 · 6 · 8 · 12 s
- Igualar volumen: sí/no
- Visualizador: sí/no

Se guarda en `ytdl_playback` y se aplica al momento.

---

## 3. Alcance

**Dentro:** D1-D4.

**Fuera:**
- Ecualizador: exigiría enrutar la salida por Web Audio, justo lo que §2.1 evita.
- Subir el volumen de las canciones flojas por encima del original (mismo motivo).
- Reproducción sin cortes exacta a nivel de muestra (§2.3).
- Fundido entre canciones de la radio del plan 16: lo hereda solo si el plan 16
  reproduce con este mismo motor.

---

## 4. Tareas

### Bloque A — Comprobación previa

#### T1 · Prueba de concepto en un móvil real

**Ficheros:** ninguno del proyecto (página de prueba en el emulador y en tu vivo)

1. Página mínima con dos `<audio>`, un cruce por `timeupdate` y `captureStream`
   con un `AnalyserNode`, empaquetada en una APK de prueba.
2. Pantalla apagada 10 minutos con una cola de 4 canciones: ¿pasan de una a
   otra? ¿se oyen los cruces? ¿la sesión del sistema sigue viva?
3. Anotar el resultado en este plan antes de seguir.

**Si falla en segundo plano:** con la pantalla apagada, el motor pasa a un solo
elemento (comportamiento de hoy) y los fundidos solo actúan en primer plano. Se
decide aquí, no a mitad de plan.

### Bloque B — Motor

#### T2 · Motor de dos elementos

**Ficheros:** `frontend/src/features/player/engine.js` (nuevo), `frontend/index.html`
(`<audio id="deckAudio">` junto a `#mainAudio`), `features/player/player.js`,
`controls.js`, `system-session.js`, `listens.js`

1. `createEngine({ a, b })` → `{ audio, precargar(src), cruzar({ segundos, curva }), saltar(src), actual(), libre() }`.
2. `audio`: envoltorio de §2.2 que reenvía propiedades y métodos y filtra
   eventos del elemento saliente.
3. Intercambio de ids en cada cambio (invariante `#mainAudio`).
4. `player.js` y compañía reciben `engine.audio` en lugar de buscar el elemento.

**Cosas que no hacer** No crear y destruir elementos en cada canción: el
navegador pierde la precarga y la sesión multimedia se reinicia.

#### T3 · Sin cortes y fundido

**Ficheros:** `features/player/crossfade.js` (nuevo, puro), `features/player/player.js` (`next`, `'ended'`, `play`)

1. `planDeTransicion({ duracion, actual, ajuste, repetir })` pura: devuelve
   cuándo precargar, cuándo arrancar la siguiente y el volumen de cada una en
   cada instante (§2.3).
2. En `timeupdate`: aplicar el plan (precarga, arranque, volúmenes).
3. `next()` con motivo: `'fin'` (con transición) o `'usuario'` (en seco).
4. El contador de escuchas (plan 11) y la sesión del sistema cambian de canción
   **cuando la siguiente pasa a ser la actual**, a mitad del cruce, no al final.

### Bloque C — Volumen

#### T4 · Medir en el servidor

**Ficheros:** `backend/server.py` (`finalize_download_status` y una función
`medir_sonoridad(ruta)`), `test/backend/test_download_helpers.py`

1. `medir_sonoridad`: `ffmpeg` con `loudnorm=print_format=json`, lectura del
   bloque JSON final de stderr, `timeout=30`, `nice`, bajo `MAX_TRANSCODES`.
   Devuelve `{ lufs, pico }` o `None`.
2. Se llama al terminar cada fichero (suelta y lote) y el resultado va en el
   progreso: `loudness: { lufs, pico }`.
3. Fallar al medir **nunca** hace fallar la descarga: se registra y sigue.

**Seguridad** La ruta del fichero sale de `safe_download_path`, como el resto;
`ffmpeg` se llama con lista de argumentos, sin shell.

#### T5 · Medir en el cliente lo que ya hay

**Ficheros:** `frontend/src/core/loudness.js` (nuevo, puro), `features/player/loudness-backfill.js` (nuevo)

1. `sonoridad(muestras, frecuencia)`: filtro K (dos biquads de la norma),
   bloques de 400 ms con solape del 75 %, compuertas absoluta y relativa.
   Función pura sobre un `Float32Array`: se prueba con tonos sintéticos.
   **Ojo con la mezcla a mono:** la norma suma la energía de los dos canales, y
   al decodificar en mono se promedian. Una canción estéreo medida en mono da
   3,01 dB menos; se compensa con `+3,01` cuando el original tiene dos canales
   (lo dice `AudioBuffer.numberOfChannels` al decodificar la cabecera).
2. Tarea en segundo plano: toma una canción sin `loudness`, la decodifica con
   `OfflineAudioContext(1, …, 22050)`, mide y guarda. Una a la vez, con
   `requestIdleCallback`, nunca mientras se descarga algo, y se para si la
   batería está por debajo del 20 % sin cargar (`navigator.getBattery`, si existe).

#### T6 · Aplicar la ganancia

**Ficheros:** `features/player/engine.js`, `features/player/player.js`

El volumen real de cada elemento = volumen del usuario × ganancia de su canción
× factor del cruce. Una función, `volumenEfectivo(...)`, en un solo sitio.

### Bloque D — Visualizador y ajustes

#### T7 · Visualizador

**Ficheros:** `frontend/src/features/player/visualizer.js` (nuevo), `full-player.js`
(lienzo y ciclo de vida), `styles.css`

1. `crearVisualizador({ lienzo, paleta })` con `conectar(elemento)`,
   `desconectar()`, `iniciar()`, `parar()`.
2. `conectar` usa `elemento.captureStream()` y un único `AudioContext`
   perezoso (se crea al primer uso tras un gesto del usuario, que es cuando el
   navegador lo permite).
3. Se reconecta al elemento actual en cada cambio del motor.
4. `iniciar` al abrir la pantalla completa; `parar` al cerrarla, al ocultarse
   la página (`visibilitychange`) o con «Reducir movimiento».

#### T8 · Hoja de ajustes de reproducción

**Ficheros:** `frontend/index.html` (`#playbackSettingsSheet`), `features/player/settings.js`
(nuevo), `styles.css`, traducciones

§2.6, con la hoja de `ui/sheets.js` y los textos en los seis idiomas.

### Bloque E — Tests

#### T9 · Tests del plan

| Qué | Dónde |
|---|---|
| `planDeTransicion`: precarga a 20 s, arranque a 0,25 s, curvas de igual potencia (suma de potencias = 1), sin fundido al saltar ni con repetir una | `test/frontend/test_transiciones.mjs` (nuevo) |
| `sonoridad` con los tonos de referencia de EBU Tech 3341 (1 kHz a −23 dBFS en estéreo da −23 ± 0,1 LUFS, también medido en mono con la compensación), y la compuerta con silencio | `test/frontend/test_sonoridad.mjs` (nuevo) |
| `volumenEfectivo`: nunca pasa de 1, respeta el pico, sin medida = 1 | ídem |
| El envoltorio del motor: reenvía propiedades, filtra eventos del saliente, `#mainAudio` siempre es el actual | `test/frontend/test_motor.mjs` (nuevo, con un `<audio>` simulado) |
| `medir_sonoridad`: lee el JSON de ffmpeg, `None` si falla, no rompe la descarga | `test/backend/test_download_helpers.py` |
| E2E 29 · con fundido de 2 s, las dos canciones suenan a la vez y sus volúmenes se cruzan | `recorridos.spec.js` + `fake_ytdlp` genera un tono de 6 s para un id |
| E2E 30 · sin cortes: la siguiente empieza menos de 300 ms después de acabar la anterior | ídem |
| E2E 31 · igualar volumen: el tono fuerte suena con un volumen menor que el flojo | `fake_ytdlp` con dos tonos a distinta amplitud |
| E2E 32 · el visualizador pinta con música y se para al cerrar la pantalla completa | ídem |

**Prueba manual obligatoria (APK):** cola de 5 canciones con fundido de 6 s y la
pantalla bloqueada 15 minutos; controles de la pantalla de bloqueo durante un
cruce.

---

## 5. Orden de ejecución, commits y despliegue

```
T1                      prueba de concepto → decisión anotada aquí
T2 → T3                 motor, sin cortes y fundido      → desplegar + APK de prueba
T4 → T5 → T6            volumen                          → desplegar
T7 → T8                 visualizador y ajustes           → desplegar + APK
T9 con cada tarea
```

Ninguna APK se publica sin la prueba manual con la pantalla bloqueada.

---

## 6. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La música se para en segundo plano con dos elementos | Media | T1 antes de nada; plan B de un solo elemento con la pantalla apagada |
| La sesión del sistema se confunde con dos elementos | Media | Solo el actual actualiza la sesión; prueba manual de la pantalla de bloqueo durante un cruce |
| Medir en el servidor frena las descargas | Baja | Después de completar, con `nice` y bajo `MAX_TRANSCODES` |
| La medición en el cliente agota memoria en un móvil modesto | Media | Mono a 22.050 Hz (unos 21 MB por 4 minutos), una a la vez, solo en reposo |
| El contador de escuchas cuenta dos veces durante un cruce | Media | Cambio de canción actual en un único punto (T3 punto 4) y test |
| `captureStream` no existe en alguna WebView antigua | Baja | Sin visualizador en ese caso, nunca un error |
| La igualación deja flojas algunas canciones | Segura en parte | Documentado en §2.4: solo atenúa; objetivo de −16 LUFS |

---

## 7. Definición de hecho

- [ ] La prueba de T1 está hecha y anotada.
- [ ] Sin cortes por defecto; fundido configurable de 2 a 12 s; en seco al cambiar a mano.
- [ ] Volumen igualado con medida del servidor en lo nuevo y del cliente en lo antiguo.
- [ ] Visualizador con los colores de la carátula, solo cuando se ve.
- [ ] La APK sigue sonando con la pantalla bloqueada, con cruces incluidos.
- [ ] Todas las suites en verde, incluidos los recorridos 29-32.
