# 23 — Las listas y las ventanas, al nivel del resto de la app

**Estado:** hecho · sin desplegar · **Prioridad:** 🟠 Medio · **Depende de:** 21 (hecho)

> El reproductor, la radio, Ajustes y las hojas nuevas siguen un mismo diseño:
> cristal, muelles, botones dorados y filas con carátula. Las ventanas de las
> listas vienen de la primera versión y se nota: pequeñas, con casillas del
> navegador, sin portadas y con estilos escritos en el propio HTML. Este plan
> las rehace con el diseño actual, en ordenador, tableta y móvil, y ordena las
> listas como la biblioteca, con su duración. Las mejoras inspiradas en otras
> apps de música van en el plan 24.

---

## 1. Auditoría (2026-10-09)

Se abrieron las 16 ventanas de la app, en ordenador (1440×900) y en móvil
(390×844), con la biblioteca de ejemplo del README.

| id | Ventana | Qué falla |
|----|---------|-----------|
| D1 | **Nueva playlist** (`#createPlaylistModal`) | En el ordenador mide 380 px y la lista de canciones, 200 px de alto: caben cuatro. Casillas nativas del navegador. Sin buscador. Obliga a elegir al menos una canción (Spotify y Apple Music dejan crearla vacía) |
| D2 | **Añadir a playlist** (`#addToPlaylistModal`) | 400 px y solo texto: las listas no se distinguen sin su portada. Muestra el número de canciones y nada más. Sin buscador, y con muchas listas se hace larga |
| D3 | **Nueva playlist desde «Añadir a playlist»** (`#createNewPlaylistModal`) | Es una segunda ventana para lo mismo que D1, con otro diseño («Cancelar / Aceptar»). En el móvil se apila encima de la anterior: dos hojas, una sobre otra |
| D4 | **Elegir canciones** | Tres diseños distintos para lo mismo: casillas nativas (D1), círculo con ✓ («Añadir a playlist» desde una lista, que es el mejor de los tres) y casillas en la selección de una playlist de YouTube |
| D5 | **Editar playlist** (`#editPlaylistModal`) | Pequeña, sin la portada, y con estilos en el propio HTML |
| D6 | **Importar lista** | El selector de fichero es el nativo del navegador («Choose File · No file chosen»), en inglés aunque la app esté en castellano |
| D7 | **Vista de una lista** | La cabecera no tiene portada, no dice cuánto dura y lleva siete botones del mismo peso. En el móvil ocupan tres filas antes de la primera canción |
| D8 | **Orden de una lista** | En la biblioteca, lo descargado va primero y lo de la nube después. En las listas, mezclado |
| D9 | **«Tus datos»** | Sale literalmente «Tu {anio} en música»: el texto tiene un hueco para el año que nadie rellena (`index.html`, `data-i18n` sin parámetro) |
| D10 | **Editar canción** (móvil) | El botón «Guardar» va con borde en vez del dorado de los demás botones principales |
| D11 | **Estilos en el HTML** | Las ventanas antiguas fijan ancho, alto, márgenes y colores con `style="…"`. No se adaptan a la tableta ni se pueden cambiar desde el CSS |

Están bien y no se tocan, salvo para heredar el componente común: Ajustes,
Opciones de la canción, Atajos de teclado, App para Android, Borrar playlist
(confirmación) y la cola.

---

## 2. Lo que pide el usuario

### 2.1 Las ventanas, rediseñadas (D1-D6, D10, D11)

**Un único componente de ventana**, con tres tamaños:

| | Móvil (< 640 px) | Tableta (640-1024 px) | Ordenador |
|---|---|---|---|
| Pequeña (confirmar, editar) | Hoja desde abajo | Ventana de 440 px | 440 px |
| Media (añadir a playlist, importar) | Hoja desde abajo, hasta el 92 % del alto | 560 px | 560 px |
| Grande (nueva playlist, elegir canciones) | Hoja a pantalla casi completa | 720 px, 85 % del alto | 720 px, 85 % del alto |

Cabecera fija (título, subtítulo, cerrar), contenido con scroll y pie fijo con
los botones. Todo en clases de CSS: ningún `style="…"` en las ventanas.

**Un único selector de canciones**, para crear una lista, añadir canciones a una
lista y elegir de una playlist de YouTube:

- Filas con carátula, título, artista y duración, de la altura de las de la biblioteca.
- La selección se marca con un círculo dorado con ✓ que entra con un muelle,
  no con una casilla.
- Buscador arriba, y «Seleccionar todo / ninguna».
- Pie fijo con el recuento («3 seleccionadas · 12 min») y el botón principal.
- En el ordenador, con teclado: flechas para moverse, espacio para marcar.

**Nueva playlist (D1 + D3, una sola ventana):**

- Nombre y, opcional, descripción.
- Las canciones son **opcionales**: «Crear» con o sin canciones.
- Mientras eliges, la portada se compone sola en vivo con las carátulas de las
  cuatro primeras, igual que en la tarjeta de la lista.
- Desde «Añadir a playlist», «Nueva playlist» se abre **dentro de la misma
  ventana**, no encima, y la canción queda ya elegida.

**Añadir a playlist (D2):**

- Cada lista con **su portada** (el mosaico), nombre, canciones y duración.
- Las que ya tienen la canción, marcadas («Ya está»). Tocar una añade o quita al
  momento, con aviso y «Deshacer».
- Buscador si hay más de seis listas. Las usadas hace poco, arriba.

**Importar (D6):** una zona para soltar el fichero («Arrastra tu CSV aquí o
elige uno»), traducida y con el nombre del fichero elegido.

### 2.2 La vista de una lista (D8)

- **Primero lo descargado y después lo de la nube**, como en la biblioteca y con
  la misma función (`descargadasPrimero`). Cada grupo conserva el orden
  personalizado. Lo de la nube lleva su icono ☁ y algo menos de opacidad, como ya hace.
- **La duración total** de lo descargado, junto al número de canciones:
  «12 canciones · 47 min», o «· 1 h 12 min» si pasa de la hora. Si hay
  canciones en la nube, se dice aparte: «12 canciones · 47 min · 3 en la nube».

**Decisión pendiente (ordenar):** al reordenar a mano, ¿se mueven las canciones
dentro de su grupo, o se enseña la lista en su orden real, mezclada, solo
mientras se ordena? Propuesta: **dentro de su grupo**, que es lo que se ve.

---

## 3. Lo que no entra aquí

Las mejoras propuestas a partir de Spotify y Apple Music que eligió el usuario
(portada grande, menú ⋮ en la lista, «Descargar las que faltan»,
recomendadas, deshacer, selección múltiple…) van en el
[plan 24](24-listas-como-en-una-app-de-musica.md), que se apoya en los
componentes de este.

---

## 4. Tareas

1. **T1 · Componente de ventana y de selector** (CSS y `ui/`): tamaños, cabecera,
   pie y scroll; selector de canciones con el círculo dorado y el muelle. Tests
   de estructura: ninguna ventana con `style=` en `index.html`.
2. **T2 · Nueva playlist y Añadir a playlist**, sobre los componentes (D1-D3).
3. **T3 · Editar playlist, Importar y la selección de YouTube** (D4-D6), y el
   botón de Editar canción (D10).
4. **T4 · La vista de una lista**: orden con lo descargado primero y duración
   total (D8). El rediseño de la cabecera y de los botones (D7) es del plan 24.
5. **T5 · «Tus datos»** (D9): el año en su sitio, y un test que falle si un
   texto con hueco se pinta sin rellenar.
6. **T6 · Tests:**
   - Recorridos E2E de crear una lista vacía, crear con canciones, añadir y quitar desde «Añadir a playlist», el orden con nube y la duración.
   - Capturas de estética nuevas en móvil, tableta (820×1180) y ordenador.
   - Las animaciones respetan «Reducir movimiento».
7. **T7 · Registro**: capturas antes y después de cada ventana.

## 5. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Cambiar ventanas que usan muchos recorridos E2E | Se conservan los `id` de los elementos. La E2E completa, en verde antes de dar por buena cada tarea |
| Ordenar con nube y orden personalizado a la vez | La decisión de §2.2, con su recorrido |
| Peso del arranque (presupuesto del plan 19) | Las ventanas nuevas se cargan al primer uso, como Opciones de la canción |
| Diferencias visuales sin querer en lo que no se toca | Las capturas de estética de las ventanas que ya están bien deben seguir iguales |

---

## 7. Registro

### Sesión A: T1, T2 y la estética (2026-10-09 y 10)

**T1 · El componente de ventana** (`ui/ventana.css`):
- `.ventana` con tres tamaños: `--s` de 440 px, `--m` de 560 px y `--l` de 720 px y el
  85 % del alto. Cabecera y pie fijos, y solo el cuerpo con scroll.
- Botones `.boton--principal` y `--secundario`, y campos `.campo`.
- Conserva `auth-modal`, así que `sheets.js` sigue apilando, cerrando con Escape y
  arrastrando sin cambios.
- Corte del móvil: 768 px, como el resto de hojas de la app, y no 640 como decía §2.1.
  Así no hay dos criterios: de 768 para arriba, ventana centrada.

**T1 · El selector de canciones** (`ui/selector.js`), uno para las tres selecciones:
- Filas con carátula, título, artista y duración, y el círculo dorado con muelle.
- Buscador sin tildes ni mayúsculas, y «Seleccionar todo / Quitar todo» sobre lo filtrado.
- Pie «3 seleccionadas · 12 min», y teclado (flechas, Inicio, Fin, espacio).
- `textoBuscar` y `extra` (botones propios por fila) para la selección de YouTube.
- Se carga con `import()` al abrir la primera ventana que lo usa.

**T1 · `core/duracion.js`:** «3:05» y «47 min / 1 h 12 min / 2 h», compartido con
la cabecera de la lista de la sesión B.

**T2 · Las ventanas de las listas:**
- «Nueva playlist» (`crear.js`): nombre, descripción opcional y canciones opcionales,
  con la portada componiéndose en vivo.
- «Añadir a playlist» (`add-sheet.js`):
  - cada lista con su portada, «N canciones · X min» y su marca;
  - tocar añade o quita al momento;
  - las usadas hace poco, arriba, y buscador con más de seis listas;
  - la lista nueva se crea en la misma ventana. Desaparece `#createNewPlaylistModal`,
    que en el móvil se apilaba encima.
- «Añadir canciones» desde una lista: el selector, ya marcado con lo que tiene.

**Lo encontrado por el camino:**
- **El rectángulo detrás del buscador**, señalado por el usuario. Primero la barra
  era *sticky* con fondo opaco para tapar las filas. Pero el panel es de cristal
  translúcido y ningún color casa con él: en reposo se veía un recuadro, y pegada,
  una franja. Ahora, dentro de una ventana, la barra está quieta y sin fondo, y solo
  la lista hace scroll por debajo. Si la ventana es tan baja que la lista no cabe ni
  con su mínimo, vuelve a desplazarse el cuerpo entero.
- **El presupuesto de arranque del plan 19** se pasó dos veces:
  - el JS, por el selector y la hoja «Añadir a playlist», que ahora se cargan al abrirlos;
  - el CSS, que llegó a 143 KB de 140. Se arregló quitando de `styles.css` las
    reglas de las ventanas antiguas que ya no existen. Las de `:is(…)` se recortan
    dentro del paréntesis.
- **Los teclados de Android:** el buscador del selector lleva los atributos
  (`autocorrect`, `autocapitalize`, `spellcheck` y `enterkeyhint`) que antes llevaba
  `#plSearchInput`. `test_detalles` los comprueba ahora en el selector.
- **Un `display` propio le ganaba a `[hidden]`:** el botón «Nueva playlist» seguía
  a la vista con el formulario abierto. Dentro de una ventana, `[hidden]` gana siempre.
- **«Tus datos»** pasa a enseñar el año, así que su captura lo enmascara: si no,
  dejaría de coincidir el 1 de enero.

**Tests:**
- Recorridos 5 y 22 adaptados, y el 99 nuevo: «Nueva playlist» vacía y con buscador,
  con descripción, portada en vivo y teclado.
- Estética: «nueva lista», «añadir a lista» y «añadir canciones» en móvil y
  escritorio, y un apartado nuevo de **tableta** (820×1180).

**Tras la prueba del usuario en local (2026-10-10):**
- **Esquinas dobles** en las ventanas y el minirreproductor: `corner-shape:
  squircle` redondeaba el borde, pero el desenfoque del cristal, el filo de luz y
  las sombras seguían la esquina normal. Se quita en toda la app, y `test_forma`
  lo prohíbe.
- **Nombre repetido** en «Nueva playlist» y en «Añadir a playlist»: el aviso iba a
  Inicio, detrás de la ventana. Ahora va bajo el campo (`errorDeCampo`), con
  `role="alert"`, y se quita al escribir.
- **Letras:**
  - las marcas por palabra del «LRC mejorado» se quitan también al leer la letra
    (`parseLRC`);
  - todas las líneas menos la activa van desenfocadas, y al hacer scroll se ven
    nítidas cinco segundos;
  - en el ordenador, la letra ocupa todo el alto.
- **Dos botones de importar con el mismo icono** (audio a la biblioteca y listas):
  el de la biblioteca lleva ahora uno de fichero de música, y `test_detalles`
  comprueba que no coinciden.
- **Borrar una lista** (recorridos 103 y 104):
  - la tarjeta seguía en la rejilla: `renderGrid` no repintaba si Listas estaba
    oculta, y con la transición lo sigue cuando llega `'vista-cambiada'`. Ahora
    mira la vista de la navegación;
  - a veces había que borrarla varias veces: contar dos pasos atrás dejaba en el
    detalle de la lista borrada si había una entrada de más en el historial.
    `NavigationModule.salirDelDetalle()` va atrás hasta dejar atrás las capas y el
    detalle, cuantas sean;
  - la entrada de más venía de `currentPlaylistId`: solo se borraba con la flecha
    del detalle, y los refrescos (sincronizar, editar una canción, un corazón)
    volvían a abrir la lista desde otra vista. Ahora se borra al salir del detalle
    por cualquier camino (sesión B);
  - el botón de confirmar se desactiva al pulsarlo, y un aviso flotante dice
    «Playlist «X» eliminada» desde cualquier vista. El «Deshacer» es del plan 24
    (P9).

### Sesión B: T4, T5, D5, D6 y D10 (2026-10-09 y 10)

*(hecho)*

- **T5 · «Tus datos» (D9).** Salía «Tu {anio} en música»: con solo
  `data-i18n`, el cambio de idioma pintaba el texto sin rellenar. Ahora el año
  en curso se pone con `traducirCon(el, clave, params)` (nuevo en
  `language-manager.js`), que guarda los valores en `data-i18n-params`. Un test
  de `test_textos_fijos.mjs` falla si un `data-i18n` con huecos no tiene
  valores. Encontró otro: «Descargar {format}», que ahora lleva los suyos.
- **D10 · Guardar de «Editar canción», dorado.** En el móvil se quedaba con
  borde por el `:hover` pegado tras tocarlo; se anula con `@media (hover: none)`.
- **D6 · La zona del CSV en Importar.** En lugar de «Choose File · No file
  chosen» (en inglés siempre): una zona que se toca o sobre la que se suelta el
  fichero y que enseña su nombre (`import/zona.js`). Por dentro sigue el mismo
  `<input type="file">`. Icono nuevo `upload_file` en la fuente.
- **T4 · La vista de una lista (D8).** `playlists/orden.js`:
  - Lo descargado primero y lo de la nube después, cada grupo en su orden
    (`ordenDeVista`). El orden guardado no cambia.
  - Se reproduce en el orden en que se ve.
  - Cabecera «12 canciones · 47 min · 3 en la nube» (`textoDeLista`). La
    duración solo cuenta lo descargado.
  - **Reordenar: dentro de su grupo. PENDIENTE DE CONFIRMAR por el usuario.**
    `moverEnGrupo` mueve la canción dentro de los huecos de su grupo en el orden
    guardado. Así, una de la nube que se descarga vuelve a donde la puso el
    usuario. Si se suelta en el otro grupo, va al extremo del suyo.
  - Las listas vacías se quedan: ya no se borran al quitarles la última
    canción. Fuera `handleDeleteEmptyPlaylist` y la clave `pl_auto_deleted`.
  - «Favoritos» traducido en la rejilla y en el detalle. Sigue fijo en
    `favorites/store.js`, que no es de este plan.
  - `createPlaylist` acepta la descripción y devuelve el `id` (para la T2 de A).
    Sus errores, antes fijos en castellano, ya salen traducidos.
- **D5 · Editar playlist.** La ventana común, sin `style=`, con la portada
  (`portadaDeLista`) y el resumen de la lista bajo el título. Guardar se apaga
  sin nombre, y un nombre que ya tiene otra lista se dice en lugar de guardarse.
- **D4/D5 · Elegir de una playlist de YouTube.**
  - El selector común (`crearSelectorCanciones`, cargado al usarlo), con buscador
    y «Seleccionar todo / ninguna» en lugar de los dos botones de antes.
  - Escuchar antes y el corazón siguen en cada fila, con la opción `extra` del
    selector. Tocarlos no marca ni desmarca la fila.
  - Su buscador dice «Buscar en esta playlist…» (`textoBuscar`), no «en tu
    biblioteca».
  - Como en las ventanas, la barra queda quieta y solo desplaza la lista
    (`.yt-seleccion`, en `listas.css`).
  - En el móvil, sin la duración y con los botones algo menores: si no, el título
    se quedaba en «C…».
  - Fuera de `styles.css` los estilos de `.playlist-list`, `.playlist-item` y sus
    hijos. `.playlist-checkbox` se queda, porque la usa Favoritos.
- **«1 canciones» en Importar.** Venía de antes de este plan: la vista previa y
  el resumen usaban un plural fijo. Ahora usan `contarCanciones`, y las claves
  `import_preview` e `import_summary_total` desaparecen. Quedan con plural fijo
  «Importando {total} canciones» y «Descargando {n} canciones…», que no son de
  este plan.
- **Tras la prueba del usuario en local (2026-10-10).**
  - La cabecera decía «5 canciones», sin duración: esas canciones son de
    antes del plan 22, que no la guardaba. Además, sin cuenta, las copias de
    las listas no se ponen al día con la biblioteca. `library/duraciones.js`
    la lee de los metadatos de su audio, en segundo plano como la sonoridad, y
    guarda la de lo que suene sin ella. La escribe en la biblioteca y en las
    copias, y repinta la cabecera abierta. Se carga aparte, con `import()`.
  - Letras: al pasar una sincronizada a simple (`elegir.js`), también se quitan
    las marcas por palabra del «LRC mejorado» (`<00:20.05>es <00:20.31>que`),
    como en «TU OLVIDO» de KAZE.
  - «Editar playlist»: el nombre repetido se dice bajo el campo (`errorDeCampo`
    de A), no con un aviso que quedaba detrás de la ventana.
- **Tests.**
  - `test_orden_listas.mjs` (9).
  - El de textos con huecos.
  - Recorrido 98: el orden con nube, la cabecera y la lista que se queda vacía.
  - Recorrido 100: la selección de YouTube (el corazón no marca la fila y
    buscar no pierde la selección). 22 y 41 adaptados.
  - Capturas `{móvil, tableta, escritorio}-editar-lista` e `-importar`.
  - `test_relleno_duracion.mjs` (3), el caso del «LRC mejorado» en
    `test_letras.mjs` y el recorrido 102 (una canción sin duración: la cabecera
    dice «1 canción» y se completa sola).
  - En verde: la suite del cliente, eslint y los recorridos 22, 41-45, 47, 98 y 100.
