# 23 — Las listas y las ventanas, al nivel del resto de la app

**Estado:** pendiente · **Prioridad:** 🟠 Medio · **Depende de:** 21 (hecho)

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
