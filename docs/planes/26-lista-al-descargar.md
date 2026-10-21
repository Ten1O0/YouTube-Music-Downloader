# 26 — Crear una lista al descargar una lista de YouTube

**Estado:** hecho · sin desplegar · aprobado por el usuario el 2026-10-21 · **Prioridad:** 🟢 Bajo · **Depende de:** 15 (importar listas), 20 (lotes)

> El usuario (2026-10-21): al descargar varias canciones de una lista de YouTube
> desde el buscador, quiere poder crear directamente una lista propia con todas
> ellas. Prefiere un interruptor en la propia pantalla antes que en Ajustes.

---

## 1. Lo que hay

- Al pegar una lista de YouTube (o una mezcla) se abre el selector: se eligen
  canciones y «Descargar seleccionadas» las baja en un lote (plan 20). Entran en
  la biblioteca, pero en ninguna lista.
- «Seguir esta lista» (plan 14) ya crea una lista vinculada que va recibiendo lo
  que se añade en YouTube. No sirve para las mezclas, y es otra cosa: seguir, no
  copiar una vez.
- Importar un CSV (plan 15) ya hace lo que se pide aquí: `crearListaImportada`
  crea la lista al momento (lo que ya está en la biblioteca entra tal cual, lo
  demás «en la nube») y después descarga; cada canción que llega sustituye a su
  copia «en la nube», y lo que falla se queda en la lista para bajarlo después.

## 2. Qué se hace

- **T1 · El interruptor.** En el selector, encima de «Descargar seleccionadas»:
  «Crear una lista con estas canciones», con el nombre ya puesto (el título de la
  lista de YouTube) y editable. Activado la primera vez; después recuerda la
  última elección en ese dispositivo. No sale si esa lista de YouTube ya se sigue
  (ya tiene su lista vinculada), y no cuenta para «Descargar como ZIP».
- **T2 · Crear y descargar.** Con el interruptor activado, las seleccionadas pasan
  por `crearListaImportada` (cargada aparte, como la importación): la lista se
  crea al pulsar, con un nombre que no choca con los que hay, y la descarga es el
  mismo lote de siempre, con su aviso y su final.
- **T3 · Pruebas.** Un recorrido: con el interruptor, la lista aparece con sus
  canciones; sin él, no; y recuerda la elección.

## 3. Registro

**2026-10-21 · hecho.**

- `features/lista-al-descargar.js` (nuevo, se carga al abrir una lista de
  YouTube): pinta el interruptor (activado la primera vez, luego la última
  elección en `localStorage`), lo esconde si esa lista ya se sigue, y crea la
  lista con `crearListaImportada`.
- `crearListaImportada` devuelve además `descarga`, la promesa del lote, para que
  el selector dé el aviso final de siempre (las que fallaron, o la celebración).
  La importación de CSV no cambia.
- `youtube-playlist.js`: el aviso final se comparte (`avisarFinal`) entre el lote
  normal y el de la lista. Con el interruptor activado, también una sola canción
  va como lista.
- Interfaz: el interruptor de Ajustes reutilizado, y un campo para el nombre con
  el estilo del buscador. Textos en los seis idiomas.
- Recorrido 141.

**Lo que salió por el camino.**
- El presupuesto de arranque se pasaba (291 KB de 290) importando `seguidas.js`
  solo para leer el id de la lista: por eso la pieza va aparte.
- El arreglo de la CI del 16/10 (`zip(..., strict=False)`) rompía los
  recorridos con Python 3.9, que es el `.venv` de este Mac (la CI usa 3.12):
  `strict` solo existe desde la 3.10. Se cambia por `zip_longest`, que da la
  misma mezcla y funciona en todas.
- En este terminal, fnm pone Node 20 por defecto (el proyecto pide 22+): con él,
  `test_latido` falla porque Node 20 no tiene `navigator` global. Con Node 26
  (Homebrew) todo pasa.
- Tanda E2E: 137 de 139. Fallaron una vez el 36 (ejecutado solo pasa 2 de 2) y la captura de estética
  «selección múltiple y deshacer» del móvil, que falla 1 de cada 2: la página sale
  más o menos desplazada según cuándo llegan las recomendaciones. No tiene que
  ver con este plan; queda pendiente.
