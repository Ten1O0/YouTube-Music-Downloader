# 29 — Escuchar desde la nube, y que lo tuyo sea tuyo

**Estado:** hecho · sin desplegar · planeado con el usuario el 2026-10-25, hecho el mismo día en paralelo por dos sesiones · **Prioridad:** 🟡 Medio · **Depende de:** 13 (canciones en la nube), 15 (importar listas), 16 (modo radio), 26 (lista al descargar)

> El usuario (2026-10-25): al importar un mix o una lista, las canciones que no
> se descargan se quedan en la nube y no se pueden escuchar. Quiere que suenen
> «de la misma manera que funciona la radio», en tres casos: listas con todo
> descargado (sin cambios), listas mezcladas (primero lo descargado, después lo
> de la nube) y listas solo de nube (con una animación de carga, porque no puede
> ser instantáneo). Y a la vez quiere que la radio y la nube sean «algo puntual y
> no la norma»: gastan recursos de su servidor, y si un día deja de funcionar,
> solo queda lo descargado. «Si se descarga esa canción, los datos sí que son
> suyos.» Hay que animar al usuario a descargar lo que le gusta, sin agobiarle.

---

## 1. Lo que hay

- **Canciones en la nube.** Vienen de la cuenta (plan 13: `nube://<videoId>`,
  sin audio aquí) o de una lista importada (plan 15: `crearListaImportada` crea
  la lista al momento con lo que falta «en la nube», también sin cuenta). Al
  pulsar una, el reproductor no la reproduce: pide descargarla
  (`alPedirNube`, `player.js`). La cola las quita: nunca suenan solas.
- **La radio** (plan 16) ya reproduce canciones que no están en la biblioteca:
  las descarga en silencio por el camino de siempre a una caché temporal
  (`radio/cache.js`: como mucho 10 canciones o 150 MB; nunca suelta la que
  suena) y mantiene una ventana de 3 preparadas por delante (6 si se salta
  deprisa). Respeta «Radio solo con Wi-Fi», y «Guardar» la lleva a la
  biblioteca sin volver a descargarla.
- **Las listas** ya ordenan lo descargado primero y lo de la nube después
  (`playlists/orden.js`), y tienen «Descargar las que faltan».
- **Al pegar una lista de YouTube**, el selector descarga las elegidas y, con el
  interruptor del plan 26, crea a la vez una lista propia.
- **Los avisos** de hoy (`ui/toast.js`) no llevan botón; el de deshacer
  (`ui/deshacer.js`) sí.

## 2. Decisiones del usuario (2026-10-25)

- **Aleatorio:** primero suenan las descargadas, barajadas entre sí, y después
  las de la nube, barajadas entre sí.
- **Las escuchadas desde la nube** se quedan en la caché temporal, con
  «Guardar», como en la radio. Nada se guarda solo.
- **Datos móviles:** el mismo ajuste que la radio («solo con Wi-Fi»).
- **Recordatorio para guardar:** a las 3 escuchas enteras de una canción que
  suena desde la nube.
- **Favorito:** dar a favorito una canción desde la nube ofrece guardarla; no la
  guarda sin preguntar.
- **Frecuencia:** como mucho 1 o 2 recordatorios al día. Se fija en 2.
- **Palabras:** en la interfaz no se dice «el servidor», que no todo el mundo
  entiende, sino **«la nube»**: «suena desde la nube», «dependen de la nube».
  Encaja con «en la nube», que la app ya usa para las canciones sin descargar.

## 3. Qué se hace

### T0 · Medir y comprobar antes de empezar

- En el Vivo (por USB, como en el plan 28): cuánto tarda hoy en sonar una
  canción de la radio que no estaba preparada, con Wi-Fi y con datos. Es la
  espera que tendrá la primera canción de una lista solo de nube.
- Comprobar que las canciones en la nube sin cuenta (las de una lista
  importada) se comportan bien en todas partes: la lista, la cola, «Descargar
  las que faltan», la sincronización al iniciar sesión después.

### T1 · Las canciones de la nube suenan

- El reproductor deja de saltarlas y de pedir su descarga: si una canción no
  tiene audio aquí, la prepara en la caché temporal de la radio (el mismo
  camino: descarga en silencio y `guardarEnCache`) y suena desde ahí.
- **Preparar por delante:** mientras suena una canción, se preparan las 2 o 3
  siguientes de la cola que estén en la nube, como la ventana de la radio. Nunca
  la lista entera.
- La caché es la de la radio, compartida: nunca suelta la que suena ni las
  preparadas por delante.
- **Si no se puede** (sin conexión, «solo con Wi-Fi» con datos, falla la
  descarga): se salta con un aviso claro y sigue la siguiente; no se para todo.
- **Guardar:** el mismo de la radio, en la fila, en el mini reproductor y en la
  pantalla completa.
- Pulsar una canción de la nube la reproduce. Descargarla sigue a mano: en el
  menú de la canción y en «Descargar las que faltan».

### T2 · El orden y los modos

- **Normal:** el orden de la lista (lo descargado ya va primero).
- **Aleatorio:** barajar las descargadas, y después las de la nube (decisión del
  usuario): empieza siempre al instante y da tiempo a preparar lo demás.
- **Repetir todo:** incluye las de la nube; si la caché ya soltó alguna, se
  vuelve a preparar. **Repetir una:** igual que hoy.
- **Al acabar la lista:** la radio, si está activada, como hoy.

### T3 · Mientras se prepara

- **Lista solo de nube:** en su cabecera, «Preparando la primera canción…» con
  una barra de progreso, al pulsar Reproducir.
- **Mini reproductor:** una animación en el botón de reproducir mientras llega
  la canción, también si la siguiente no está lista cuando acaba la actual
  (nunca un silencio sin explicación).
- **Filas:** una marca discreta en las de la nube cuando ya están preparadas y
  sonarán al momento.

### T4 · Importar sin descargar

- En el selector de una lista o un mix de YouTube, junto al interruptor del
  plan 26: «Crear solo la lista, sin descargar». La lista se crea al momento con
  todas sus canciones en la nube (`crearListaImportada` sin el lote) y se
  escucha así, o se descarga después con «Descargar las que faltan».
- Funciona sin cuenta (lo comprueba la T0).

### T5 · «Tu música, de verdad tuya»: explicarlo una vez

La primera vez que se enciende la radio o suena una canción desde la nube, una
ventana como la del aviso de actualización:

> **Tu música, de verdad tuya**
> Lo que descargas se queda en tu móvil: suena sin conexión y no depende de
> nadie. La radio y las canciones en la nube suenan desde la nube: son para
> descubrir música, y si un día la nube deja de estar, no se podrán escuchar.
> Si algo te gusta, guárdalo.
> [Entendido]

Una sola vez por dispositivo. El texto queda en Ajustes, en «Por qué
descargar», para volver a leerlo.

### T6 · Recordarlo justo cuando importa

- **A las 3 escuchas enteras** de una canción que suena desde la nube (de la
  radio o de una lista): «La has escuchado 3 veces. ¿La guardas? Así será tuya y
  sonará sin conexión», con «Guardar» (un aviso con botón, como el de deshacer).
- **Al darle a favorito** a una canción desde la nube: «¿La guardas? Así será
  tuya y sonará sin conexión», con «Guardar». No se guarda sola.
- **Al guardar:** «Guardada: ya es tuya y suena sin conexión» (en vez de
  «Guardada en tu biblioteca»).
- **Si no se puede escuchar:** «Esta canción no está descargada y ahora no se
  puede escuchar desde la nube. Las que tienes descargadas siguen sonando».
- **Límites:** como mucho 2 recordatorios de guardar al día (los dos primeros
  tipos juntos); nunca la primera vez que suena una canción; y si se descarta
  el de una canción, no se vuelve a proponer esa canción.

### T7 · Qué es tuyo y qué no, a la vista

- **Una marca «Desde la nube»** en las filas de esas canciones y en el mini
  reproductor, con «Guardar» a mano (como la marca «Radio» de hoy).
- **En una lista con canciones de la nube:** junto a «Descargar las que faltan»,
  «12 canciones suenan desde la nube».
- **Un recuento en positivo** en Ajustes (y en la biblioteca, si cabe sin
  estorbar): «230 canciones tuyas · 45 desde la nube», con «Descargar las que
  faltan».
- **Los textos** se apoyan en lo que se nota cada día (sin conexión, en el metro
  o en el avión, sin gastar datos, al instante) y dejan la propiedad como el
  porqué de fondo. Sin nombrar otras apps.

### T8 · Tests

- **Unitarios:** la ventana de preparación (cuáles prepara y cuándo, nunca más de
  3), el aleatorio en dos grupos, repetir con la caché soltada, el contador de
  escuchas enteras, los límites de los recordatorios (2 al día, nunca la
  primera vez, no repetir una descartada) y la creación sin descarga.
- **Recorridos:** una lista mezclada suena entera (descargadas y después nube);
  una solo de nube enseña la espera y suena; importar sin descargar crea la lista
  en la nube; la tercera escucha propone guardar y «Guardar» la lleva a la
  biblioteca; favorito propone guardar sin guardar; el tercer recordatorio del
  día no sale; la ventana de la T5 sale una sola vez.
- **En el Vivo:** el tiempo hasta que suena la primera canción de una lista solo
  de nube, el paso de descargadas a nube sin cortes, y con datos móviles y «solo
  con Wi-Fi».

## 4. Verificación

- Una lista mezclada suena de principio a fin sin cortes al pasar a la nube.
- Una lista solo de nube enseña que se prepara y empieza a sonar en el tiempo
  medido en la T0.
- Nunca se preparan más de 3 canciones por delante.
- Los recordatorios salen cuando tocan y nunca más de 2 al día.
- El presupuesto de arranque se mantiene: todo lo nuevo se carga aparte.

## 5. Riesgos

- **El servidor:** cada canción que suena desde la nube es una descarga completa
  en el servidor, como con la radio. La ventana corta lo acota, pero una lista
  larga solo de nube es trabajo continuo, y cuenta para el límite de YouTube y el
  de `/api/download`. Por eso la parte de animar a descargar (T5-T7) es tan
  importante como la de escuchar.
- **La espera:** la primera canción de una lista solo de nube no es instantánea.
  La T3 tiene que dejarlo claro para que no parezca un fallo.
- **La caché temporal:** con 10 canciones como mucho, en una lista larga las del
  principio se sueltan y repetirlas es volver a descargarlas. Si la T0 o la
  prueba del usuario lo piden, se sube el límite.
- **Sin conexión:** las canciones de la nube no suenan. El aviso de la T6 lo
  explica en ese momento.
- **Presupuesto de arranque:** el JS de arranque tiene muy poco margen (81 bytes
  el 2026-10-25). La reproducción desde la nube, los recordatorios y la ventana
  de la T5 tienen que cargarse aparte, como la radio.

## 6. Orden, en tres fases

```
Fase 1:  T0  →  T1 + T2 + T3 (escuchar desde la nube)  →  APK de prueba
Fase 2:  T4 (importar sin descargar)
Fase 3:  T5 + T6 + T7 (que lo tuyo sea tuyo)
T8, durante todo el plan
```

La fase 3 va en la misma versión que la 1: no se publica escuchar desde la nube
sin la parte que anima a descargar.

Estimación (2026-10-25): fase 1, unas 6–8 h; fase 2, 1–2 h; fase 3, 4–5 h; el
plan completo, 12–15 h.

## Registro · T0-T3 y su parte de la T8

Hecho el 2026-10-25 por la primera sesión, en paralelo con la que hizo T4-T7.

### T0 · Medir y comprobar

En el Vivo, con una APK de prueba (2.3.0-prueba-29-0) y el mismo camino que la
radio (pedir la descarga, esperar a que la nube la tenga y bajar el audio):

| Red | La nube la prepara | Bajar el audio | Total |
|---|---|---|---|
| Wi-Fi (3 canciones) | 14,9–15,6 s | 0,5–0,6 s | 15,4–16,2 s |
| Datos móviles (2) | 15,1–16,9 s | 1,4–1,6 s | 16,5–18,5 s |

Casi todo es el trabajo de yt-dlp en el servidor. Como cada canción dura minutos,
preparar las de 3 posiciones por delante sobra para que una lista no se corte;
la espera solo se nota en la primera de una lista solo de nube.

**Encontrado y arreglado:** una lista importada con canciones sin descargar las
perdía al sincronizar con la cuenta (pasa desde el plan 15). `materializarLista`
(`sync/fusion.js`) rehacía la lista con las canciones de la biblioteca, y las
importadas sin descargar viven solo en la lista. Ahora se queda con la copia de
este dispositivo. **Pendiente de decidir:** para que lleguen también a otros
dispositivos tendrían que entrar en la biblioteca como canciones en la nube,
igual que las de la cuenta.

### T1 · Las canciones de la nube suenan

- `nube/escuchar.js` (se carga aparte, solo si la cola tiene alguna de la nube):
  prepara cada una en la caché de la radio (`descargarEnSilencio` +
  `guardarEnCache`) y, ya preparada, la cambia en la cola por la versión con
  audio (`desdeNube`), con lo de la cuenta (nombre editado, portada…).
- Prepara solo las de las 3 posiciones siguientes (`prepararPorDelante`,
  `nube/modelo.js`), de una en una. La caché de la radio admite ahora varios
  protectores (`protegerCon`): no suelta la que suena ni las preparadas.
- Si no se puede (sin conexión, «solo con Wi-Fi» con datos, la nube no
  responde): aviso y salta; tras 3 fallos seguidos, se para.
- «Guardar» (`guardarDesdeLaNube`): de la radio, como siempre; preparada, sin
  volver a descargarla (`aBiblioteca`); aún en la nube, la descarga normal.
- El reproductor (`player.js`) deja de quitarlas de la cola y de pedir su
  descarga al pulsarlas (`configurarNube` desaparece); el puente
  (`nube/puente.js`) es lo único que queda en el arranque.
- La radio avisa de cada canción suya que empieza a sonar
  (`suena-desde-la-nube`), para la ventana y los recordatorios de la T5-T6.

### T2 · El orden y los modos

- Aleatorio: `barajar` baraja todo y después pone las descargadas delante con un
  orden estable, así que cada grupo queda barajado.
- Repetir todo: al dar la vuelta, las preparadas que la caché ya soltó vuelven a
  la nube y se preparan otra vez; si el reproductor llega a una sin audio, la
  manda preparar en vez de dar error.

### T3 · Mientras se prepara

- Un anillo que gira en los botones de reproducir (mini reproductor, pantalla
  completa y lista); el mini reproductor ya enseña la canción y lo que sonaba se
  pausa; en la lista abierta, «Preparando la primera canción…» con una barra que
  se desliza (no se sabe cuánto falta); con «Reducir movimiento», quieto.
- Las filas ya preparadas llevan un punto; la cabecera de la lista, «N canciones
  suenan desde la nube» (T7); el mini reproductor, la marca «Desde la nube» y
  «Guardar» (los de la radio, reutilizados).
- Sus estilos van como texto (`escuchar.css?inline`): importados como CSS, el
  arranque crecía con la lista de ficheros a precargar.

### El presupuesto de arranque

Con las dos sesiones, el JS de arranque llegó a pasarse 350 bytes. Se midió cada
cambio por separado: cada módulo nuevo compartido entre cargas diferidas añade
nombres de ficheros a precargar en el arranque, y eso pesaba más que el código.
Se compactó lo nuevo y se quitaron mensajes de consola de depuración del arranque
(`permissions.js`, `deep-link.js`, que además escribía la dirección del inicio
de sesión, `preview.js`, `storage.js`, `audio-store.js`, `library.js`). Queda
con 487 bytes de margen.

### Pruebas

- `test/frontend/test_nube_escuchar.mjs` (14): la lista que no pierde las de la
  nube al sincronizar, qué se prepara por delante, la preparada, el aleatorio en
  dos grupos, los enganches del reproductor, la caché con varios protectores y los
  textos.
- Recorridos 157 (lista mezclada entera, con la marca y «Guardar»), 158 (solo
  nube: la espera y suena), 159 (aleatorio: primero la descargada), 162
  («Guardar» desde el mini reproductor) y 170 (la nube no responde: aviso, sin
  dar vueltas).
- **En el Vivo** (APK 2.3.0-prueba-29-1, Wi-Fi), con canciones reales y dos
  listas de prueba que se borraron al terminar:
  - lista solo de nube: suena a los **14,5 s** de pulsar Reproducir, con
    «Preparando la primera canción…», la línea «2 canciones suenan desde la nube»,
    la marca «Desde la nube» y la ventana de la T5;
  - lista mezclada: la de la nube se prepara en 15,6–16,5 s mientras suena la
    descargada, y el paso de una a otra tarda **0,27 s**, como entre dos
    descargadas. La espera solo existe en la primera de una lista solo de nube.
  - La instalación por USB pidió en el Vivo la confirmación de «Protección de
    seguridad» (app de fuera de su tienda); se aceptó en el propio móvil.

### Al juntar las dos partes

- **La marca «Desde la nube» de una fila no hacía nada** mientras `tuyo.js` no se
  hubiera cargado (se carga en un momento de calma; en el recorrido 39 no llegó).
  Ahora la atienden la biblioteca y la lista (`guardarDesdeLaNube`), y `tuyo.js`
  ya no la atrapa. «Guardar» repinta además la lista abierta.
- Recorridos adaptados al comportamiento nuevo: 34 y 39 (tocar una canción de la
  nube ya no la descarga: suena desde la nube; se descarga con «Descargar las que
  faltan» o con su marca), 81 y 87 (el mensaje al guardar es «Guardada: ya es tuya
  y suena sin conexión») y los de la radio (la ventana de la T5, ya vista).
- Capturas de estética de Ajustes, con la sección «Tu música».

## Registro · T4-T7

Hecho el 2026-10-25 por la segunda sesión, en paralelo con la que hizo T0-T3.

### Sin coste de arranque

Al empezar, el JS de arranque tenía 81 bytes de margen. Todo lo de esta parte se
carga aparte:

- `features/nube/tuyo.js`: la ventana, los recordatorios y lo de Ajustes.
  `main.js` lo carga en reposo, en el mismo bucle que las demás cargas
  diferidas. También lo carga `nube/puente.js` (`avisarQueSuena`, de la otra
  sesión) antes de avisar de la primera canción que suena desde la nube. Al
  cargarse se queda escuchando: `suena-desde-la-nube`, los favoritos (envuelve
  `FavoritesModule.toggleFavorite`, al que todos llaman por el módulo) y la
  apertura de Ajustes (con un `MutationObserver`).
- Lo puro, aparte y con sus pruebas: `nube/recordatorios.js` (las reglas) y
  `nube/recuento.js` (el recuento).
- Los textos, en `nube/textos-tuyo.js`, en los seis idiomas. Nunca dicen «el
  servidor»: dicen «la nube».
- En el arranque quedan la marca de la fila y su clic (`library.js` y
  `playlists.js`, ver la T7) y dos cambios en `es.js` que lo **reducen**: `cloud_badge` pasa a «Desde la nube», más corto, y
  `radio_saved` se quita porque ya no la usa nadie («Guardada: ya es tuya y suena
  sin conexión» va en `textos-tuyo.js`).
- Medido con el árbol entero al terminar: JS de arranque 297.033 bytes, **margen
  439**; CSS, margen 309. Con el clic de la marca en el arranque (ver la T7), la
  otra sesión midió después un margen de 324.

### T4 · Importar sin descargar

- En el selector de una lista o un mix de YouTube, debajo de «Descargar
  seleccionadas»: **«Crear solo la lista, sin descargar»** (`#ytSoloLista`). Lo
  crea `lista-al-descargar.js`, que ya se cargaba aparte, y toma de «Descargar
  seleccionadas» si está habilitado. No sale con una lista que ya se sigue,
  como el interruptor del plan 26.
- Pasa por el mismo camino que «Descargar seleccionadas», sin tocar
  `youtube-playlist.js`: `eligeLista` y `descargarComoLista` leen una marca del
  módulo. `crearListaImportada` gana `{ descargar: false }`: la lista se crea al
  momento y lo que falta se queda en la nube. El nombre es el escrito si el
  interruptor está activado y, si no, el de la lista de YouTube. Funciona sin
  cuenta.
- **Fallo encontrado y arreglado:** «Descargar las que faltan» de una lista no
  bajaba las canciones que solo estaban en esa lista (las de una lista
  importada, desde el plan 15): `descargarVarias` (`sync/nube.js`) solo pedía
  las que estaban «en la nube» en la biblioteca. Ahora pide todas menos las ya
  descargadas, y al acabar sustituye sus copias «en la nube» en las listas
  (`sacarDeLaNubeEnListas`). Lo cubren el 163 y el 124.

### T5 · «Tu música, de verdad tuya»

- La primera vez que llega `suena-desde-la-nube` en este dispositivo, la
  ventana con el texto del plan y un solo botón, «Entendido». Es la de
  `confirmar()`, con el «no» oculto mientras dura, sin tocar `confirm.js`.
  Se apunta en `localStorage` (`nube_tuya_vista`) antes de enseñarla.
- En Ajustes, «Por qué descargar», desplegable con el mismo texto.
- Comprobado en el Vivo por la otra sesión (APK 2.3.0-prueba-29-1): sale bien
  la primera vez que suena una desde la nube en una lista solo de nube.

### T6 · Los recordatorios

- **A las 3 escuchas enteras:** al empezar a sonar desde la nube, se cuentan en
  el registro de escuchas (`leerEscuchas`) las enteras de esa canción (90 % de
  su duración; sin duración, 30 s). Con 3, propone guardarla. Sale al empezar la
  cuarta, sin ningún enganche nuevo en el reproductor.
- **Al darle a favorito** a una canción desde la nube: «¿La guardas?», sin
  guardarla sola.
- El aviso es el de `ui/deshacer.js`, con dos opciones nuevas: `boton` (su
  texto, aquí «Guardar») y `bloquear` (aquí no frena la sincronización). Por
  defecto, igual que antes. Dura 8 s. «Guardar» llama a `guardarDesdeLaNube`;
  cerrarlo, deslizarlo o dejarlo pasar lo **descarta**: esa canción no se vuelve
  a proponer. Nunca sale encima de un «Deshacer» a la vista, que se daría por
  hecho antes de tiempo.
- **Límites** (`recordatorios.js`): 2 al día, sumando los dos tipos; nunca la
  primera vez que suena una canción (se cuentan las veces que suena desde la
  nube); una descartada, nunca más.
- «Guardada: ya es tuya y suena sin conexión» y «Esta canción no está
  descargada y ahora no se puede escuchar desde la nube…» los enseña el código
  de la otra sesión, con `textoTuyo('guardada')` y `textoTuyo('noSePuede')`.

### T7 · A la vista

- **La marca «Desde la nube»** en las filas de la biblioteca y de las listas
  (las pinta `renderLibraryItem`): sustituye al icono de nube, cuyo texto
  («tócala para descargarla») dejaba de ser cierto con la T1. Es el propio botón
  de guardar: tocarla no reproduce la canción y la lleva a la biblioteca. La
  marca del mini reproductor y la línea de la cabecera son de la otra sesión.
- **Su clic, en el arranque.** Al principio lo atendía `tuyo.js` en el
  documento, para no gastar bytes; el recorrido 39 descubrió que, si `tuyo.js`
  aún no se había cargado (se carga en un momento de calma), tocar la marca no
  hacía nada. La otra sesión lo pasó a la delegación de clics de `library.js` y
  de `playlists.js`, que llaman a `guardarDesdeLaNube`; «Guardar» repinta
  además la lista abierta, porque la fila se quedaba con la marca.
- **En Ajustes, «Tu música»**, delante de «Reproducción»: «230 canciones tuyas
  · 45 desde la nube» (sin repetir las que están en la biblioteca y en una
  lista), una frase con lo que se nota cada día (sin conexión, en el metro o en
  el avión, sin gastar datos, al instante), «Descargar las N que faltan» y «Por
  qué descargar».
- El recuento **en la biblioteca** no se ha puesto: la barra «Descargar las que
  faltan (N)» ya está ahí y no cabía sin estorbar.

### Pruebas

- `test/frontend/test_nube_tuyo.mjs` (16):
  - textos en los seis idiomas, sin «servidor», con los del plan al pie de la letra;
  - las reglas de los recordatorios (2 al día y el reinicio al día siguiente,
    nunca la primera vez, una descartada no vuelve, escuchas enteras);
  - el recuento sin repetir;
  - la T4;
  - que nada del arranque importe estos módulos sin `import()`.
- Recorridos:
  - 163: importar sin descargar, sin cuenta y sin ninguna descarga; después,
    «Descargar las que faltan» las baja;
  - 164: la ventana, una sola vez, también al volver a abrir; «Por qué
    descargar» en Ajustes;
  - 165: 3 escuchas enteras; nada la primera vez; «Guardar» la lleva a la
    biblioteca;
  - 166: favorito propone sin guardar; descartada, no vuelve;
  - 167: el tercer recordatorio del día no sale;
  - 168: la marca de la fila guarda sin reproducir;
  - 169: el recuento de Ajustes y «Descargar las que faltan».
- En verde: 163-169 y los de listas, importar, la nube, la cuenta y los
  favoritos (22, 28, 46, 98, 99, 104, 122, 124, 128, 141 y 30 más). El **34**
  («tocarla la descarga») se adaptó: con la T1, tocar una canción de la nube ya
  no la descarga, la reproduce desde la nube, y se baja con «Descargar las que
  faltan».

### Dudas para el usuario (resueltas el 2026-10-26)

- **Favorito en la primera escucha: sí propone guardarla.** Darle a favorito
  es decir «me gusta», así que no hace falta esperar a la segunda escucha.
  `puedeRecordar` acepta `aunqueSeaLaPrimera` (solo lo pasa `alDarFavorito`).
  Las otras reglas siguen igual: como mucho 2 recordatorios al día, y una
  canción descartada no se vuelve a proponer.
- **El recuento también en la biblioteca:** «9 canciones · 3 desde la nube»,
  junto a la cuenta de siempre y en la misma línea. Cuenta también las
  canciones que solo están en una lista. La pinta `pintarEnBiblioteca`
  (tuyo.js) al pintarse la biblioteca y al entrar en ella. Si no hay nada en
  la nube, no sale. Una copia «en la nube» de una lista cuya canción ya está
  descargada cuenta como tuya: las listas se ponen al día un momento después
  que la biblioteca.
