# 25 — Recomendaciones variadas: muchos artistas, el mismo estilo

**Estado:** hecho · sin desplegar · aprobado por el usuario el 2026-10-11, con cambios · **Prioridad:** 🟠 Medio · **Depende de:** 16 (radio), 24 (recomendadas)

> El usuario, probando el plan 24 (2026-10-11): las recomendadas de una lista y la
> radio salen casi siempre del mismo artista, el de la última canción o el de la
> primera. Quiere que sigan el estilo de la lista, pero con varios artistas: los
> de la lista y otros parecidos (por género, temática, colaboraciones…). Y que lo
> que ya está en la biblioteca no se proponga para descargar.

---

## 1. Por qué pasa (medido)

La radio y las recomendadas salen de la mezcla que YouTube hace de una canción
(`watch?v=<id>&list=RD<id>`). El servidor lee sus **primeros 35** vídeos
(`MAX_CANCIONES_MIX`), y la app los elige **en ese orden**.

Para un artista muy conocido, esos 35 ya son variados: con «Despacito» salen
Enrique Iglesias, Shakira, Don Omar, Maluma, Karol G… Para uno de nicho, no: con
«NO SOY TUYO» de KAZE, **27 de los 35 son de KAZE**.

Pero la mezcla no acaba ahí. Más abajo está justo lo que pide el usuario:

| Se leen | Vídeos | Artistas distintos | De KAZE | Tarda |
|---|---|---|---|---|
| 35 (hoy) | 34 | 6 | 27 | ~2,6 s |
| 100 | 100 | 22 | 39 | ~4-5 s |
| toda | 724 | decenas | 95 | — |

Y los artistas que aparecen son del mismo estilo: Space Hammu, Ayax y Prok, JdJ,
Blake, Natos y Waor, Fernandocosta, Hard GZ, SFDK, Kase.O, Foyone… La mezcla de
YouTube Music (`list=RDAMVM<id>`) da algo parecido; ninguna es claramente mejor.

Además, las recomendadas de una lista parten de **una sola canción al azar**: con
una lista de cinco artistas, salen sobre todo de uno.

**Conclusión:** YouTube ya sabe qué es «parecido»: no hace falta otro servicio
para el género. Hay que leer más de cada mezcla, partir de varias canciones de la
lista y elegir repartiendo entre artistas.

## 2. Qué se propone

### R1 · Leer más de cada mezcla

El servidor lee **100** vídeos por mezcla en vez de 35 (unos 2 s más, solo la
primera vez: la mezcla se guarda 30 minutos en la caché del servidor).

### R2 · Elegir repartiendo entre artistas

`elegir` deja de tomar las primeras de la mezcla. Reglas, de más a menos peso:

- **Como mucho dos canciones por artista** (lo decidió el usuario: con una sola
  se perdía demasiado) en cada tanda de recomendadas y, en la radio, entre lo que
  ha sonado hace poco y lo que está listo. Solo si no hay bastantes artistas
  distintos se pasa de dos.
- **Mezclar lo conocido con lo nuevo**: más o menos la mitad de artistas que ya
  están en la lista (o en la radio que suena) y la otra mitad, artistas nuevos.
- **Las colaboraciones cuentan**: si un artista nuevo aparece en un «feat.» con
  uno de la lista, va antes que otro sin relación.
- **Lo que sale en varias mezclas, antes**: si una canción aparece en las mezclas
  de dos canciones distintas de la lista, encaja con el estilo de toda la lista,
  no solo con el de una canción.
- El artista que acaba de sonar no se repite en la siguiente.

### R3 · Partir de varias canciones de la lista

Las recomendadas de una lista piden la mezcla de **hasta 5 canciones** de la
lista (más muestras, lo pidió el usuario), de artistas distintos mientras se
pueda, no de una al azar, y juntan lo que sale. Las mezclas se piden a la vez y
cada una se guarda 30 minutos en el servidor. «Otras» rota
hacia otras canciones de la lista. La radio sigue alternando entre la canción de
partida y la última escuchada entera, pero también reparte artistas.

### R4 · Lo que ya está en la biblioteca

- **Recomendadas de una lista:** una canción que ya está descargada **no se
  propone para descargar**. Sale como recomendada, pero su botón es «Añadir a la
  lista» (sin descarga, al momento), con una marca de que ya es tuya. Lo confirmó
  el usuario.
- **Radio:** lo descargado puede sonar en la radio (ya es así: suena al instante y
  no gasta datos), pero también cuenta para el reparto entre artistas.

### R5 · La radio con una sola canción (no se hace)

Con la cola de una canción la radio ya se prepara al empezar a sonar (lo comprueba
el recorrido 81). El usuario lo volvió a probar y le funcionó: lo que lo impedía
era tener «repetir» activado, con el que la cola se repite sola y la radio no
entra, como debe ser. No hay nada que cambiar.

## 3. Tareas

1. **T1 · Servidor:** leer 100 vídeos por mezcla. Tests de `radio.py` y de la caché.
2. **T2 · `pick.js`:** `elegir` con reparto por artista, conocidos y nuevos,
   colaboraciones y coincidencias entre mezclas. Funciones puras, con tests.
3. **T3 · Recomendadas (`recomendadas.js`):** varias semillas de artistas
   distintos, «Otras» rotando, lo descargado sin botón de descarga.
4. **T4 · Radio (`radio.js`):** el mismo reparto, con lo que ha sonado hace poco.
5. **T5 · Medir:** como en el plan 22, un script que compare, con mezclas reales,
   cuántos artistas distintos salen antes y después en varias listas de prueba.
6. **T6 · Tests E2E:** recomendadas y radio con una mezcla falsa dominada por un
   artista: salen varios artistas, y nada descargado aparece para descargar.

### Reparto entre sesiones

- **Sesión A:** T1 (servidor), T2 (`pick.js`, el reparto común), T4 (radio) y T5
  (medir).
- **Sesión B:** T3 (recomendadas: las cinco semillas y lo descargado) y sus
  recorridos E2E.

## 4. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Más tiempo para la primera mezcla (~2 s) | Solo la primera vez por canción: la caché del servidor la guarda 30 min |
| Más peticiones a YouTube | Una por mezcla, como ahora; las recomendadas piden hasta 5 por lista, cada una con su caché de 30 min en el servidor |
| Repartir demasiado y perder el estilo | Todo sale de las mezclas de la propia lista: el reparto solo cambia el orden |
| Canciones de relleno de canales de recopilatorios | Las reglas actuales (duración, una versión por canción) se mantienen |

---

## 5. Registro

### Sesión A: T1, T2, T4, T5 y la rejilla de «Mis Playlists» (2026-10-11)

**T1 · Servidor.** `/api/radio` lee 100 vídeos de cada mezcla
(`MAX_CANCIONES_RADIO`, con `build_playlist_cmd(..., hasta=)`). Un mix pegado en
el buscador sigue leyendo 35 (`MAX_CANCIONES_MIX`): ahí son canciones para
elegir, no recomendaciones. `test_radio.py` comprueba los dos topes.

**T2 · El reparto (`radio/pick.js`), común a la radio y a las recomendadas.**
- `artistasDe` y `claveArtista`: los artistas de una canción, normalizados, con
  las colaboraciones («feat.», «Nacho, Yandel, Bad Bunny»).
- `juntarMezclas`: varias mezclas en una lista, sin repetidos, con `veces` (en
  cuántas salió) y por su mejor puesto.
- `elegir` reparte:
  - como mucho 2 por artista, contando lo que ha sonado hace poco (`recientes`);
    solo si no hay bastantes artistas se pasa de ahí;
  - con `conocidos`, más o menos mitad de artistas conocidos y mitad nuevos;
  - pesan a favor salir antes en la mezcla, salir en varias y colaborar con un
    conocido; el último artista no va el primero.
- `test_radio.mjs`: 7 casos nuevos; los 20 de antes siguen en verde.

**T4 · La radio (`radio.js`).** Apunta el artista de cada canción que suena: los de
esta radio son los conocidos, y lo último que ha sonado, lo listo y lo que baja
cuenta para no pasar de dos seguidas del mismo.

**T5 · Medido con mezclas reales** (`scripts/medir-recomendaciones.mjs`, tres listas
de cinco canciones):

| Lista | Antes | Después | «Otras» |
|---|---|---|---|
| Rap español (KAZE, Natos y Waor, Foyone) | 3 artistas, 3 de KAZE | 4 artistas, máx. 2 | 4 artistas, máx. 2 |
| Pop latino | 5 artistas | 4 artistas, máx. 2 | 5 artistas, máx. 1 |
| Rock | 4 artistas, 2 de Queen | 4 artistas, máx. 2 | 5 artistas, máx. 1 |

En el rap salen ahora Hard GZ, Ayax y Prok, SFDK o Foyone, y no tres de KAZE. En
el pop, que ya era variado, «después» trae una de Shakira más a cambio de la mitad
de conocidos: es el reparto que pidió el usuario (de su lista y de fuera).

**La rejilla de «Mis Playlists»** (petición del usuario durante el plan):
- La lista de la que sale lo que suena se resalta (borde dorado, un brillo y
  «Sonando» con barras que se paran en pausa), también mientras suena su radio. El
  reproductor avisa con `cola-nueva` al empezar una cola, y Listas apunta la lista
  abierta en ese momento; desde la biblioteca o la búsqueda, ninguna.
- Cada tarjeta dice cuántas canciones, cuánto duran y cuántas en la nube
  (`textoDeLista`, el de la cabecera).
- Tarjetas más grandes en los dos modos (cuadrícula de 200 px como mínimo, dos
  columnas en el móvil; filas de 100 px con portada de 76) y la vista de Playlists
  más ancha (1180 px) para ocupar la pantalla en monitores grandes.
- Las barras de «sonando» no tenían estilos y en la cola salían invisibles: ahora
  se ven en los dos sitios.

**El fondo con la carátula** (petición del usuario, con sus decisiones: solo la
zona central y con interruptor en Ajustes):
- `#fondoAmbiente`, una capa detrás de la zona central (en el ordenador, sin la
  barra lateral), con dos manchas grandes y suaves de los colores de la carátula
  que suena: los mismos tres que ya sacaba el reproductor (`ui/palette.js`), que
  `pintarFondoFp` pone ahora también aquí. Al cambiar de canción se funden.
- Se mueven despacio mientras suena. Al pausar, la animación frena hasta pararse
  en 1,5 s, y al seguir arranca otra vez hasta su velocidad (`ui/ambiente.js`, con
  `playbackRate`). Solo se anima `transform`, sin desenfoques en vivo; con
  «Reducir movimiento», quieto.
- «Fondo con la carátula» en Ajustes, encendido por defecto y de cada
  dispositivo (no viaja a la cuenta).
- `ui/ambiente.js` y su CSS se cargan con la primera canción que suena.

**«Cargar 25 más» en una mezcla pegada** (petición del usuario; se prefirió a un
deslizador de 5 a 100):
- Una mezcla (RD…) pegada en el buscador sigue abriéndose con 35. Debajo de la
  lista sale «Cargar 25 más», que la vuelve a leer hasta 60, 85 y 100 (la última
  tanda dice «Cargar 15 más»); al llegar a 100 el botón se va.
- `/api/playlist-info` acepta `hasta` para las mezclas, acotado entre 10 y 100
  (lo que no es un número, 35); en una lista normal no cambia nada.
- Las nuevas entran al final y marcadas, sin repetir las que ya estaban (las
  mezclas repiten). Lo desmarcado y lo escrito en el buscador se quedan: el
  selector común tiene un `anadir()` y las claves (posiciones) no se mueven.
- Si una tanda no trae ninguna nueva, avisa «No hay más canciones en esta
  mezcla» y quita el botón.
- La descarga de lo elegido ya respeta lo cargado (es un lote con esas
  canciones); la descarga directa de una mezcla entera sigue en 35.
- Recorrido 133 y pruebas del servidor para `hasta`. El arranque queda en
  293 199 bytes (unos 4,3 KB de margen).

**«Otras» enseña que busca** (petición del usuario: al pulsarlo no se notaba
nada y parecía que había que volver a pulsar):
- Mientras busca, el botón lleva un aro dorado que gira y está desactivado; las
  cinco de ahora se apagan y una onda dorada las recorre de arriba abajo. No se
  pueden pulsar y la lista queda `aria-busy`.
- Las nuevas entran una tras otra. La búsqueda dura al menos 600 ms: con la
  mezcla ya en memoria llegaba en el acto y el cambio no se veía.
- Con «Reducir movimiento», el aro queda quieto y no hay onda ni entrada.
- Va en el CSS de la vista de lista, que se carga al abrirla: no toca el
  arranque. Recorrido 134; las capturas no cambian.

**Lo que salió por el camino.**
- La radio con una lista de una canción sí se prepara: el bloqueo era «repetir»
  (R5, no se hace).
- El presupuesto de arranque llegó a pasarse (297 723 bytes de 297 471 posibles)
  con el fondo. `library/recovery.js` (escanear y recuperar en la APK) sale del
  arranque: lo cargan main.js (solo en la APK), permissions.js e
  importar-entrada.js al usarlo. Queda en 292 205 bytes, unos 5 KB de margen.
- En la tanda final, el recorrido 12 (la carátula que respira al pausar) falló una
  vez con toda la tanda en marcha; solo pasa 4 de 4. Es intermitente con carga.
- Recorridos 130 (la radio de nicho reparte), 131 (la lista que suena) y 132 (el
  fondo: colores, frena y arranca, interruptor); capturas
  regeneradas: listas, importar y nueva lista (con la rejilla detrás) y la cola.

### Sesión B: T3, las recomendadas de una lista (2026-10-11)

- **Semillas (R3).** `semillasDe(canciones, 5)` toma hasta cinco canciones de la
  lista, de artistas distintos mientras se pueda: primero una de cada artista y,
  si faltan, la segunda de cada uno, al azar dentro de cada artista y entre
  artistas (`claveArtista` de `pick.js`).
- **Las mezclas, a la vez.** Se piden juntas (`Promise.all`) y se unen con
  `juntarMezclas`. Como mucho diez mezclas por lista abierta.
- **«Otras» rota.** Antes de elegir, pide las mezclas de canciones de la lista que
  aún no se han usado. Los artistas de la tanda que se veía cuentan para el tope
  (`recientes`), y así la siguiente no los repite de golpe.
- **Reparto (R2).** `elegir` de la sesión A, con `porArtista: 2` y como
  `conocidos` los artistas de la lista.
- **Lo que ya es tuyo (R4).** Una recomendada ya descargada sale con «· En tu
  biblioteca», el icono de añadir a la lista y la etiqueta «Añadir a la lista»: se
  añade al momento, sin descargar. Las demás llevan el icono de descarga y
  «Descargar y añadir a la lista».
- **Tests.**
  - `test_recomendadas.mjs` (7): semillas de artistas distintos, como mucho dos
    por artista y lo tuyo.
  - Recorridos, con la mezcla de nicho de la sesión A:
    - 135: como mucho dos de «Grupo Nicho» por tanda, también tras «Otras»;
    - 136: una recomendada ya descargada se añade sin pedir ninguna descarga;
    - 137: una lista con dos artistas pide las dos mezclas.
  - 127-129 siguen en verde.
  - El 129 falló una vez en una tanda que coincidió con dist/ a medio construir;
    solo, 3 de 3.
- **Después, a petición del usuario: las recomendadas, siempre a la vista.**
  - La sección sale siempre en las listas propias, con su título.
  - Mientras cargan, esqueletos: de fila en la columna, de tarjeta en la fila
    deslizable.
  - Si no llega nada, lo dice dentro de la sección y ofrece «Reintentar». Distingue
    sin conexión, YouTube sin respuesta y lista sin de qué partir.
  - Se piden al abrir la lista (con la caché del servidor), no al acercarse al
    final. En una lista vacía, a partir de lo que suena o de lo más escuchado, así
    que el estado vacío ya no lleva «Ver recomendadas».
  - Desde 1200 px de ventana, el detalle se ensancha a 1180 px: las canciones a la
    izquierda y las recomendadas en una columna de 340 px a la derecha, pegada
    bajo la barra fija al bajar. Más estrecho y en el móvil, justo debajo de los
    botones, en una fila de tarjetas que se desliza de lado.
  - Los botones de la cabecera solo cambian de fondo al pasar el ratón: en el
    móvil se quedaban marcados tras un toque.
  - El recorrido 128, reescrito: la lista vacía las enseña sin pulsar nada; con
    YouTube limitando, lo dicen y «Reintentar» las trae.
