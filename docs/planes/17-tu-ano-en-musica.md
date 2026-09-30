# 17 — Tu año en música

**Estado:** hecho · desplegado (2026-09-29, APK 1.6.0) · **Prioridad:** 🟢 Bajo (experiencia) · **Depende de:** 11 (T5, registro de escuchas) · 13 (escuchas en la cuenta, para sumar todos los dispositivos)
**Propuesta que cubre:** 15 («Tu año en música», al estilo del Wrapped de Spotify).

> Un resumen del año contado como una historia: cuánto escuchaste, a quién, qué
> canción no dejaste de poner, a qué horas… Con los colores de tus carátulas,
> con movimiento y con una imagen final para guardar.

**Condición para que tenga sentido:** el registro de escuchas del plan 11 tiene
que llevar tiempo funcionando. Si el plan 11 se hace en octubre, el resumen de
este año tendrá solo dos meses. Por eso ese plan empieza a registrar desde el
primer día (plan 11, §2.4), y este resumen funciona también a mitad de año
(«Tu año hasta ahora»).

---

## 1. Problema

| id | Defecto | Efecto |
|----|---------|--------|
| D1 | La app no devuelve nada de lo que sabe de ti | Las escuchas se registran (plan 11) pero nadie las ve |
| D2 | Sin momentos para compartir | Las apps de música se recuerdan por estos resúmenes |

---

## 2. Decisiones de diseño

### 2.1 Qué se cuenta

Todo sale del registro de escuchas: `{ videoId, artista, cancion, t, segundos }`.

| Dato | Cómo |
|---|---|
| Minutos escuchados | Suma de `segundos` / 60 |
| Canciones distintas y artistas distintos | Por `videoId` y por `normalizarArtista` (plan 11) |
| Tus 5 artistas | Por minutos, no por escuchas: un artista de canciones largas no sale perjudicado |
| Tus 5 canciones | Por número de escuchas; empate → más minutos |
| Tu canción del año | La primera de las 5 |
| El día que más escuchaste | Fecha y minutos |
| Tu racha | Días seguidos con alguna escucha |
| A qué hora escuchas | Madrugada, mañana, tarde o noche (franjas de 6 h), en la **hora local** del dispositivo |
| Descubrimientos | Artistas cuya primera escucha registrada es de este año |
| La primera canción del año | La primera escucha desde el 1 de enero |

Todo en una función pura, `calcularResumen(escuchas, { anio, zonaHoraria })`,
que se prueba con registros sintéticos.

**Mínimo para mostrarlo:** 60 minutos y 20 escuchas en el periodo. Con menos,
«Todavía no hay suficiente música para tu resumen» y cuánto falta.

### 2.2 De dónde salen las escuchas

| Sin sesión | Con sesión |
|---|---|
| El registro local (IndexedDB `escuchas`, plan 11) | El servidor devuelve las de **todos** tus dispositivos (tabla `listens` del plan 13), y se suman las locales que aún no se hayan subido, sin duplicar (clave `dispositivo + id local`) |

`GET /api/resumen/escuchas?anio=2026` devuelve las escuchas del año en formato
compacto:

```json
{ "catalogo": [ ["videoId", "artista", "canción"], … ],
  "escuchas": [ [indiceCatalogo, t, segundos], … ] }
```

Un año de 10 escuchas diarias son unos 40 KB comprimidos. El cálculo se hace en
el cliente con la misma función que sin sesión: **una sola lógica**.

### 2.3 Cuándo aparece

- **Del 1 de diciembre al 15 de enero:** una tarjeta en Inicio, «Tu 2026 en
  música», que abre el resumen del año. Hasta el 15 de enero sigue siendo el
  del año anterior.
- **El resto del año:** desde el perfil o los ajustes, «Tu año hasta ahora».
- La tarjeta se puede cerrar y no vuelve hasta el año siguiente
  (`resumen_descartado_<año>`).

### 2.4 Cómo se ve: una historia

- Pantalla completa, **diapositivas** con barras de progreso arriba (como las
  historias de Instagram): toque a la derecha avanza, a la izquierda vuelve,
  mantener pulsado pausa; cada una dura 6 s.
- 8 diapositivas: minutos → artista principal → tus 5 artistas → tu canción del
  año (**suena un fragmento** si está en la biblioteca: 15 s desde el minuto 1,
  con fundido) → tus 5 canciones → a qué hora escuchas → racha y día récord →
  resumen final.
- Colores: la paleta de la carátula de tu artista principal (`ui/palette.js`,
  plan 09), con degradados de fondo.
- Movimiento con los muelles del plan 09: números que cuentan hasta su valor,
  carátulas que entran escalonadas. Con «Reducir movimiento»: cortes limpios y
  números fijos.
- Al abrir, la música que sonara **se pausa** y se reanuda al cerrar.

### 2.5 La imagen final

«Guardar imagen» dibuja la diapositiva final en un `<canvas>` de 1080×1920 (el
formato de las historias) con fuentes e imágenes ya cargadas.

- **Web:** se descarga como PNG (`entregarFichero`).
- **APK:** se guarda en `Documentos/YTMusic/` con `Filesystem` y se avisa.
- Las carátulas de `i.ytimg.com` permiten leer sus píxeles (el plan 09 ya lo
  usa para la paleta); si alguna no lo permitiera, se dibuja un cuadro con el
  color de la paleta en su lugar, para no «contaminar» el lienzo y no poder exportarlo.

---

## 3. Privacidad y seguridad

| Medida | Por qué |
|---|---|
| Nada se publica: no hay enlaces públicos ni comparación con otros usuarios | Es tu historial de escucha |
| `GET /api/resumen/escuchas` con `@auth_required` y solo el `user_id` del token | Como el resto de la cuenta |
| Límite de 10 peticiones por minuto | La respuesta puede ser grande |
| La imagen final solo lleva lo que se ve en pantalla, sin el correo ni la foto de la cuenta | Si la compartes, no enseña tu cuenta |
| Nombres de artistas y canciones con `html\`…\`` y, en el lienzo, con `fillText` (que no interpreta nada) | Datos que vienen de YouTube o de tus ediciones |

---

## 4. Alcance

**Dentro:** D1-D2.

**Fuera:**
- Géneros musicales: YouTube no los da de forma fiable.
- Comparaciones con otros («estás en el 1 % de oyentes de…»): exigen agregados de
  todos los usuarios, justo lo que §3 evita.
- Compartir directamente a otras apps: no se eligió la propuesta 14 (compartir).

---

## 5. Tareas

### Bloque A — Datos

#### T1 · Escuchas del año en el servidor

**Ficheros:** `backend/server.py`, `backend/database.py`

`escuchas_del_anio(user_id, anio)` con índice `idx_listens_t` (plan 13) y la
ruta de §2.2. El año se filtra con un margen de ±14 h en UTC y el cliente
recorta con su zona horaria: así ninguna escucha de Nochevieja cae en el año que no es.

#### T2 · El cálculo

**Ficheros:** `frontend/src/features/wrapped/resumen.js` (nuevo, puro)

`calcularResumen` de §2.1, con `Intl.DateTimeFormat` para la hora local.

#### T3 · Reunir las escuchas

**Ficheros:** `frontend/src/features/wrapped/datos.js` (nuevo)

Local, servidor o ambas sin duplicar (§2.2).

### Bloque B — Interfaz

#### T4 · Las diapositivas

**Ficheros:** `frontend/src/features/wrapped/historia.js` (nuevo), `frontend/src/features/wrapped/diapositivas.js`
(nuevo: una función por diapositiva que devuelve su contenido), `frontend/index.html`
(`#wrappedView`), `ui/navigation.js` (capa con el botón atrás), `styles.css`, traducciones (6 idiomas)

1. §2.4, con gestos (toque, pulsación larga, deslizar hacia abajo para cerrar,
   reutilizando `ui/motion/gesture.js`).
2. Fragmento de la canción del año con el motor del plan 12 (o, si no está, sin sonido).
3. Pausar y reanudar la música del usuario.

#### T5 · La imagen

**Ficheros:** `frontend/src/features/wrapped/imagen.js` (nuevo)

`dibujarResumen(ctx, resumen, paleta)` y el guardado de §2.5. Espera a
`document.fonts.ready` antes de dibujar.

#### T6 · Dónde aparece

**Ficheros:** `features/wrapped/entrada.js` (nuevo), `frontend/index.html` (tarjeta
en Inicio), perfil/ajustes, traducciones

Fechas y descarte de §2.3.

### Bloque C — Tests

#### T7 · Tests del plan

| Qué | Dónde |
|---|---|
| `calcularResumen` con un año sintético: totales, orden de artistas por minutos, empates, racha, día récord, franjas horarias en dos zonas horarias, descubrimientos, mínimo no alcanzado | `test/frontend/test_resumen.mjs` (nuevo) |
| Límites del año: una escucha a las 23:30 del 31 de diciembre en Madrid es de ese año aunque en UTC sea del siguiente | ídem |
| Unión local + servidor sin duplicar | ídem |
| Fechas de §2.3: tarjeta visible el 1 de diciembre y el 15 de enero, no el 16 | ídem |
| `/api/resumen/escuchas`: sesión, aislamiento entre usuarios, margen del año | `test/backend/test_resumen.py` (nuevo) |
| E2E **50** · con 30 escuchas inyectadas en IndexedDB, «Tu año hasta ahora» muestra las diapositivas, avanza con toques y guarda la imagen (se comprueba la descarga de un PNG de 1080×1920). El **51** cubre el caso de poca música | `recorridos.spec.js` |

---

## 6. Orden de ejecución, commits y despliegue

```
T2                      el cálculo (se puede hacer en cualquier momento)
T1 → T3                 datos                                → desplegar (servidor)
T4 → T5 → T6            interfaz                             → desplegar + APK
T7 con cada tarea
```

Idealmente listo **antes del 1 de diciembre**, que es cuando aparece la tarjeta.

---

## 7. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Poco historial el primer año | Alta | «Tu año hasta ahora» y el mínimo de §2.1; el registro empieza en el plan 11 |
| Artistas mal agrupados («Bad Bunny» y «BadBunnyPR») | Media | `normalizarArtista` y las ediciones del plan 11 |
| La imagen sale sin carátulas por CORS | Baja | Cuadro de color de sustitución (§2.5) |
| El cálculo tarda con muchos datos en un móvil modesto | Baja | Un año son miles de filas, no millones; se mide con 20.000 escuchas |

---

## 8. Definición de hecho

- [x] El resumen se calcula con las escuchas de todos tus dispositivos (con sesión) o del actual.
- [x] Ocho diapositivas con colores y movimiento, respetando «Reducir movimiento».
- [x] Imagen de 1080×1920 que se guarda en la web y en la APK. ← el guardado en la APK **queda por probar en el móvil**
- [x] Tarjeta en Inicio del 1 de diciembre al 15 de enero; «hasta ahora» el resto del año.
- [x] Todas las suites en verde, incluidos los recorridos 50 y 51.

---

## 9. Lo que salió al implementarlo

| Hallazgo | Dónde |
|---|---|
| `GET /api/resumen/escuchas` necesitaba devolver también `anteriores` (los artistas ya escuchados antes del año, sin normalizar). Sin eso, en un dispositivo recién instalado **todos** los artistas parecen descubrimientos, aunque se escucharan desde años atrás | T1 y T3 |
| `_entero()` de `server.py` exige int/float y los parámetros de la URL siempre son texto: hizo falta `_anio_de_consulta()` | T1 |
| Llamar a `Intl.DateTimeFormat` una vez por escucha es caro con decenas de miles de filas. Se pregunta el desfase **una vez por hora UTC** y se guarda. Medido: 20.000 escuchas en 30 ms. El único error posible es que una escucha dentro de la hora exacta del cambio de horario de verano caiga en la franja de al lado; nunca en otro día ni en otro año | T2 |
| `paletteFromImage` ya devuelve los colores en hexadecimal y con el oscuro bajado de luminancia: no hay que pasarlos por `toHex` ni `darkenTo` | T4 |
| La capa tenía que ir por encima de los modales (z-index 5000), porque se abre desde la hoja de «Tus datos» — y esa hoja hay que cerrarla al abrir la historia. Lo encontró el recorrido 50 | T4 y T6 |
| El reloj de las diapositivas se quedaba en `NaN` si `requestAnimationFrame` llamaba sin marca de tiempo (pasa con algunos sustitutos). Ahora cae a `scheduler.now()` | T4 |
| `olvidarOverlay()` de `ui/navigation.js` lee `window.history.state` sin protección y revienta sin History API. Se rodeó con `try/catch` **desde este plan**, sin tocar el fichero compartido: queda como posible arreglo aparte | T4 |
| Ni `datos.js` ni `entrada.js` se pueden importar directamente en Node: arrastran `auth.js` / la historia y con ellos módulos que tocan el DOM al cargarse. Sus funciones puras se sacan del arnés. Solo `resumen.js` y `diapositivas.js` se importan directos | T7 |
| La tabla de recorridos de `test/README.md` se quedó en los del plan 06: faltan del 23 al 49, de los planes 09 a 20. Se anotó allí en vez de reescribir la documentación de otros planes | T7 |
