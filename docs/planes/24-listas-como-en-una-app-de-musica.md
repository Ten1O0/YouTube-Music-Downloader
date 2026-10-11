# 24 — Las listas, como en una app de música

**Estado:** hecho · sin desplegar · **Prioridad:** 🟠 Medio · **Depende de:** 23 (el componente de ventana y el selector de canciones)

> Mejoras para las listas y para el uso diario, inspiradas en Spotify y Apple
> Music sin copiarlas: lo que ellas hacen bien, aquí también, y algo más con lo
> que esta app ya tiene (la radio y los lotes). Las eligió el usuario el
> 2026-10-09 entre las propuestas del plan 23. Se conserva su numeración (P1…).

---

## 1. Qué entra

| # | Mejora | Dónde |
|---|--------|-------|
| P1 | Cabecera de la lista con portada grande y los colores de la portada | Vista de una lista |
| P2 | Reproducir, aleatorio y repetir, a la vista. Lo demás, en un menú ⋮ | Vista de una lista |
| P3 | «Descargar las que faltan» | Vista de una lista |
| P4 | Cabecera que se queda arriba al hacer scroll | Vista de una lista |
| P5 | Buscar dentro de la lista y ordenarla por un criterio | Vista de una lista |
| P7 | Canciones recomendadas al final de la lista | Vista de una lista |
| P8 | Selección múltiple | Lista y biblioteca |
| P9 | Deshacer lo que se borra, durante unos segundos | Toda la app |
| P10 | Gestos de deslizar en las filas de las listas | Lista (y biblioteca) |
| P11 | Portada personalizada, con una de sus carátulas | Lista |
| P12 | Estados vacíos que proponen algo | Lista y biblioteca |

**No entra** la P6 (la duración de cada canción en su fila): el usuario no la
eligió. La duración **total** de la lista sí está, en el plan 23.

---

## 2. Cómo se hace cada una

### P1 · Cabecera con portada

- La portada de la lista en grande: el mosaico de cuatro carátulas, su primera
  carátula o la elegida a mano (P11). En el ordenador, a la izquierda del título; en
  el móvil, centrada y encima.
- Debajo, el nombre, la descripción y una línea con «12 canciones · 47 min ·
  3 en la nube» (lo del plan 23) y «actualizada hace 2 días».
- Detrás, un degradado con los colores de la portada, como el del reproductor
  (`ui/palette.js`). Se funde con el fondo al bajar.

### P2 · Los botones

- **A la vista:** un botón grande y redondo de **Reproducir**, el **aleatorio** y
  el de **repetir**, con sus tres estados (desactivado, toda la lista y una
  canción), como en el reproductor.
- **En el menú ⋮**, el mismo componente que «Opciones de la canción»: **Añadir
  canciones, Editar, Ordenar, Compartir y Eliminar**. Eliminar va al final, en rojo.
- **Compartir** (nuevo): la lista como texto, «Artista – Canción» por línea, por
  el menú de compartir del sistema o copiado al portapapeles. Ese formato lo lee
  «Importar lista» (plan 15), así que otra persona puede importarla tal cual.

### P3 · «Descargar las que faltan»

- Si la lista tiene canciones en la nube, aparece «Descargar las 3 que faltan»
  junto a la línea de la duración.
- Las baja con un lote (plan 20): una sola petición, con la isla de progreso y
  el aviso de siempre. Cuentan para el tope de descargas por hora.
- Sin conexión o con el tope alcanzado, el aviso que ya existe.

### P4 · Cabecera pegajosa

Al bajar más allá de la portada, arriba queda una barra fina con el nombre de
la lista y el botón de reproducir. Aparece y desaparece con un fundido, sin
mover el resto, y con «Reducir movimiento» aparece sin animación.

### P5 · Buscar y ordenar dentro de la lista

- Un buscador, plegado tras una lupa en la barra de botones, filtra por título y
  artista mientras se escribe.
- «Ordenar por»: **personalizado** (el de siempre, con lo descargado primero),
  **título**, **artista**, **añadida recientemente** o **duración**. Se recuerda
  por lista en el dispositivo, y no cambia el orden guardado.
- Reproducir y aleatorio siguen lo que se ve: con un filtro, solo lo filtrado.

### P7 · Canciones recomendadas

- Al final de la lista, «Recomendadas»: cinco canciones parecidas a las de la
  lista que no estén ya en ella. Salen de la radio (`/api/radio`), usando como
  semillas dos o tres canciones de la lista al azar.
- Cada una con su carátula, una escucha previa y un **+** que la descarga (por la
  vía de la radio, sin volver a bajar si ya está en caché) y la añade a la lista.
- «Otras» pide cinco más. Si YouTube limita o no hay red, la sección no aparece:
  nada de errores en medio de una lista.

### P8 · Selección múltiple

- **Móvil:** una pulsación larga sobre una fila entra en modo selección.
  **Ordenador:** clic con Cmd/Ctrl para marcar varias, o con Mayús para un tramo.
  También desde el menú ⋮: «Seleccionar».
- Se marcan con el mismo círculo dorado del selector del plan 23.
- Una barra abajo dice «4 seleccionadas» y ofrece: **Añadir a playlist**, **Añadir
  a la cola**, **Descargar** (si hay de la nube) y **Quitar** (de la lista) o
  **Borrar** (de la biblioteca), que se pueden deshacer (P9).

### P9 · Deshacer

Cómo lo pidió el usuario: un aviso con «Deshacer» tras borrar algo, para echarse
atrás si fue sin querer. Lo concretó al probar el plan 23 (10 de octubre de 2026):

- **Con el aspecto del aviso de las descargas**: dice qué se ha borrado («Lista
  "Verano" eliminada») y lleva «Deshacer».
- **Cuánto dura**: **5 segundos** si es una lista entera y **3 segundos** si son
  canciones (de una lista, de la biblioteca o de favoritos). Lo eligió el usuario
  al empezar el plan (10 de octubre de 2026).
- **Se cierra solo** al acabar el tiempo, y también **a mano**, con una X.

- **Cubre:**
  - quitar una canción de una lista;
  - borrar una canción de la biblioteca;
  - **borrar una lista entera**;
  - quitar un favorito;
  - lo mismo en grupo (P8).
- **Borrar una lista ya no pide confirmación**: se borra, sale el aviso y se puede
  deshacer. Es lo mismo que hace Spotify, y un paso menos.
- **Por dentro:** lo que se ve cambia al momento, pero lo que no tiene vuelta
  atrás espera a que acabe el aviso:
  - borrar el audio del dispositivo (hoy se borra al instante, `library.js:295`);
  - enviar el cambio a la cuenta.

  Si se pulsa «Deshacer», no se hace nada de eso. Si la app se cierra durante
  esos segundos, se aplica lo pendiente al cerrarla (`pagehide`), para no dejar
  nada a medias.
- Un solo aviso a la vez: si llega otro borrado, el anterior se da por hecho. El
  aviso se puede quitar con su X o deslizándolo (cerrarlo da el borrado por
  hecho), y con lector de pantalla se anuncia y
  «Deshacer» recibe el foco.
- **Lo que ya hay** (plan 23, al arreglar el borrado de listas): borrar una lista
  sale de su detalle con `NavigationModule.salirDelDetalle()`, que va atrás por
  el historial hasta dejar atrás las capas y el detalle, y lo dice con un aviso
  flotante (`ui/toast.js`, «Playlist «X» eliminada»). El aviso de deshacer parte
  de ahí: le añade «Deshacer», la X y la duración de cada caso.

### P10 · Gestos de deslizar

Lo que hay hoy: en la **biblioteca**, deslizar una fila **a la derecha** la pone
«Siguiente» en la cola (plan 09). En las listas no hay gestos.

- **En las filas de una lista:** a la derecha, «Siguiente» en la cola, igual que
  en la biblioteca. **A la izquierda, quitar de la lista**, con deshacer (P9).
- **En la biblioteca:** a la izquierda **no hace nada**. Lo decidió el usuario al
  empezar el plan: la propuesta era «Añadir a playlist», y borrar con un gesto
  sería demasiado fácil de hacer sin querer, incluso con deshacer.
- Mismo umbral, mismo muelle y el mismo aviso háptico que el gesto actual, y
  también con ratón.

### P11 · Portada personalizada

En «Editar» (ahora en el menú ⋮), «Portada»: automática (el mosaico, como hoy) o
**una de las carátulas de sus canciones**, elegida de una cuadrícula. Se guarda
como una referencia a la canción, así que viaja con la cuenta sin subir imágenes.
Si esa canción sale de la lista, vuelve a la automática.

### P12 · Estados vacíos

- **Lista vacía** (se pueden crear vacías desde el plan 23): un dibujo sencillo,
  «Esta lista está vacía», y dos botones: **Añadir canciones** (el selector) y
  **Ver recomendadas** (P7, a partir de la canción que suene o de las más escuchadas).
- **Biblioteca vacía:** «Busca una canción o pega un enlace» con el buscador a mano,
  e «Importar lista».
- **Búsqueda sin resultados** dentro de una lista (P5): «Nada con "xyz" en esta
  lista» y un botón para borrar la búsqueda.

---

## 3. Tareas

1. **T1 · Deshacer (P9):** primero, porque lo usan P8 y P10. El aviso, la cola de
   lo pendiente y el `pagehide`, y borrar una lista sin confirmación.
2. **T2 · Cabecera, botones y menú ⋮ (P1, P2, P4, P11).**
3. **T3 · Buscar y ordenar (P5) y estados vacíos (P12).**
4. **T4 · Descargar las que faltan (P3) y recomendadas (P7).**
5. **T5 · Selección múltiple (P8) y gestos (P10).**
6. **T6 · Entradas fantasma en el historial:** repasar las hojas que se cierran
   sin gastar su entrada (sin `closeOverlay` ni `olvidarOverlay`). Una entrada
   de más hace que el «atrás» del móvil o del navegador no haga nada una vez, o
   vuelva a una capa ya cerrada. En el plan 23 se miraron, desde el detalle de una
   lista: Editar, Añadir canciones, Reordenar, el reproductor completo y sus
   Opciones → Añadir a playlist. Esos salen limpios. Falta el resto de la app.
7. **T7 · Tests:**
   - Unitarios: la cola de deshacer, el orden por criterio, el texto de Compartir y las semillas de las recomendadas.
   - Recorridos E2E: deshacer cada tipo de borrado, y que el audio **no** se borre si se deshace; borrar una lista y recuperarla; descargar las que faltan; añadir una recomendada; seleccionar varias y quitarlas; los dos gestos.
   - Capturas de estética de la vista nueva en móvil, tableta y ordenador.

## 4. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Borrar sin confirmar una lista entera | El aviso de deshacer, y nada irreversible hasta que acabe |
| La app se cierra con un borrado pendiente | Se aplica en `pagehide`. Un recorrido E2E lo comprueba |
| Recomendadas: más peticiones a YouTube | Una petición por lista abierta, con la caché de mezclas de la radio (30 min), y solo si la sección llega a verse |
| Gestos que chocan con el scroll o con el de volver atrás del sistema | El mismo reconocedor que ya se usa: solo horizontal, con umbral |
| Peso del arranque | La vista nueva y la selección múltiple se cargan al abrir una lista |

## 5. Orden con los demás planes

**22 (letras), 23 (ventanas) y 24 (este)** se hacen seguidos y salen juntos en la
próxima versión de la APK: una sola actualización con todo.

---

## 6. Registro

### Sesión A: T1 (P9), T5 (P8 y P10) y T6 (2026-10-10)

**T1 · Deshacer (P9).**
- `ui/deshacer.js` y `ui/deshacer.css`: un aviso con el aspecto de los de
  descarga, con la carátula, qué se ha borrado, «Deshacer», una X y una barra
  fina que cuenta el tiempo. Se carga con `import()` al borrar algo.
  - `conDeshacer({ titulo, texto, miniatura, duracionMs, deshacer, confirmar })`.
    Lo visible ya está hecho; `confirmar` lleva lo irreversible.
  - Un aviso a la vez: el siguiente da el anterior por hecho. También lo dan por
    hecho la X, deslizarlo de lado, `pagehide` y pasar a segundo plano (en la APK,
    Android puede cerrar la app sin `pagehide`).
  - «Deshacer» recibe el foco y el aviso se anuncia (`role="status"`).
- `features/seleccion/acciones.js`, el borrado con deshacer que usan todos:
  - `quitarDeListaConDeshacer(playlistId, srcs)`, 3 s;
  - `borrarDeBibliotecaConDeshacer(srcs, { filas })`, 3 s. Borra también de las
    listas, en cascada. El audio del dispositivo se borra al acabar el aviso, no
    antes;
  - `borrarListaConDeshacer(pl)`, 5 s.
  - Deshacer vuelve a poner cada cosa en su sitio (`sitios.js`: `separar` y
    `reinsertar`, puras y con sus pruebas), aunque la lista haya cambiado
    mientras tanto.
- Borrar una lista ya **no pide confirmación**: se quita `#playlistDeleteConfirmModal`
  y sus textos. Borrar de la biblioteca ya no usa el `confirm()` del navegador.
  Quitar un favorito también lleva su aviso de 3 s.
- La sincronización espera mientras hay un aviso a la vista (evento
  `deshacer-pendiente` en `sync.js`): a la cuenta no llega un borrado que luego se
  deshace.

**T5 · Selección múltiple (P8).**
- `features/seleccion/entrada.js`, en el arranque: pulsación larga (500 ms, sin
  mover el dedo más de 10 px) o Cmd/Ctrl/Mayús + clic. La sesión B añadió
  «Seleccionar» al menú ⋮ de las listas propias.
- `features/seleccion/seleccion.js` y su CSS, con `import()`:
  - la marca dorada del selector del plan 23 en cada fila, y Mayús + clic para un tramo;
  - una barra abajo con cuántas hay, «Seleccionar todo» y las acciones: añadir a
    una playlist, a la cola, descargar las de la nube (con `descargarCanciones` de
    la sesión B) y quitar o borrar con deshacer;
  - la selección se guarda por `src`; un `MutationObserver` vuelve a marcar las
    filas cuando la lista se repinta;
  - se sale con la X, Escape, el «atrás» de Android (`NavigationModule.registrarCapa`)
    o cambiando de vista.
- «Añadir a playlist» (`add-sheet.js`) acepta varias canciones, y sus avisos van con
  `avisar()`: los de `showStatus` se pintaban en Inicio y no se veían.

**T5 · Gestos (P10).** En `library/swipe.js`, en las filas de una lista editable,
deslizar a la izquierda quita la canción, con deshacer; el fondo se pone rojo y dice
«Quitar». En la biblioteca, a la izquierda no hace nada, como decidió el usuario.
Mismo umbral, mismos muelles y el mismo aviso háptico que el gesto de la derecha.

**T6 · Entradas fantasma.**
- En el código: las 18 hojas y ventanas que van al historial se cierran por
  `closeOverlay` u `olvidarOverlay`. La entrada de más que hacía borrar una lista
  varias veces venía de `openPlaylistDetail` desde otra vista, arreglado en el plan 23.
- El recorrido 111 lo comprueba en marcha: abre y cierra Ajustes, Tus datos, Atajos,
  Importar y Nueva playlist con la X, el fondo y Escape.

**Lo que salió por el camino.**
- El presupuesto de arranque se pasó a 291 KB con lo de las dos sesiones.
  `player/loudness-backfill.js` pasa a cargarse con `import()`, como
  `duraciones.js`: unos 2,5 KB menos. El CSS de arranque está en 139 KB de 140, así
  que el fondo rojo del gesto va con estilos en línea.
- `goBack` cierra la selección **después** de las ventanas. Al principio la cerraba
  antes, y la X de «Añadir a playlist» abierta desde la selección cerraba la
  selección en vez de la ventana.
- En los recorridos, recién abierta una vista la View Transition se queda con el
  puntero hasta que acaba. Un gesto justo después no llega a la fila, así que la
  ayuda `deslizarFila` espera a que acabe.

**Tras la prueba del usuario en local (2026-10-10).**
- **El aviso de descarga sale al instante.** Antes aparecía cuando contestaba el
  servidor, y el usuario volvía a pulsar: la canción se bajaba tres veces.
  - Ahora `downloadFromUrl` pone el aviso al pulsar, con un id provisional, y
    `queueManager.renombrar` lo cambia por el de la descarga cuando el servidor
    contesta, sin que el aviso se mueva.
  - Cancelarlo antes corta la petición. Si el servidor la rechaza, el mismo aviso
    dice que falló.
  - Una canción que ya se está bajando no se vuelve a pedir: «Esa canción ya se
    está descargando». El botón ya se desactivaba, pero Intro en el campo
    llamaba a la descarga igual.
- **Aleatorio y repetir se sienten pulsados.** Antes solo cambiaban de color.
  Primero se probó que el icono rebotara al soltarlo, pero al usuario no le
  convenció. Se quedan con la pulsación de los de la barra del reproductor, que
  es la que eligió: se hunden (`--press` 0,9) y vuelven con el muelle ágil. Así
  es la misma en la lista (`.lista-boton`), la cola (`.pq-ctrl-btn`), la barra y
  la pantalla completa.
- **Sin vibración en ninguna acción**, como pidió el usuario. Se borran
  `ui/haptics.js` y su test, y las llamadas de las hojas, los avisos de descarga,
  favoritos, el reproductor, los gestos, la selección y el reordenar. El
  complemento nativo `@capacitor/haptics` sale también de `mobile/` (package.json,
  package-lock y los gradle que genera `cap sync`), como decidió el usuario.
- **Límites de descarga más altos**, como pidió el usuario: `/api/start-download`
  pasa de 10/min y 100/h a 25/min y 200/h, y el cupo por cuenta de los lotes,
  de 100 a 200 por hora (el tope global, ver más abajo). Escuchar antes una
  recomendada también descarga, y diez escuchas seguidas agotaban el minuto.
- **Importar canciones del móvil: de ~50, solo entraban ~20.** Reproducido en el
  emulador (Android 14): la versión publicada no encontraba ninguna de las
  canciones bajadas por una instalación anterior.
  - Desde Android 11, el complemento Filesystem de Capacitor da su permiso por
    concedido sin pedir nada, y READ_MEDIA_AUDIO (o READ_EXTERNAL_STORAGE en 11
    y 12) no lo pedía nadie. Sin él, la app solo ve los ficheros que creó en esta
    instalación. Nuevo complemento nativo `PermisoAudioPlugin.java` (registrado en
    `MainActivity`) y `permisoDeAudio()` en `native/filesystem.js`: la ventana de
    permisos lo pide, y «Sincronizar» también. «Ahora no» no vuelve a preguntar al
    abrir.
  - La ventana de permisos había perdido sus estilos hacía tiempo y nadie lo vio,
    porque en Android 11+ nunca salía: rehecha con el componente de ventana.
  - «Download» y «Music» se buscaban dentro de Documentos: ahora son
    `../Download` y `../Music`, y se miran sus subcarpetas (hasta tres niveles).
    Quitar de la biblioteca una canción de esas carpetas no borra el fichero:
    es del usuario.
  - El botón de importar avisa de los ficheros que no se pudieron importar, en
    vez de perderlos sin decir nada. Pasar a base64 va de 32 KB en 32 KB (antes,
    byte a byte) y en el móvil se importan de dos en dos.
  - Comprobado en el emulador: con el arreglo aparecen las 15 canciones de las
    carpetas (7 en YTMusic, 3 de ellas de una instalación anterior, 2 en
    Música/Artista y 6 en Descargas), y suenan.
  - El presupuesto de arranque se pasaba: `library/importer.js` se carga al
    elegir los ficheros, y los botones van en `importar-entrada.js`.

- **Escuchar antes: primero YouTube y, si no se deja, por la caché.** Decidido
  con el usuario. En la búsqueda, la selección de una lista de YouTube y las
  recomendadas, la escucha va primero por el reproductor incrustado de YouTube:
  suena al instante y no gasta descargas. Si YouTube no deja incrustarla (errores
  101 y 150, casi todos los vídeos oficiales) o su API no carga, se baja en
  silencio a la caché de la radio y suena desde ahí (`features/escucha-cache.js`,
  con `import()`), y el icono late mientras tanto.
  - `features/preview.js` lo hace para todas: `escucharAntes(cancion, boton)`,
    `stopPreview()` y `alCambiarEscucha(fn)`, que avisa de cada cambio
    (`cargando`, `sonando` y `parada`) para remarcar por `videoId` los botones que
    se repintan. Al empezar a sonar pausa el reproductor de la app, y si este
    empieza a sonar, la escucha se para. La sesión B pasó las recomendadas a usarlo.
  - Descargar una canción que se escuchó por la caché es instantáneo también desde
    la búsqueda: `downloadFromUrl` mira primero la caché de la radio (`aBiblioteca`).
  - Antes, en la búsqueda, esos vídeos daban «contenido restringido» y no sonaban.
- **Tope global de descargas: de 600 a 1000 por hora** (`pico.py`), decidido con
  el usuario al subir el cupo por cuenta a 200.
- **Ajustes, una sola tarjeta.** El propio panel hacía scroll: su cristal (el
  borde y el grano, `::before` y `::after`) se desplazaba con el contenido y al
  bajar se veía una segunda tarjeta que cortaba «Novedades de cada versión» y la
  política de privacidad. La barra de scroll, además, tapaba las esquinas de la
  derecha. Ahora el panel queda quieto y solo hace scroll `.ajustes-cuerpo`.
- **Ventana de la app Android.** «Gratuita y segura» era el pie estándar de las
  ventanas, una franja oscura pensada para las que no tienen margen; aquí quedaba
  como un rectángulo suelto después de «Más información». Pasa a ser una nota
  pequeña justo bajo el botón de descargar, y el enlace queda al final.
- **CSS de arranque:** con lo anterior se pasaba de 140 KB. Fuera las reglas que ya
  no usa nada (el pie antiguo de la barra lateral, el botón de tema, la portada y
  el título antiguos de las tarjetas, el separador de la barra de la lista y
  otras sueltas): unos 3,4 KB.
- **Letras descuadradas en algunos videoclips** («NO SOY TUYO» de KAZE: la letra
  empezaba a los 0:11 y el canto, hacia los 0:49).
  - No era un fallo de la app: en LRCLIB, las tres fichas de la canción (el disco,
    de 3:24, y dos del videoclip, de 4:02) llevan los mismos tiempos, los del
    disco. Quien subió la del videoclip copió la del disco sin contar los 38 s de
    intro.
  - La app elegía bien la versión por duración, pero los tiempos no eran suyos.
    `tiemposDeOtraVersion` (en `letras/elegir.js`) lo detecta con dos señales a la
    vez: tras la última línea a la canción le quedan más de 30 s, y esos mismos
    tiempos están en una versión más de 15 s más corta en la que sí caben. Entonces
    la letra se enseña sin sincronizar, como ya se hacía desde el plan 22 con una
    versión de duración parecida pero no igual.
  - Medido contra las 36 canciones del plan 22 con LRCLIB real: sigue sin haber
    ninguna equivocada, y 5 videoclips (Shape of You, Los Ángeles, Despacito,
    DÁKITI y La Bachata) pasan a sin sincronizar por lo mismo que KAZE. Una regla
    más laxa (la duración en la que mejor caben los tiempos) quitaba la
    sincronización a 14, también a letras buenas: las ediciones de radio copian
    los tiempos con unos segundos menos.
  - Lo que no se puede saber solo con LRCLIB es si lo que le sobra al videoclip va
    al principio (y la letra iría por delante, como en KAZE) o al final (y la
    letra iría bien). En la duda, sin sincronizar.

**Tests.**
- `test_deshacer.mjs` (6).
- `test_letras.mjs`: «NO SOY TUYO» con sus tiempos reales (4).
- `test_hojas` adaptado: ya no hay confirmación de borrar una lista.
- Recorridos:
  - 103 reescrito: borrar sin confirmación, con la X del aviso;
  - 105: borrar de la biblioteca se deshace, y el audio solo se borra al acabar el
    aviso o al pasar a segundo plano;
  - 106: una lista borrada vuelve a su sitio con sus canciones;
  - 107: favoritos;
  - 108: selección en la biblioteca;
  - 109: selección en una lista, añadir a otra y quitar;
  - 110: los gestos;
  - 111: entradas fantasma;
  - 112: pulsación larga;
  - 113: el aviso de descarga sale al instante y un segundo intento no la pide otra vez;
  - 114: aleatorio y repetir se pulsan igual en la lista, la cola y la barra;
  - 115: escuchar antes en la búsqueda con YouTube negándose: suena por la caché y descargarla es instantáneo.
- Capturas `{móvil, escritorio}-seleccion` y `-deshacer`.

### Sesión B: T2 (P1, P2, P4 y P11), T3 (P5 y P12) y T4 (P3 y P7) (2026-10-10)

**Cómo se carga.** Lo nuevo de la vista de una lista va en
`features/playlists/detalle/` (`cabecera.js` y su CSS, `vista.js`, `descargar.js`
y `recomendadas.js`). Se carga con `import()` al abrir la primera lista, y las
recomendadas, al acercarse al final de la lista. «Editar playlist» y «Añadir
canciones» (`modals.js`) se cargan al tocarlos. Si la cabecera no carga, la lista
se abre igual.

**T2 · La cabecera y los botones.**
- **P1.** La portada en grande (la elegida o el mosaico), a la izquierda en el
  ordenador y centrada encima en el móvil. Detrás, un degradado radial con el color
  de la portada (`ui/palette.js`), que se apaga hacia abajo y hacia los lados y no
  sobresale más que el relleno del contenido (si no, había scroll de lado).
  Debajo, «5 canciones · 16 min · actualizada hace 2 días». `updatedAt` lo pone
  `store.js` (`marcarActualizadas`) solo si cambia lo que se ve: nombre,
  descripción, portada o qué canciones hay y en qué orden. No cuentan la duración
  ni la sonoridad que se rellenan solas, ni que una canción baje de la nube.
- **P2.** A la vista, Reproducir (grande y dorado), aleatorio, repetir, la lupa y
  ⋮. El menú ⋮ (`#playlistMenuSheet`, con el aspecto de «Opciones de la canción»)
  lleva Añadir canciones, Editar, Ordenar, Compartir, Seleccionar (de la sesión A)
  y Eliminar, en rojo. En Favoritos y en las automáticas solo quedan Ordenar y
  Compartir. Conserva los id de antes (`#plActionAdd`…), y en los recorridos
  `menuDeLista(page, id)` lo abre.
  - Compartir da «Artista – Canción» por línea, por la hoja de compartir del
    sistema o al portapapeles («Lista copiada: pégala en "Importar lista"»). Un
    test comprueba que Importar lo lee tal cual.
  - Reproducir empieza por la primera que se ve; antes usaba el orden guardado.
- **P4.** La barra fija (nombre y Reproducir) aparece con un fundido cuando la
  portada sale por arriba del contenedor que hace scroll. No ocupa sitio. Mientras
  no se ve, no recibe toques: al principio su fondo invisible tapaba el botón de
  volver.
- **P11.** En «Editar playlist», «Portada»: Automática o una de sus carátulas.
  - Se guarda como el `videoId` de esa canción (`pl.portada`) y viaja con la
    cuenta: columna nueva `playlists.portada` (con migración) y
    `validar_lista_sync`.
  - Si no es una de sus canciones, vuelve a la automática, también en el servidor,
    sin rechazar la lista.
  - Sale en la cabecera, en la tarjeta de la rejilla y en la vista previa de la
    ventana.

**T3 · Buscar, ordenar y estados vacíos.**
- **P5.** «Ordenar» del menú abre «Ordenar por»: personalizado, título, artista,
  añadida recientemente (el orden guardado al revés) o duración (de la más corta a
  la más larga; las que no se sabe, al final).
  - Se recuerda por lista en este dispositivo (`localStorage`) y no cambia el orden
    guardado.
  - En todos, lo descargado va primero, como en la biblioteca.
  - «Mover a mano» es el reordenar de antes: vuelve al orden personalizado y quita
    la búsqueda.
  - La lupa filtra por título y artista, sin tildes ni mayúsculas. Reproducir y
    los clics siguen lo que se ve. La búsqueda se olvida al entrar en otra lista o
    al volver a entrar, pero no al repintar la misma por un cambio.
- **P12.**
  - `ui/empty-states.js` acepta varias acciones, con `id` y una secundaria. Es
    compatible con lo de antes.
  - Una lista vacía: «Añadir canciones» y «Ver recomendadas», que parten de lo que
    suena o de lo más escuchado.
  - La biblioteca vacía: «Buscar música» e «Importar lista».
  - Una búsqueda sin nada: «Nada con «xyz» en esta lista» y «Borrar la búsqueda».
  - Arreglado de paso: pintar las filas sacaba del documento el estado vacío de la
    lista, que vive dentro de ella, y una lista que se quedaba vacía no lo enseñaba.

**T4 · Descargar las que faltan y recomendadas.**
- **P3.** `descargar.js` exporta `descargarCanciones(canciones, { alProgreso })`
  (también lo usa la barra de selección de la sesión A). Reutiliza `descargarVarias`
  de `sync/nube.js`, el lote de «Descargar las que faltan» de la biblioteca:
  - una sola petición, la isla y sus avisos, y el tope de descargas por hora;
  - sin conexión, `cloud_offline`.

  En la cabecera, «Descargar las 3 que faltan», con «Descargando 1 de 3…»
  mientras tanto.
- **P7.** Al final de la lista, cinco parecidas que no estén ya en ella:
  - Salen de `/api/radio` con una canción de la lista al azar como semilla, y se
    eligen con `elegir` de la radio: una por canción, ni muy cortas ni muy largas,
    y la descargada si la hay. Como mucho tres mezclas por lista abierta.
  - Se piden solo si el final de la lista llega a verse.
  - «Otras» enseña cinco más.
  - Cada una lleva su escucha previa y un +: si ya está descargada, entra tal
    cual; si está en la caché de la radio, se guarda sin volver a bajarla; si no,
    se descarga.
  - Con YouTube limitando o sin red, la sección no sale. Solo en las listas propias.

**Lo que salió por el camino.**
- El presupuesto de arranque, con las dos sesiones, llegó a 291 KB. Ahora está en
  unos 289,6 KB, con estos recortes:
  - `modals.js` se carga al usarlo;
  - la configuración de Sortable pasa a `vista.js`;
  - el estado vacío de la lista se rellena al abrirla;
  - los estilos en línea de las portadas de la rejilla pasan a `listas.css`. La
    captura `movil-listas` sale idéntica; solo la sombra roja del corazón de
    Favoritos ahora también crece al pasar el ratón.

  Los textos nuevos de `es.js` cuentan en el arranque.
- Dos elementos con su propio `display` no se escondían con el atributo `hidden`:
  «Descargar las 0 que faltan» y «Borrar la búsqueda». Los vio la sesión A en sus
  capturas. Ahora llevan reglas `[hidden]`.
- El mosaico de la portada salía como una sola carátula: un `display: block` le
  anulaba la rejilla.

**Tests.**
- Unitarios:
  - `test_cabecera_lista.mjs` (10): «actualizada hace…», Compartir, la portada
    elegida y su sincronización, y `marcarActualizadas`;
  - `test_vista_lista.mjs` (8): ordenar y buscar;
  - `test_recomendadas.mjs` (4).
- Servidor: la columna nueva en una base antigua, y la portada que solo viaja si es
  de la lista (`test_sync.py`, 2).
- Recorridos:
  - 120: la cabecera, Reproducir en el orden que se ve, el menú y «Hecho»;
  - 121: Compartir;
  - 122: la portada elegida y vuelta a la automática;
  - 123: la barra fija;
  - 124: descargar las que faltan;
  - 125: buscar y ordenar;
  - 126: los estados vacíos;
  - 127: las recomendadas, «Otras» y el +;
  - 128: «Ver recomendadas» en una lista vacía, y sin radio no sale.
- Adaptados al menú ⋮: 22, 28, 98, 103 y 104.
- Cambian a propósito las capturas `lista-detalle` (móvil y escritorio) y
  `editar-lista` (los tres tamaños).

**Tras la prueba del usuario en local (2026-10-10).**
- **La barra fija** ocupaba solo la columna central (en una pantalla de 2560 px,
  una franja estrecha en medio). Ahora es `position: fixed` sobre toda el área de
  contenido: de la barra lateral al borde, o de lado a lado en el móvil, debajo de
  su cabecera.
  - Se coloca con la caja de `.main-content` y un `ResizeObserver`.
  - El nombre y Reproducir van alineados con la columna.
  - Lleva cristal, borde inferior fino y sombra suave.
- **«Escuchar antes» en las recomendadas no sonaba.**
  - El reproductor de YouTube incrustado daba el error 150: los dueños de casi
    todos los vídeos oficiales, que son los que salen en las mezclas, no dejan
    incrustarlos.
  - Decisión del usuario: primero YouTube (al instante y sin gastar descargas) y,
    solo si no se deja (101/150) o su API no carga, el audio bajado en silencio a
    la caché de la radio.
  - Lo hace `escucharAntes` de `preview.js` (sesión A), común con la búsqueda.
    `recomendadas.js` lo usa y marca sus botones con `alCambiarEscucha`, porque
    sus filas se repintan.
  - Si se escuchó por la caché, el + la pasa a la biblioteca sin volver a bajarla.
- Recorrido 129: una recomendada que YouTube no deja incrustar baja a la caché
  y suena, y el + no la vuelve a pedir al servidor.
