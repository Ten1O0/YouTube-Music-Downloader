# 27 — Ninguna canción ni lista sin portada

**Estado:** hecho · sin desplegar · planeado con el usuario el 2026-10-21, hecho el 2026-10-22 en paralelo por dos sesiones · **Prioridad:** 🟡 Medio · **Depende de:** 24 (portada elegida, P11), las miniaturas en dos tamaños (eccb0f4, tras la 2.1.1)

> El usuario (2026-10-21): «En caso de importar canciones viejas que ya se tenían
> descargadas de antes y que por tanto NO tengan carátula. Para ese tipo de
> playlist en las que SOLO hay canciones SIN carátula, habría que hacer algunas
> portadas entre las que se puedan seleccionar, de manera que no se quede nunca
> sin una portada.»

---

## Problema

Las canciones viejas importadas del móvil suelen llegar sin carátula
(`thumbnail: ''`). Hoy:

- Una lista que solo tiene canciones así muestra un icono de nota sobre un fondo
  vacío (`portadaDeLista` en `features/playlists/crear.js`, clase `portada-vacia`),
  en la tarjeta de «Mis Playlists», en la cabecera y en «Editar».
- En las filas, cada sitio cae a `favicon.png` por su cuenta: 18 apariciones en
  11 módulos (biblioteca, artistas, cola, selector, ventanas de listas, cabecera,
  recomendadas, isla de descargas, `core/html.js`…).
- El reproductor y la pantalla de bloqueo se quedan sin imagen.

Además, muchas de esas canciones ya tienen su `videoId` (o el buscador de ids se
lo encuentra) y su carátula de YouTube sale de él gratis, pero nadie la pone.

## Decisiones del usuario (2026-10-21)

1. **Estilo:** degradado y formas abstractas con los colores de la app, sin
   texto. Es el estilo de las portadas de ejemplo de `scripts/capturas-readme.mjs`.
2. **Carátulas reales:** se intenta recuperarlas **una sola vez por canción** y
   solo en las que no tienen carátula. Si no se encuentra, la canción se queda
   sin carátula real y **no se vuelve a intentar**: nada de rebuscar cada cierto
   tiempo. Las que ya tienen carátula no se tocan.
3. **Dónde se guarda:** en la app, junto a la canción, como las importadas. El
   fichero de audio no se toca.
4. **También sin sesión iniciada.** El gasto queda acotado: una búsqueda por
   canción en toda su vida, con pausas.
5. **«Editar → Portada»:** las portadas generadas se pueden elegir **en todas las
   listas**, junto a las carátulas de sus canciones. Solo salen solas, como
   automática, en las listas sin ninguna carátula.
6. **Canciones sueltas:** el mismo generador da portada a las canciones que se
   queden sin carátula, en las filas, el reproductor y la pantalla de bloqueo.

## Fuera de alcance

- Escribir la carátula dentro del fichero M4A o MP3 (decisión 3).
- Reintentos periódicos o búsquedas repetidas (decisión 2).
- Subir una imagen propia como portada.

## Pasos

### T1 · El generador de portadas (puro)

`core/portadas-generadas.js`:

- `portadaGenerada(semilla, variante?)` devuelve `{ src, colores }`:
  - `src` es un SVG en `data:image/svg+xml`, de 1 KB más o menos, sin texto y
    nítido a cualquier tamaño.
  - `colores` son los dos o tres colores del degradado.
- **8 variantes:** pares de colores de la paleta de la app combinados con varias
  disposiciones de formas (círculos y franjas, como en `capturas-readme.mjs`).
- **Siempre la misma:** la variante sale de un hash de la semilla (FNV-1a).
  - En una lista, la semilla es su **id**, no el nombre: renombrarla no cambia
    la portada.
  - En una canción, el color sale del **artista** y las formas de la propia
    canción (`videoId` o `src`). Así, las canciones sin carátula de un mismo
    artista se reconocen entre sí. *(Propuesta; confirmar al revisar el plan.)*
- **Peso:** el presupuesto de arranque del plan 19 (`test_estructura.mjs`) va muy
  justo: el plan 26 tuvo que cargarse aparte por 1 KB. El generador y todo lo
  nuevo van con `import()` diferido, la primera vez que se pinta algo sin
  carátula. Mientras carga, la fila conserva el aspecto de hoy.

### T2 · Las listas

- `portadaDeLista`: sin carátulas, la portada **generada automática** sustituye a
  `portada-vacia`.
- **`pl.portada` acepta `gen:0`…`gen:7`,** además del videoId de una de sus
  canciones:
  - `caratulaElegida` (`playlists/portada.js`) devuelve la generada.
  - La validación cambia en los dos lados: `sync/validar.js:75` y `server.py`
    (~2677, `validar_lista_sync`). Lo que no sea ni lo uno ni lo otro sigue
    pasando a `''`.
  - **Orden de despliegue:** el servidor antes que la web y la APK. Si no, el
    servidor borra `gen:N` al sincronizar.
- **«Editar → Portada»:** «Automática», las carátulas de sus canciones y las 8
  generadas, en todas las listas.
- **Cabecera:** con una portada generada, el degradado de detrás usa
  directamente sus `colores`, sin `paletteFromImage`.

### T3 · Las canciones sin carátula

- **Un único ayudante** `caratulaDe(song, { grande })` sustituye la caída a
  `favicon.png` en los 11 módulos. Hay que revisarlos uno por uno:
  - Algunos `favicon.png` son el `onerror` de una imagen rota (YouTube caído);
    ahí también vale la generada.
  - Otros son el icono de la app a propósito, y esos se quedan.
- **Reproductor a pantalla completa y fondo con la carátula:** usan los `colores`
  del generador.
- **Pantalla de bloqueo:** `ui/artwork.js` (`caratulaCuadrada`) dibuja la imagen
  en un canvas y saca un JPEG de 512 o 320 px. Un SVG en `data:` se puede dibujar
  igual. Hay que comprobarlo en la APK: el plugin nativo solo acepta un mapa de
  bits pequeño, con el límite de 1 MB de Binder.

### T4 · Recuperar la carátula real, una sola vez

Solo se buscan canciones **sin** carátula. Hay dos casos:

**a) La canción ya tiene `videoId`.** No hace falta buscar nada: la carátula es
`miniaturaDeYoutube(videoId)` (`core/miniaturas.js`).

- **En la APK** se descarga una vez y se guarda en el dispositivo como las
  importadas (`guardarMiniaturaNativa`: 240 px más la grande como `caratula`),
  así que se ve sin conexión.
- **En la web** las miniaturas ya son enlaces (`miniaturas.js`); se guarda el
  enlace.
- **Vídeo borrado o privado:** `i.ytimg.com` responde **404** (comprobado el
  2026-10-21: devuelve una imagen gris de 1 KB con ese código). Se cuenta como
  «no encontrada».

**b) La canción no tiene `videoId`.** Se aprovecha el buscador que ya existe
(`buscarIdsPendientes` en `sync/sync.js` y `buscarId` en `sync/identidad.js`).
Ya hace casi todo lo que pidió el usuario:

- un único intento por canción, guardado en `sync_ids_buscados` y nunca repetido;
- una búsqueda cada 6 s;
- como mucho 60 por sesión;
- solo con la app a la vista.

Hay que cambiar tres cosas:

- **Que funcione sin sesión iniciada** (decisión 4). Hoy sale si no hay
  `cuentaActual()`. La reparación del id es local, así que no la necesita.
- **Que la coincidencia sea más estricta:** el título exacto, como ahora, más el
  artista (el canal, o el artista dentro del título) y la duración con un margen
  de unos pocos segundos, cuando la canción la tiene. Los resultados de
  `/api/search` ya traen `channel` y `duration`.
- **Que al encontrarla se guarden el `videoId` y, además, la carátula,** como en
  el caso a.

**Una sola vez:** se apunta que la carátula ya se intentó (en la misma clave o en
una marca por canción). Una canción que ya se buscó antes de este plan no se
vuelve a buscar. Si se queda sin carátula real, tiene la generada (T3).

**Gasto:**

- El caso a no hace ninguna búsqueda en el servidor; solo descarga la imagen de
  `i.ytimg.com`, una vez.
- El caso b hace como mucho 60 búsquedas por sesión, a una cada 6 s, y cada
  canción una vez en toda su vida.

### T5 · Tests

- **Unitarios (`test/frontend/`):**
  - el generador: siempre igual para la misma semilla, 8 variantes distintas y el
    SVG bien formado;
  - `validarLista` con `gen:N`;
  - `caratulaElegida` con una portada generada;
  - la coincidencia con artista y duración;
  - el intento único, que no se repite al recargar.
- **Backend (`test_sync.py`):** `gen:3` se acepta; `gen:99` y `gen:x` quedan en `''`.
- **E2E (del 138 en adelante, según cómo acabe el plan 26):**
  - una lista solo con canciones sin carátula muestra la generada en la tarjeta,
    la cabecera y «Editar»;
  - elegir una variante y que se mantenga al recargar (ampliar el 122, que
    compara el `src` en los tres sitios);
  - una canción con `videoId` y sin carátula la recupera;
  - una sin `videoId` hace una búsqueda y, al recargar, no la repite;
  - las filas sin carátula muestran la generada.
- **APK en el emulador** (con `-gpu host`): la pantalla de bloqueo con una
  portada generada.

## Verificación

- Importar al emulador unas canciones sin carátula, la mitad con un título que
  YouTube encuentre:
  - las encontradas acaban con su carátula de YouTube, también sin conexión;
  - las demás tienen una portada generada;
  - una lista con solo esas canciones nunca muestra el icono vacío.
- Cerrar y abrir la app varias veces: el registro del servidor no muestra
  búsquedas repetidas de las mismas canciones.

## Riesgos

- **APK antiguas:** reciben `gen:N`, lo validan como `''` y muestran la portada
  automática. Si alguien edita esa lista desde una APK vieja, se pierde la
  variante elegida. No rompe nada.
- **Coincidencia más estricta:** el buscador de ids encontrará algo menos que
  hoy. Es el precio de no asignar la carátula de otra canción.
- **Carátula de otra subida:** aun con título, artista y duración, puede salir
  el fotograma de un vídeo con letra en vez del oficial. Se puede cambiar con
  «Editar» en la canción.
- **Presupuesto de arranque:** ver T1.

## Registro

**2026-10-22 · hecho, en paralelo.** La sesión A hizo T1, T2 y T3 y sus pruebas;
la sesión B, la T4 y las suyas.

### T1 · El generador (sesión A)

- `core/portadas-generadas.js` (nuevo, puro, se carga aparte): `portadaGenerada(semilla, variante)`
  y `portadaDeCancion(artista, id)`, que devuelven `{ src, colores }`. Un SVG de unos 800
  bytes, de 512×512 (con tamaño propio: la pantalla de bloqueo lo dibuja a su tamaño
  natural), sin texto. 8 pares de colores (con el dorado y la salvia de la app) y 4
  disposiciones de formas. FNV-1a para que siempre salga la misma.
- `core/portada-generada.js` (nuevo, en el arranque): `caratulaDe(song)`,
  `portadaDeListaGenerada(id, variante)`, `caratulaSegura(song)` y `varianteDe('gen:N')`.
  Mientras el generador no ha llegado, devuelve el icono de siempre con una marca
  (`favicon.png#gen=…`, que el navegador no tiene en cuenta), y al llegar cambia cada
  imagen marcada por su portada. La portada generada nunca se guarda en la canción.

### T2 · Las listas (sesión A)

- `pl.portada` acepta `gen:0` … `gen:7` en `validar.js` (lo que llega de la cuenta),
  `fusion.js` (lo que sube) y `server.py`. Lo demás sigue cayendo a `''`.
- Sin ninguna carátula, la portada generada de la lista en la tarjeta, la cabecera,
  «Editar», «Añadir a una lista» y la ventana de crear. Una lista nueva lleva el id que
  se decidió al abrir la ventana, para que nazca con la portada que se veía.
- «Editar → Portada», en todas las listas: «Automática», las carátulas de sus canciones
  y las 8 generadas.
- La cabecera toma el color de la portada generada tal cual, sin analizar la imagen.
- Fuera el CSS del icono vacío (`portada-vacia`, `playlist-card-cover-vacia`).

### T3 · Las canciones (sesión A)

- `caratulaDe(song)` en la biblioteca, la cola, las recomendadas, los artistas, el aviso
  de descargas, el selector de canciones y el aviso de deshacer. Los `onerror` de una
  imagen rota siguen con el icono de la app, como antes.
- El reproductor resuelve la portada generada (`caratulaSegura`) y se la pasa a la
  pantalla de bloqueo (`_caratulaPintada`). Comprobado en la APK del emulador: la
  notificación multimedia la enseña.

### T4 · Las carátulas reales (sesión B)

- `features/library/caratulas-modelo.js` (nuevo, puro) y
  `features/library/caratulas-recuperadas.js` (nuevo, se carga aparte, detrás de las
  migraciones de miniaturas).
- Con `videoId` y sin carátula: `mqdefault.jpg` una sola vez. En la web se guarda el
  enlace; en la APK, el fichero (comprobado en el emulador). Un 404 cuenta como
  intentada; un fallo de red no gasta el intento. Lo intentado, en
  `ytdl_caratulas_intentadas`. Biblioteca y listas al día cada 10, y un solo repintado.
- Sin `videoId`: el buscador de siempre, ahora en el módulo diferido y también sin
  cuenta (sin cuenta, solo canciones sin carátula, desde los 20 s). Coincidencia: título
  exacto, artista y duración ±5 s cuando se saben, y un único vídeo que cumpla. Una vez
  por canción en toda su vida (`sync_ids_buscados`, la de antes).

### Pruebas

- Unidad: `test_portadas_generadas.mjs` (10, sesión A) y `test_caratulas.mjs` (18,
  sesión B). Backend: `gen:N` en `test_sync.py`.
- Recorridos: 122 (ahora con 11 portadas para elegir), 142-145 (sesión A) y 147-150
  (sesión B).
- APK en el emulador (`-gpu host`): filas, reproductor y notificación con portada
  generada; carátula real recuperada y guardada en el móvil.
- Tanda E2E completa: 142 de 147. Las tres capturas de «editar una lista e importar»
  cambiaban a propósito (ahora salen las 8 generadas) y se regeneraron. El 50, el 70 y
  el 83 fallaron con la tanda cargada y solos pasan 3 de 3.

### Lo que salió por el camino

- El presupuesto de arranque tenía 733 bytes de margen: por eso el generador va aparte,
  con la marca para no esperar. La sesión B, al sacar el buscador de `identidad.js`,
  liberó más de lo que añadió; al final quedan 701 bytes.
- El tope de «60 búsquedas por sesión» no era real: se reiniciaba en cada vuelta de
  sincronización. Corregido (sesión B).
- En la web, las carátulas recuperadas son enlaces, como las de cualquier descarga: sin
  conexión solo se ven si el navegador las tiene en su caché. En la APK se guardan.
- Reconstruir `dist/` mientras la otra sesión pasaba recorridos le hizo fallar uno («Frontend
  no compilado»): `dist/` se vacía al compilar.
- **Orden de despliegue:** el servidor antes que la web y la APK, o el servidor borrará
  `gen:N` al sincronizar.

