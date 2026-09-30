# 20 — Descargas en lote: rápidas, a la biblioteca y con un solo aviso

**Estado:** hecho · desplegado · **Prioridad:** 🟠 Alto · **Depende de:** 14 (descargas que sobreviven, avisos)
**Origen:** revisión de cómo se descargan varias canciones a la vez (listas, Mix,
favoritos, «Descargar las que faltan», listas seguidas) y del aviso que las
acompaña, que está pensado para una sola canción. Se suma importar canciones
también en la web y en el ordenador, no solo en la APK.

### Decisiones tomadas (2026-09-28)

| Pregunta | Decisión |
|---|---|
| ¿Cuántas canciones a la vez por lote? | **3**: rápido y sin acaparar el servidor si hay varios usuarios |
| En el ordenador, ¿biblioteca o ZIP? | **Biblioteca por defecto**; el ZIP queda como opción aparte |
| ¿Importar solo en la APK? | **No**: también en la web y en el ordenador |

---

## 1. Problema

Hay cuatro caminos distintos para descargar varias canciones, y cada uno se
porta a su manera:

| Desde dónde | Cómo | ¿Paralelo? | ¿A la biblioteca? |
|---|---|---|---|
| Lista o Mix en el móvil | Una petición por canción, 5 a la vez | Sí | Sí |
| Lista o Mix en el ordenador (y en el móvil si son solo 2) | El servidor hace un lote y devuelve un ZIP | Sí, en el servidor | **No**: solo se baja el ZIP |
| Favoritos en el ordenador | ZIP | Sí, en el servidor | Se añaden **apuntando a YouTube, sin audio** |
| «Descargar las que faltan» y listas seguidas | Una a una, 7 s de pausa entre cada una | **No** | Sí |

| id | Defecto | Dónde | Efecto |
|----|---------|-------|--------|
| D1 | 🔴 El lote del móvil choca con el límite de `/api/start-download` (10 por minuto, 100 por hora por IP) | `youtube-playlist.js`, `favorites/panel.js` | Una descarga real tarda 6,3 s de media en el servidor (medido en producción, 4-10,6 s): con 5 a la vez se piden 30-50 por minuto. A partir de la décima, rechazos que cuentan como fallidas |
| D2 | 🟠 La nube y las listas seguidas van de una en una | `sync/nube.js` (`PAUSA_LOTE`) | Precisamente para no chocar con ese límite: 35 canciones, unos 7 min y medio |
| D3 | 🟠 En el ordenador, una lista no entra en la biblioteca | `youtube-playlist.js`, rama del ZIP | Solo se baja un ZIP; en favoritos, además, entradas sin audio |
| D4 | 🟠 Las canciones de un lote no traen lo que trae una suelta | `run_parallel_batch` | Sin `videoId`, sin artista y canción de YouTube, sin la medida de volumen del plan 12; todas en la misma carpeta |
| D5 | 🟡 Cancelar un lote no para lo que está en cola | `run_parallel_batch` envía todo al `executor` de golpe | Se siguen descargando canciones que nadie va a recoger |
| D6 | 🟡 Un lote grande ocupa todo el servidor | `executor` de 5 compartido | Las descargas sueltas de otros usuarios esperan detrás |
| D7 | 🟡 El móvil se detecta por el navegador | `isMobile` por `userAgent` | Un iPad en modo escritorio va al ZIP; con 2 canciones, el móvil también (en la APK el ZIP no funciona bien) |
| D8 | 🟠 El aviso no entiende de lotes | `download/queue.js`, `ui/downloads-hud.js` | Cada canción es un aviso que se va a los 1,3 s: en un lote de 35 la isla dice «5 descargas · 40 %» todo el rato. No se sabe cuántas llevas, cuánto falta ni cuáles fallaron, y al final no hay resumen |
| D9 | 🟠 Importar solo funciona en la APK | `library/importer.js` | En la web, un `alert`: «Esta función "Bóveda Oculta" es exclusiva de la App Nativa». Las canciones de un ZIP, o las que ya se tenían, no se pueden meter en la biblioteca del ordenador |

---

## 2. Decisiones de diseño

### 2.1 Un lote es un organizador de descargas sueltas

En vez de un camino aparte, **el lote crea una descarga suelta normal por
canción** (la misma de `/api/start-download`, con su `download_id`) y las lanza
**de 3 en 3**. Así cada canción del lote tiene todo lo que tiene una suelta
(D4): su `videoId`, artista, canción, medida de volumen, su progreso y su
fichero, y el cliente la recoge con el mismo código que ya funciona
(`guardarDescarga`, `progresoDe`, las descargas pendientes del plan 14).

```
POST /api/lotes  { canciones: [...], formato, nombre }      ← una sola petición
  → { loteId, canciones: [{ i, videoId, downloadId }] }
GET  /api/lotes/<loteId>                                   ← estado del lote
  → { total, hechas, fallidas, enCurso, canciones: [{ i, downloadId, estado }] }
DELETE /api/lotes/<loteId>                                  ← cancelar: lo que está en cola no empieza
```

- **Límites:** una petición por lote (como hoy `start-batch-download`: 3 por
  minuto, 20 por hora), 100 canciones por lote, y un tope nuevo de **300
  canciones por hora** por IP o cuenta, sumando lotes, que sustituye al límite
  por canción sin frenar a nadie normal.
- **Concurrencia:** 3 por lote (un semáforo por lote) dentro del `executor`
  general de 5; así dos lotes a la vez aún dejan sitio a una descarga suelta
  (D6).
- **Cancelar** marca el lote: las canciones en cola no empiezan y las que están
  en marcha se cancelan como una suelta (D5).
- El ZIP sigue existiendo como **opción**: `GET /api/lotes/<id>/zip` junta lo
  terminado.

### 2.2 El cliente: un solo gestor de lotes

`features/download/lotes.js` sustituye a los cuatro caminos (D1-D3, D7):

1. Pide el lote y apunta **una entrada pendiente** del tipo `lote` (plan 14), con
   lo ya recogido.
2. Sigue el estado del lote; **cada canción que termina se recoge en el acto**
   (se guarda y entra en la biblioteca; si estaba en la nube, sale de la nube,
   también en las listas) sin esperar al final.
3. Al cerrar y volver a abrir la app, recoge lo que terminó mientras tanto.
4. Sin `userAgent`: igual en el móvil, la APK y el ordenador. La biblioteca por
   defecto; «Descargar como ZIP» es un botón aparte en el selector de listas.

Lo usan el selector de listas y Mix, favoritos, «Descargar las que faltan» y las
listas seguidas. Si ya hay un lote en marcha, uno nuevo espera su turno (o se
suma, en la nube y las listas seguidas, como hoy `descargarVarias`).

### 2.3 El aviso: un lote es un solo aviso

| Momento | Isla (móvil) y banner (escritorio) |
|---|---|
| En marcha | **«Lista E2E · 12 de 35»**, el anillo con el avance del lote y las carátulas de lo que se está bajando |
| Desplegado | Las canciones en curso (hasta 3) con su porcentaje, y **«Cancelar lote»** |
| Termina bien | **«35 descargadas»**, unos segundos |
| Termina con fallos | **«33 de 35 · 2 no se pudieron»**; se queda hasta que se toca. Desplegado: cuáles fallaron y **«Reintentar»** (un lote nuevo solo con esas) |

- Una descarga suelta sigue siendo un aviso suelto, como ahora.
- Aviso del sistema en la APK: el de §2.4 del plan 14, al terminar, con la app
  fuera de la vista. Una notificación de progreso en Android no se actualizaría
  sin música (la app se congela a los ~96 s), así que no se hace.
- El texto de progreso de Inicio usa el mismo recuento («12 de 35»).

### 2.4 Importar canciones también en la web

- En la web, cada fichero se guarda como las descargas: `StorageModule.putBlob`
  y `idb://` (D9). En la APK, como hoy.
- **Se reconoce qué vídeo es.** Lo que descarga esta app lleva en sus metadatos
  el enlace de YouTube (comprobado en producción: `comment=https://www.youtube.com/watch?v=…`).
  Si lo trae, la canción importada toma ese `videoId`: si estaba en la nube, la
  sustituye (en la biblioteca y en las listas), no se duplica, y viaja a la
  cuenta como cualquier otra. Sin enlace, se importa como hoy (`lib_…`, solo en
  este dispositivo).
- Antes de importar, `navigator.storage.estimate()`: si no cabe, se avisa con
  cuánto sitio hace falta en vez de fallar a medias.
- En el ordenador, además del botón, **arrastrar ficheros** sobre la
  Biblioteca.
- El escaneo de carpetas del móvil (`syncLibraryBtn`) sigue siendo solo de la APK.

---

## 3. Seguridad y límites

| Medida | Por qué |
|---|---|
| Cada canción del lote se valida como hoy (`objetivo_de_lote`): URL de vídeo de YouTube o búsqueda, nada más | Nada arbitrario hacia yt-dlp |
| 100 por lote, 3 lotes por minuto, 20 por hora y 300 canciones por hora | Sin el límite por canción, que un lote no permita más que antes |
| 3 a la vez por lote, `executor` de 5 compartido | Un usuario no deja sin servicio a los demás |
| `loteId` y `downloadId` de 32 hexadecimales, como hoy | Nada adivinable ni inyectable en rutas |
| Importar: solo audio (`audio/*` y extensiones conocidas), 100 MB por fichero, metadatos como texto plano | Los títulos de un fichero van a la interfaz con `html\`…\`` (plan 10) |

---

## 4. Alcance

**Dentro:** D1-D9.

**Fuera:** descargar con la app cerrada (sigue sin poder hacerse); notificación
de progreso en Android; importar carpetas enteras en el ordenador (se pueden
elegir muchos ficheros a la vez, o arrastrarlos).

---

## 5. Tareas

### T1 · Servidor: lotes que organizan descargas sueltas

**Ficheros:** `backend/server.py` (y un `backend/lotes.py` si conviene sacarlo)

1. `POST /api/lotes`, `GET /api/lotes/<id>`, `DELETE /api/lotes/<id>`,
   `GET /api/lotes/<id>/zip` (§2.1).
2. El coordinador lanza de 3 en 3 descargas sueltas (`run_download_task`), con
   su registro de progreso, y respeta la cancelación.
3. El límite de 300 canciones por hora.
4. `start-batch-download` se mantiene mientras haya APK antiguas que la usen
   (1.5.1 y anteriores) y se retira más adelante.

### T2 · Cliente: el gestor de lotes

**Ficheros:** `features/download/lotes.js` (nuevo), `download/download.js`,
`download/pendientes.js`, `youtube-playlist.js`, `favorites/panel.js`,
`sync/nube.js`, `follows.js`

1. §2.2, con la recogida de cada canción al terminar y la entrada pendiente del lote.
2. Los cuatro caminos pasan a usarlo; fuera `isMobile` y las ramas del ZIP.
3. «Descargar como ZIP» en el selector de listas.

### T3 · El aviso del lote

**Ficheros:** `download/queue.js`, `ui/downloads-hud.js`, traducciones, `styles.css`

1. Un elemento de tipo lote en el gestor de avisos: título, «N de M», avance
   del lote, canciones en curso, fallidas.
2. Isla y banner según §2.3, con «Cancelar lote» y «Reintentar».
3. El aviso del sistema al terminar (ya existe) usa el mismo recuento.

**Cosas que no hacer** No cambiar el aspecto de la isla ni de los banners: mismos
materiales, tamaños y muelles. Solo cambia lo que dicen.

### T4 · Importar en la web y en el ordenador

**Ficheros:** `library/importer.js`, `library/library.js`, `index.html`, traducciones

1. §2.4: guardado en `idb://`, `videoId` desde los metadatos, sitio disponible,
   arrastrar ficheros.
2. Lo importado con `videoId` pasa por el mismo camino que una descarga
   (`addSong`): sustituye a su versión en la nube, también en las listas.

### T5 · Tests

| Qué | Dónde |
|---|---|
| Lotes: 3 a la vez como máximo, cancelar no empieza lo que está en cola, 100 por lote, 300 por hora, aislamiento entre usuarios | `test/backend/test_lotes.py` (nuevo) |
| Estado del lote → texto del aviso (en marcha, bien, con fallos) | `test/frontend/test_avisos_lote.mjs` (nuevo) |
| `videoId` desde los metadatos de un fichero; sin enlace, `lib_…` | `test/frontend/test_importar.mjs` (nuevo) |
| E2E · una lista en el ordenador entra en la biblioteca canción a canción, y la isla dice «N de M» | `recorridos.spec.js` |
| E2E · un lote con una canción que falla: «2 de 3 · 1 no se pudo» y «Reintentar» | ídem (el yt-dlp simulado, con un id que falla) |
| E2E · recargar a mitad de un lote recoge lo terminado | ídem |
| E2E · importar un fichero en la web: entra en la biblioteca y, si su enlace es de una canción en la nube, la sustituye | ídem (un fichero de prueba con la etiqueta `comment`) |
| Medida: 35 canciones antes y después (tiempo total, rechazos del servidor) | anotado aquí |

---

## 6. Orden de ejecución y despliegue

```
T1 → T2 → T3        el lote nuevo y su aviso         → desplegar (servidor + web) + APK
T4                  importar en la web                → web
T5 con cada tarea
```

Las APK 1.5.1 y anteriores siguen funcionando con los caminos de hoy mientras
se actualizan: por eso T1 no retira `start-batch-download`.

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| YouTube limita al servidor con más descargas a la vez | Baja | 3 por lote, 5 en total, como hoy; se mide con 35 canciones |
| Cerrar la app a mitad de un lote largo | Media | La entrada pendiente del lote recoge lo terminado al volver (plan 14) |
| En la web, el almacenamiento del navegador se llena al importar | Media | `storage.estimate()` antes, y el aviso de «sin espacio» que ya existe |
| APK antiguas con el camino viejo | Segura, un tiempo | `start-batch-download` se mantiene |
| Un fichero importado con metadatos engañosos (enlace de otro vídeo) | Baja | Solo afecta a la biblioteca de quien lo importa; los títulos se escapan |

---

## 8. Definición de hecho

- [ ] Un lote de 35 canciones termina sin rechazos del servidor y bastante más rápido que hoy (medido). *Estimado; se mide en producción tras desplegar.*
- [x] En el móvil, la APK y el ordenador, las canciones de un lote entran en la biblioteca una a una.
- [x] El aviso de un lote dice cuántas van de cuántas, y al final cuántas fallaron, con «Reintentar».
- [x] Cancelar un lote no deja nada descargándose en el servidor.
- [x] Importar funciona en la web, y lo descargado con la app se reconoce y no se duplica.
- [x] Todas las suites en verde, con los recorridos nuevos.

---

## 9. Registro de ejecución (2026-09-28)

**T1 a T5 hechas. Sin desplegar.** En paralelo con el plan 17, en otra sesión
(ficheros repartidos; los compartidos, cada uno en su bloque; la E2E por turnos).

| Tarea | Qué quedó |
|---|---|
| T1 | `backend/lotes.py` (sin Flask): `Lotes` con `crear`, `resumen`, `cancelar`, `reservar` (cupo de 300 canciones por hora y cuenta o IP) y `barrer` (25 h). En `server.py`: `POST/GET/DELETE /api/lotes`, `GET /api/lotes/<id>/zip`, `cancelar_descarga_suelta` (sacada de `/api/cancel`), el estado `queued` en `ACTIVE_STATUSES` y el barrido de lotes. Cada canción: `prefetch_video_metadata` + `run_download_task`, como una suelta |
| T2 | `features/download/lotes.js` (`descargarLote`, `cancelarLote`, `recogerLotesPendientes`) y `estado-lote.js` (puro). Pendiente de tipo `lote` con `recogidas` (`marcarRecogida`). Selector de listas y Mix, favoritos, «Descargar las que faltan» y listas seguidas por el mismo camino; «Descargar como ZIP» en el selector (solo navegador). Fuera `isMobile`, las ramas del ZIP y `PAUSA_LOTE` |
| T3 | `queue.js`: `addLote`, `actualizarLote`, `terminarLote`. `downloads-hud.js`: `textoDeLote`, `filasDeIsla`; isla con las canciones en curso o las fallidas, «Reintentar» y «Cerrar»; banner con «Reintentar» |
| T4 | `importer.js` reescrito (`importarFicheros`, arrastrar y soltar) e `importar-audio.js` (puro): web con `putBlob` e `imp_…`, `videoId` del comentario, sitio disponible, lo ya descargado se salta |
| T5 | `test_lotes.py` (21), `test_lotes.mjs` (7), `test_avisos_lote.mjs` (7), `test_importar.mjs` (7), `test_actualizacion_apk.mjs` al día; recorridos 42-48; yt-dlp simulado con canciones lentas y una que falla; ficheros de prueba en `test/e2e/ficheros/`. Servidor 735 ✓, cliente ✓, E2E 49/49 ✓ |

### Decisiones tomadas por el camino

- **Cada canción del lote pide sus metadatos a YouTube** antes de bajarse (como
  `/api/start-download`): cuesta 1-2 s en paralelo, pero trae artista y canción
  de YouTube, que el lote antiguo no tenía (D4).
- **Las canciones que llegan casi a la vez van en un solo lote** (1,5 s): al
  comprobar varias listas seguidas no se agotan los 3 lotes por minuto.
- **Un lote se recoge de una en una en el cliente** (guardar el audio es
  rápido; el cuello de botella es el servidor), pero **el alta en la
  biblioteca es siempre en serie**: `addSong` lee y guarda la biblioteca entera.
- **En el ZIP, dos canciones con el mismo título no se pisan** («Misma (2).m4a»).
- `start-batch-download` se mantiene para las APK 1.5.1 y anteriores.

### Encontrado por el camino

- **Los banners terminados escondían siempre la X**: pensado para avisos que se
  van solos, habría dejado sin forma de cerrar un lote con fallos. Arreglado.
- **En el banner, «Reintentar» cortaba el texto** («1 no se pu…»): con el
  botón a la vista se quita el icono y el texto puede ir en dos líneas.
- **El importador en paralelo habría perdido canciones en la web**: 4 altas a
  la vez sobre la biblioteca se pisan. Se guardan en paralelo y se dan de alta
  en serie.
- **Un fichero importado podía borrar el audio de otra canción**: con la clave
  del `videoId` (la de las descargas), importar un duplicado y liberarlo habría
  borrado el audio de la ya descargada. Las importadas usan `imp_…`.

### Medida (estimada; se confirmará en producción)

Con los 6,3 s de media por canción medidos en producción:

| 35 canciones | Antes | Ahora |
|---|---|---|
| Lista en la APK (5 a la vez, una petición por canción) | Las 10 primeras; el resto, rechazadas (10 por minuto) | ~1,5-2 min, sin rechazos (3 a la vez, una petición) |
| «Descargar las que faltan» (una a una + 7 s de pausa) | ~8 min | ~1,5-2 min |
| Lista en el ordenador | Un ZIP, nada en la biblioteca | ~1,5-2 min, a la biblioteca |

### Pendiente

- Desplegar (servidor y web) y APK nueva; medir 35 canciones en producción.
- Probar la importación en la APK con un fichero bajado por la app.
