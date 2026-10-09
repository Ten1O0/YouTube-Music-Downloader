# 22 — Letras: encontrar la buena, también cuando el título viene mal

**Estado:** pendiente · **Prioridad:** 🟠 Medio · **Depende de:** 16 (radio), 11 (editor de canciones)

> Canciones conocidas se quedan sin letra. Las letras salen de LRCLIB
> (lrclib.net), una base de datos abierta y gratuita. Casi siempre la tiene:
> el fallo está en cómo se le pregunta y en cómo se elige la respuesta.

---

## 1. Qué hay que resolver

Medido el 2026-10-08 contra LRCLIB, con la búsqueda de hoy (`lyrics.js`).

| id | Qué | Dónde | Efecto hoy |
|----|-----|-------|------------|
| D1 | Las canciones de la radio no separan artista y título: si YouTube no los da aparte, el título se queda entero («Ariana Grande – hate that i made you love me») | `radio/cache-modelo.js` (`cancionDeRadio`) y `radio/pick.js` (`elegir`) no pasan por `completarMetadatos`, la biblioteca sí | El artista sale repetido en el título, en el reproductor y en la cola, y es lo que se manda a LRCLIB |
| D2 | LRCLIB va justo de capacidad y a veces responde **503 «servidor ocupado, reintenta»** (en las pruebas, 2 de 3 consultas seguidas). La app lo toma por «no hay letra» | `fetchLyrics`: `if (!response.ok) return null` | Sin letra hasta que cambia la canción. Es lo más probable en el ejemplo del usuario: LRCLIB tiene esa canción, sincronizada y con su duración exacta |
| D3 | Una sola búsqueda (título + artista). Si el artista es el canal que subió el vídeo («Letras Latinas», «Lyrics Channel»), no hay plan B | `fetchLyrics` | En 16 casos realistas encuentra 11. «Hijo de la luna», «Entre dos tierras» o «Bohemian Rhapsody» se quedan sin letra |
| D4 | Se coge el primer resultado con letra, sin comprobar que sea la misma canción ni la misma versión | `fetchLyrics` | De la misma canción hay versiones de 164, 198 y 300 s. Con una búsqueda más suelta, «Gasolina» de otro artista o una entrada basura pasarían por buenas, y la letra sincronizada iría desacompasada |
| D5 | Al corregir artista o título en el editor, la letra no se vuelve a buscar | `player.js` (`actualizarCancion` repinta el nombre, no la letra) | El editor no sirve para arreglar una letra que no sale |
| D6 | La limpieza propia de `lyrics.js` (una expresión regular solo en inglés) repite peor lo que ya hace `core/titles.js` | `fetchLyrics` | Dos limpiezas que no coinciden |

---

## 2. Decisiones (tomadas con el usuario, 2026-10-08)

### 2.1 Qué se hace

Las ideas 1, 2 y 4 de la propuesta: **búsquedas en cascada**, **comprobar que
es la misma canción** y **volver a buscar al editar**.

### 2.2 Qué no se hace

**No se guarda ninguna letra**, ni en el dispositivo ni en el servidor (la
idea 3 se descarta). Cada vez que suena una canción se pregunta a LRCLIB, como
hoy, y sin conexión no hay letra, también como hoy. Para no cargar a LRCLIB de
más, la cascada se para en cuanto encuentra una válida y nunca hace más de
cinco consultas por canción.

### 2.3 La cascada

De la más precisa a la más suelta. Se para en la primera respuesta que pase
la comprobación de §2.4:

1. Título y artista, como hoy, pero con los de `core/titles.js` (D6).
2. Título y **solo el primer artista** («KAROL G, Shakira» → «KAROL G»).
3. **Al revés**, si el título original tenía la forma «A - B»: B como artista
   y A como título («Yellow - Coldplay (Lyrics)»).
4. **Búsqueda libre** de «título + primer artista» (`q=`): LRCLIB busca en
   todos los campos.
5. **Solo el título** (`q=`), y aquí la comprobación exige la duración (§2.4).

### 2.4 Comprobar que es la misma canción

Cada candidata se puntúa por:

- **Título**: parecido, después de normalizar (sin tildes, mayúsculas,
  signos, «feat.» ni palabras de ruido).
- **Artista**: el de la candidata contiene el primer artista de la canción, o
  al revés. En el paso 5 el artista puede no coincidir (era un canal), pero
  entonces la duración es obligatoria.
- **Duración**, frente a la del audio descargado (`song.duration`):
  - **±3 s**: es esa versión. La letra sincronizada sirve.
  - **Hasta ±15 s**, con título y artista claros: es la canción, pero no esa
    versión (un videoclip con intro, por ejemplo). Se enseña la letra **sin
    sincronizar**, para no ir desacompasada.
  - **Más de 15 s**: otra versión (en directo, extendida…). Se descarta.
  - Si la canción no tiene duración, deciden el título y el artista.

Entre las válidas gana la sincronizada y, después, la de duración más
parecida. Si ninguna pasa, **es mejor no enseñar letra que enseñar la de otra
canción**.

### 2.5 Cuando LRCLIB está ocupado o no hay red

- Ante un 503, un 429 o un fallo de red, se reintenta **dos veces**, a los 1,5 s
  y a los 4 s. Cada consulta tiene un límite de 8 s.
- Si aun así falla, queda como **«no se pudo buscar»**, distinto de **«no hay
  letra»**. Se vuelve a intentar sola al abrir el panel de la letra o al volver
  a sonar la canción. «No hay letra» no se reintenta hasta la próxima vez que suene.
- Sin cabeceras propias en la petición. Una cabecera nueva obligaría al
  navegador a hacer una consulta previa de CORS, y LRCLIB podría rechazarla.

---

## 3. Tareas

### T1 · Artista y título en las canciones de la radio (D1)

**Ficheros:** `radio/cache-modelo.js`, `radio/pick.js`, tests de la radio.

`cancionDeRadio` y las candidatas de `elegir` pasan por `completarMetadatos`,
como la biblioteca. Arregla a la vez lo que se ve (el artista repetido en el
título, en el reproductor y en la cola) y lo que se busca. Al guardar la
canción en la biblioteca no cambia nada, porque allí ya se completaba.

### T2 · Elegir la letra: un módulo puro (D4, D6)

**Ficheros:** `features/letras/elegir.js` (nuevo), `test/frontend/test_letras.mjs`.

Sin DOM ni red, para probarlo en Node:

- `consultas(song)`: las consultas de la cascada (§2.3), sin repetidas.
- `puntuar(candidata, song)` y `elegir(resultados, song, paso)`: la comprobación
  de §2.4. Devuelven la letra, si es sincronizada o simple, o nada.

Los tests usan respuestas reales de LRCLIB guardadas como datos de prueba: el
ejemplo del usuario con sus versiones de 164, 198 y 300 s, «Gasolina» de otro
artista, la entrada basura de «Yellow» y una canción sin duración.

### T3 · La cascada y los reintentos (D2, D3)

**Ficheros:** `features/lyrics.js`.

`fetchLyrics` recorre `consultas(song)` hasta que `elegir` acepta una, con los
reintentos y el límite de tiempo de §2.5. Recibe la canción entera, no solo
título y artista, porque necesita la duración. Distingue «no hay letra» de «no
se pudo buscar». Si mientras busca cambia la canción, lo pendiente se cancela.

### T4 · Volver a buscar al editar (D5)

**Ficheros:** `player/player.js`, `features/lyrics.js`.

Cuando el editor cambia artista o título de la canción que suena,
`actualizarCancion` pide la letra otra vez con el nombre nuevo.

### T5 · Lo que ve el usuario

**Ficheros:** `features/lyrics.js`, traducciones.

- Si no hay letra, el mismo aviso de hoy, traducido.
- Si no se pudo buscar: «No se ha podido buscar la letra. Se volverá a intentar»,
  en los seis idiomas, y el reintento automático de §2.5.
- Nada nuevo en la pantalla mientras busca: el esqueleto de siempre.

### T6 · Tests

- **Unitarios** (T2): la cascada, la puntuación y los casos límite.
- **Recorrido E2E**, con LRCLIB simulado:
  1. una canción de la radio con el artista en el título enseña su letra;
  2. un 503 y después un 200 enseñan la letra, sin hacer nada;
  3. entre varias versiones se elige la de la duración del audio;
  4. editar el artista vuelve a buscar.
- **Medición manual** contra el LRCLIB real (no en CI): `scripts/medir-letras.mjs`
  con las muestras de §4. Cuenta las encontradas y, sobre todo, las
  **equivocadas**.

---

## 4. Cómo se sabe que funciona

Las mismas muestras del 2026-10-08:

| Muestra | Hoy | Objetivo |
|---|---|---|
| 20 canciones conocidas, con el título de su canal oficial | 18 / 20 | 20 / 20 |
| 16 casos difíciles: canales de letras, orden «Canción - Artista», sin guion | 11 / 16 | ≥ 15 / 16 |
| El ejemplo del usuario (radio, «hate that i made you love me») | sin letra | letra sincronizada, la versión de 198 s |
| **Letras equivocadas** (de otra canción o de otra versión) | no se medía | **0** |

---

## 5. Riesgos

| Riesgo | Qué se hace |
|---|---|
| Más consultas a LRCLIB, que ya va justo | Se para en la primera válida y nunca hace más de 5. La primera consulta es la misma que hoy, así que en las canciones que ya salían no cambia nada |
| Un videoclip con intro hace que la letra sincronizada vaya desacompasada | De 3 a 15 s de diferencia se enseña sin sincronizar (§2.4) |
| Descartar una letra buena por ser demasiado estricto | Lo mide `medir-letras.mjs`. Los umbrales se ajustan con números, no a ojo |
| LRCLIB cae del todo | Como hoy: sin letra, con el aviso de «no se pudo buscar» |

---

## 6. Definición de hecho

- Los objetivos de §4 cumplidos y anotados en el registro, sin letras equivocadas.
- Los tests unitarios y el recorrido E2E en verde. La E2E completa y la estética, sin regresiones.
- Probado en la APK con la canción del ejemplo.

---

## 7. Registro

### Sesión A: T3, T4, T5 y los recorridos de la T6 (2026-10-09)

**T3 · La cascada y los reintentos** (`lyrics.js`):
- Recorre las consultas de `consultasDeLetra` y se queda con la primera que
  `elegirLetra` acepta.
- Cada consulta tiene un límite de 8 s y dos reintentos (1,5 s y 4 s) ante un 503,
  un 429 o un fallo de red. Si aun así no responde, para la cascada, porque
  seguir preguntando solo cargaría más a LRCLIB.
- Si cambia la canción, lo pendiente se cancela con un `AbortController`.
- Sin cabeceras propias.
- `elegir.js` se carga con `import()` la primera vez que se busca: importado al
  arrancar, el JS inicial pasaba a 292 KB y rompía el presupuesto de 290 del plan 19.

**T4 · Volver a buscar al editar:** la clave de la búsqueda lleva el id, el título y
el artista, así que `actualizarCancion` vuelve a pedir la letra cuando el editor
cambia el nombre. Guardar una canción de la radio (cambia su `src`) no vuelve a buscar.

**T5 · Dos avisos distintos:** «No hemos encontrado la letra» (LRCLIB no la tiene) y
«No se ha podido buscar la letra» (no responde), en los seis idiomas. El segundo
se reintenta solo al abrir la vista de letras o al volver a sonar la canción. De paso,
pintar una letra simple ya no deja la sincronizada anterior marcando líneas.

**Encontrado por el camino: las descargas no guardaban su duración.** El
servidor la manda en el progreso, pero `entradaDeBiblioteca` no la copiaba. Solo
la tenían las canciones bajadas por lote o por la radio, así que la regla de versiones
de §2.4 no habría podido actuar en casi toda la biblioteca.
- Ahora las descargas nuevas la guardan (`test_duracion.mjs`).
- En las que ya existen, la letra usa la duración del propio audio.
- El plan 23 (la duración total de una lista) también la necesita.

**T6 · Recorridos 93-97**, con un LRCLIB simulado que responde según la consulta:
- versiones de 120, 181 y 300 s → se elige la de 181;
- un 503 y después un 200 → la letra llega sola;
- LRCLIB caído → «No se ha podido buscar», y al volver a la letra, la letra;
- editar el artista → nueva búsqueda con el nombre nuevo;
- una canción de la radio con el artista en el título → separados y con letra.

Se adaptan el 13 y las capturas del README para que sus respuestas simuladas
lleven título, artista y duración, como las reales. La estética ya cuadraba. El 82 pasa a comparar
el título exacto: con la T1, «Parecida 1» es también el principio de «Parecida 10».

### Sesión B: T1, T2 y la medición (2026-10-09)

**T1.** `cancionDeRadio` y las candidatas de `elegir` (radio) pasan por
`completarMetadatos`: «Ariana Grande – hate that i made you love me» llega con
artista y canción separados, en el reproductor, en la cola y en lo que se busca.

**T2.** `features/letras/elegir.js` (puro): `consultasDeLetra`, `elegirLetra` y
`puntuarLetra` (los nombres `elegir` y `puntuar` ya los usaban la radio y la
importación). 24 tests sobre respuestas reales de LRCLIB guardadas en
`test/frontend/datos/lrclib.json`. Al medir salieron tres reglas que el diseño
no tenía:
- **Paso 3, al revés también al comparar.** Se preguntaba bien («Yellow» de
  «Coldplay») pero se comparaba con lo deducido sin invertir, y se descartaba.
  Además, lo que se invierte es lo ya limpio: con «Hijo de la luna - Mecano |
  Letra» el artista era «Mecano | Letra».
- **Fichas basura fuera.** Una ficha con restos de nombre de fichero
  («Yellow(MP3_160K)», también con los campos cambiados) no vale, aunque el
  título o el artista coincidan.
- **Paso 5, solo el artista dominante.** Con solo el título, el artista de la
  canción no sirve (es el canal), y una versión de otro (Marc Martel cantando
  «Bohemian Rhapsody», 359 s) o una coincidencia (otra «Gasolina» de 192 s)
  pasaban por la duración. Ahora solo vale el artista con más fichas de esa
  canción a ±15 s (contando «feat.», «&» y «- Topic» como el mismo); con
  empate, ninguno.

**Medición** (`node scripts/medir-letras.mjs`, contra el LRCLIB real, 84
peticiones con 250 ms entre ellas). Las 36 muestras de §4 con la duración de su
vídeo y su respuesta buena, para contar las equivocadas. «Antes» es la búsqueda
de hoy (título y artista, el primer resultado con letra):

| Muestra | Antes: buenas | Antes: equivocadas | Cascada: buenas | Cascada: equivocadas |
|---|---|---|---|---|
| 20 conocidas | 7 | 13 | **20** | **0** |
| 16 difíciles | 5 | 6 (y 5 sin letra) | **16** | **0** |

La sorpresa está en «antes»: de las 18/20 que «encontraba», 13 eran
**sincronizadas de otra versión** (desacompasadas), porque cogía el primer
resultado sin mirar la duración. La cascada para casi siempre en el paso 1;
los pasos 3 a 5 rescatan los casos difíciles.
