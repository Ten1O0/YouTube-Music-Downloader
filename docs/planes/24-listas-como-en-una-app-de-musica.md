# 24 — Las listas, como en una app de música

**Estado:** pendiente · **Prioridad:** 🟠 Medio · **Depende de:** 23 (el componente de ventana y el selector de canciones)

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
  el aviso de siempre. Cuentan para el tope de 100 por hora.
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

Cómo lo pidió el usuario: un aviso de **4 segundos** con «Deshacer» tras borrar
algo, para echarse atrás si fue sin querer.

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
  aviso se puede quitar deslizándolo, y con lector de pantalla se anuncia y
  «Deshacer» recibe el foco.

### P10 · Gestos de deslizar

Lo que hay hoy: en la **biblioteca**, deslizar una fila **a la derecha** la pone
«Siguiente» en la cola (plan 09). En las listas no hay gestos.

- **En las filas de una lista:** a la derecha, «Siguiente» en la cola, igual que
  en la biblioteca. **A la izquierda, quitar de la lista**, con deshacer (P9).
- **En la biblioteca:** a la izquierda, «Añadir a playlist» (abre la ventana del
  plan 23). Borrar con un gesto sería demasiado fácil de hacer sin querer, incluso
  con deshacer.
- Mismo umbral, mismo muelle y el mismo aviso háptico que el gesto actual, y
  también con ratón.

*Pendiente de confirmar con el usuario:* el gesto a la izquierda en la biblioteca.

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
6. **T6 · Tests:**
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
