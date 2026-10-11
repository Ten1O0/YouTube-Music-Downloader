/**
 * Canciones recomendadas al final de una lista (plan 24, P7).
 *
 * Cinco canciones parecidas a las de la lista que no estén ya en ella. Salen de
 * la radio (GET /api/radio, la mezcla que YouTube hace de cada canción, con la
 * caché de mezclas del servidor), con una canción de la lista al azar como
 * semilla, y se eligen con las reglas de la radio (`elegir`: una por canción,
 * ni muy cortas ni muy largas, y la versión descargada si la hay).
 *
 * - Se piden solo si la sección llega a verse: una petición por lista abierta.
 * - «Otras» enseña cinco más; si se acaban, pide otra mezcla.
 * - La escucha previa es la de la búsqueda (`escucharAntes`, preview.js): el
 *   reproductor de YouTube y, si el vídeo no se deja incrustar (casi todos los
 *   oficiales, que son los de las mezclas), su audio bajado a la caché de la
 *   radio, sin tocar la cola.
 * - El + la añade: si ya está descargada, tal cual; si está en la caché de la
 *   radio (por ejemplo, porque se ha escuchado), se guarda sin volver a bajarla;
 *   si no, se descarga.
 * - Si YouTube limita o no hay red, la sección no aparece: nada de errores en
 *   medio de una lista.
 *
 * Se carga cuando el final de la lista se acerca a la pantalla.
 */

import { apiBase } from '../../../config/env.js';
import { html, seguro } from '../../../core/html.js';
import { nombreDe } from '../../../core/titles.js';
import { i18n } from '../../../i18n/language-manager.js';
import { pintarEsqueletos } from '../../../ui/skeleton.js';
import { downloadFromUrl } from '../../download/download.js';
import { StorageModule } from '../../../core/storage.js';
import { LibraryModule } from '../../library/library.js';
import { CLAVE_CONTADORES, claveEscucha } from '../../player/listens.js';
import { PlayerModule } from '../../player/player.js';
import { alCambiarEscucha, escucharAntes, stopPreview } from '../../preview.js';
import { aBiblioteca } from '../../radio/cache.js';
import { claveArtista, elegir, juntarMezclas } from '../../radio/pick.js';
import { esVideoId } from '../../sync/validar.js';
import { PlaylistModule } from '../playlists.js';

const $ = (id) => document.getElementById(id);

export const CUANTAS = 5;
/** Semillas por tanda: hasta cinco canciones de la lista, de artistas distintos (plan 25, R3). */
export const SEMILLAS = 5;
/** Mezclas que se piden como mucho por lista abierta: dos tandas. */
const MAX_MEZCLAS = 2 * SEMILLAS;
// «Otras» enseña que busca al menos este rato: con la mezcla ya en memoria
// llegaría en el acto y no se vería que algo ha cambiado
const MINIMO_OTRAS_MS = 600;

function barajar(xs, azar) {
    for (let i = xs.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
}

/**
 * Hasta `n` videoId de las canciones, de artistas distintos mientras se pueda:
 * primero una de cada artista y, si faltan, la segunda de cada uno. Al azar
 * dentro de cada artista y entre artistas. Pura (salvo `azar`).
 */
export function semillasDe(canciones, n = SEMILLAS, { azar = Math.random, usadas = new Set() } = {}) {
    const porArtista = new Map();
    for (const s of canciones ?? []) {
        const id = s?.videoId;
        if (!esVideoId(id) || usadas.has(id)) continue;
        const clave = claveArtista(s) || id;
        if (!porArtista.has(clave)) porArtista.set(clave, new Set());
        porArtista.get(clave).add(id);
    }
    const grupos = barajar([...porArtista.values()].map((ids) => barajar([...ids], azar)), azar);
    const elegidas = [];
    for (let vuelta = 0; elegidas.length < n && grupos.some((g) => g.length > vuelta); vuelta++) {
        for (const g of grupos) {
            if (elegidas.length >= n) break;
            if (g[vuelta] && !elegidas.includes(g[vuelta])) elegidas.push(g[vuelta]);
        }
    }
    return elegidas;
}

/**
 * Las siguientes recomendadas: ni las de la lista ni las ya enseñadas, como
 * mucho dos por artista y mezclando artistas de la lista (`conocidos`) con
 * otros (plan 25, R2). `recientes`: los artistas de la tanda anterior, que
 * cuentan para el tope. Pura. Devuelve canciones de la biblioteca (si ya están
 * descargadas) u objetos de la radio `{ radio: true, videoId, title, … }`.
 */
export function siguientes(candidatas, { enLista = new Set(), mostradas = new Set(), biblioteca = [], conocidos = new Set(), recientes = [], n = CUANTAS } = {}) {
    return elegir(candidatas, { sonadas: new Set([...enLista, ...mostradas]), biblioteca, n, porArtista: 2, conocidos, recientes });
}

/** Una canción ya descargada: se propone para añadirla a la lista, no para bajarla (plan 25, R4). */
export const esTuya = (s) => Boolean(s?.src) && !s.radio && !s.nube;

// ── El estado de la lista abierta ──

let estado = null;   // { id, pl, semillas, mezclas: candidatas[][], usadas, pedidas, mostradas, visibles, anadidas }

async function leerMezcla(semilla) {
    try {
        const res = await fetch(`${apiBase()}/api/radio?semilla=${encodeURIComponent(semilla)}`);
        if (!res.ok) return null;
        const { candidatas = [] } = await res.json();
        return candidatas;
    } catch {
        return null;   // sin red: la sección no sale
    }
}

/** Pide a la vez las mezclas de esas semillas. Dice si llegó alguna. */
async function pedirMezclas(yo, semillas) {
    for (const s of semillas) yo.usadas.add(s);
    yo.pedidas += semillas.length;
    const leidas = (await Promise.all(semillas.map(leerMezcla))).filter(Boolean);
    yo.mezclas.push(...leidas);
    return leidas.length > 0;
}

/** Semillas nuevas: las de partida que falten o, si no, otras canciones de la lista. */
function siguientesSemillas(yo, pl) {
    const deEntrada = yo.semillas.filter((s) => !yo.usadas.has(s));
    if (deEntrada.length) return deEntrada;
    return semillasDe(pl.songs, Math.min(SEMILLAS, MAX_MEZCLAS - yo.pedidas), { usadas: yo.usadas });
}

/**
 * Rellena hasta cinco con las mezclas juntas. `rotar` («Otras»): antes, las
 * mezclas de otras canciones de la lista, para no quedarse en las primeras.
 */
async function llenar(pl, { rotar = false } = {}) {
    const yo = estado;
    const desde = Date.now();
    const enLista = new Set((pl.songs ?? []).map((s) => s?.videoId).filter(Boolean));
    const conocidos = new Set((pl.songs ?? []).map(claveArtista).filter(Boolean));
    const biblioteca = await LibraryModule.getLibrary();
    // Con «Otras», los artistas que se ven ahora cuentan: la tanda nueva no los repite de golpe
    const recientes = rotar ? yo.visibles.map(claveArtista).filter(Boolean) : [];
    const elegirAhora = () => siguientes(juntarMezclas(yo.mezclas), { enLista, mostradas: yo.mostradas, biblioteca, conocidos, recientes });

    if (rotar && yo.pedidas < MAX_MEZCLAS) {
        const nuevas = siguientesSemillas(yo, pl);
        if (nuevas.length) await pedirMezclas(yo, nuevas);
        if (estado !== yo) return;
    }
    let lote = elegirAhora();
    while (lote.length < CUANTAS && yo.pedidas < MAX_MEZCLAS) {
        const nuevas = siguientesSemillas(yo, pl);
        if (!nuevas.length) break;
        const llego = await pedirMezclas(yo, nuevas);
        if (estado !== yo) return;
        if (!llego) break;
        lote = elegirAhora();
    }
    if (rotar) await new Promise((ok) => setTimeout(ok, MINIMO_OTRAS_MS - (Date.now() - desde)));
    if (estado !== yo) return;
    for (const s of lote) yo.mostradas.add(s.videoId);
    // «Otras» sin nada nuevo deja las que había, en vez de vaciar la sección
    if (lote.length || !rotar) {
        yo.visibles = lote;
        yo.entrando = lote.length > 0;
    }
    yo.cargando = false;
    pintar();
}

const ICONO_NOTA = seguro('<svg class="music-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>');
const ICONO_PAUSA = seguro('<svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');

/** Por qué no hay recomendadas: sin de qué partir, sin conexión o sin respuesta de YouTube. */
function motivoSinRecomendadas(yo) {
    if (!yo.semillas.length && !yo.pedidas) return 'pl_rec_no_seeds';
    return globalThis.navigator?.onLine === false ? 'pl_rec_offline' : 'pl_rec_none';
}

/**
 * La sección, siempre a la vista en una lista propia (plan 25): esqueletos
 * mientras cargan, las recomendadas o, si no hay, por qué y «Reintentar».
 */
function pintar() {
    const seccion = $('plRecomendadas');
    const filas = $('plRecomendadasLista');
    const aviso = $('plRecomendadasAviso');
    if (!seccion || !filas) return;
    seccion.hidden = !estado;
    // «Otras» buscando: el botón gira y las que había se apagan mientras las recorre una onda
    const buscando = Boolean(estado?.cargando && estado.visibles.length);
    const otras = $('plRecomendadasOtras');
    otras?.classList.toggle('rec-otras--buscando', buscando);
    filas.classList.toggle('rec-buscando', buscando);
    if (buscando) filas.setAttribute('aria-busy', 'true'); else filas.removeAttribute('aria-busy');
    if (!estado) return;
    if (otras) otras.disabled = estado.cargando || !estado.visibles.length;
    if (buscando) return;
    if (estado.cargando && !estado.visibles.length) {
        if (aviso) aviso.hidden = true;
        filas.replaceChildren();
        // Con la forma de lo que viene: filas en la columna, tarjetas en la fila que se desliza
        const enColumna = globalThis.matchMedia?.('(min-width: 1200px)').matches;
        pintarEsqueletos(filas, enColumna ? 'fila' : 'tarjeta', CUANTAS);
        return;
    }
    if (aviso) {
        aviso.hidden = estado.visibles.length > 0;
        if (!aviso.hidden) $('plRecomendadasAvisoTexto').textContent = i18n.t(motivoSinRecomendadas(estado));
    }
    // Las que llegan entran una tras otra, solo al llegar (no en cada repintado)
    const entrando = estado.entrando;
    estado.entrando = false;
    filas.innerHTML = html`${estado.visibles.map((s) => {
        const { titulo, artista } = nombreDe(s);
        const anadida = estado.anadidas.has(s.videoId);
        // La ya descargada se añade sin bajarla, y se dice que ya es tuya (plan 25, R4)
        const tuya = esTuya(s);
        const accion = anadida ? 'pl_rec_added' : tuya ? 'pl_rec_add' : 'pl_rec_download';
        return html`<div class="rec-fila${tuya ? ' rec-fila--tuya' : ''}${entrando ? ' rec-fila--nueva' : ''}" data-video="${s.videoId}">
            <img class="rec-caratula" src="${s.thumbnail || 'favicon.png'}" alt="" width="44" height="44" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
            <span class="rec-textos"><span class="rec-titulo">${titulo}</span><span class="rec-artista">${artista}</span>${tuya ? html`<span class="rec-tuya">${i18n.t('pl_rec_owned')}</span>` : ''}</span>
            <button type="button" class="rec-boton rec-escuchar" data-accion="escuchar" title="${i18n.t('t_preview')}" aria-label="${i18n.t('t_preview')}">${ICONO_NOTA}${ICONO_PAUSA}</button>
            <button type="button" class="rec-boton rec-anadir" data-accion="anadir" ${anadida ? 'disabled' : ''}
                aria-label="${i18n.t(accion)}" title="${i18n.t(accion)}">
                <span class="material-symbols-outlined" aria-hidden="true">${anadida ? 'check' : tuya ? 'playlist_add' : 'download'}</span>
            </button>
        </div>`;
    })}`;
    marcarEscucha();
}

// ── La escucha previa (preview.js: YouTube y, si no se deja, la caché de la radio) ──

let escucha = null;   // { videoId, estado } de la que se escucha, como lo cuenta preview.js

/** El botón de la que se escucha, por su videoId: las filas se repintan. */
function marcarEscucha() {
    for (const b of document.querySelectorAll('#plRecomendadasLista .rec-escuchar')) {
        const esta = escucha?.videoId === b.closest('.rec-fila')?.dataset.video;
        b.classList.toggle('rec-escuchar--cargando', Boolean(esta && escucha.estado === 'cargando'));
        b.classList.toggle('playing', Boolean(esta && escucha.estado === 'sonando'));
    }
}

/** La canción en la biblioteca: ya estaba, sale de la caché de la radio o se descarga. */
async function aLaBiblioteca(s) {
    if (esTuya(s)) return s;
    const deCache = await aBiblioteca(s.videoId).catch(() => null);
    if (deCache) return deCache;
    const info = { id: s.videoId, videoId: s.videoId, title: s.title, channel: s.channel, duration: s.duration, thumbnail: s.thumbnail };
    return downloadFromUrl(`https://www.youtube.com/watch?v=${s.videoId}`, info, {});
}

async function anadir(pl, s, boton) {
    boton.disabled = true;
    boton.classList.add('rec-anadir--bajando');
    const cancion = await aLaBiblioteca(s).catch(() => null);
    boton.classList.remove('rec-anadir--bajando');
    if (!cancion) { boton.disabled = false; return; }
    estado?.anadidas.add(s.videoId);
    await PlaylistModule.addSongToPlaylist(pl.id, cancion);
    pintar();
}

let preparada = false;

function preparar() {
    if (preparada) return;
    preparada = true;
    $('plRecomendadasOtras')?.addEventListener('click', () => {
        if (!estado?.pl || estado.cargando) return;
        estado.cargando = true;
        pintar();
        llenar(estado.pl, { rotar: true });
    });
    $('plRecomendadasReintentar')?.addEventListener('click', () => {
        if (estado?.pl) recomendar(estado.pl, { nueva: true, semillas: estado.deEntrada });
    });
    alCambiarEscucha((e) => {
        escucha = e.estado === 'parada' ? null : e;
        marcarEscucha();
    });
    $('plRecomendadasLista')?.addEventListener('click', (e) => {
        const boton = e.target.closest('[data-accion]');
        const fila = e.target.closest('.rec-fila');
        const s = estado?.visibles.find((x) => x.videoId === fila?.dataset.video);
        if (!boton || !s) return;
        if (boton.dataset.accion === 'escuchar') escucharAntes(s, boton);
        else anadir(estado.pl, s, boton);
    });
}

/**
 * Enseña las recomendadas de la lista. `semillas`: de dónde partir (por
 * defecto, una canción de la lista al azar). `nueva`: empezar de cero, al
 * entrar en la lista; si no, solo se repintan las que ya había.
 */
export async function recomendar(pl, { semillas = null, nueva = false } = {}) {
    preparar();
    if (nueva || estado?.id !== pl.id || semillas) {
        estado = {
            id: pl.id, pl, semillas: semillas ?? semillasDe(pl.songs), deEntrada: semillas,
            mezclas: [], usadas: new Set(), pedidas: 0, mostradas: new Set(), visibles: [], anadidas: new Set(),
            cargando: true,
        };
        pintar();
        await llenar(pl);
    } else {
        estado.pl = pl;
        pintar();
    }
}

/**
 * De dónde partir en una lista vacía: lo que suena o, si no, lo más escuchado
 * de la biblioteca (plan 24, P12).
 */
export async function semillasSinLista() {
    const sonando = PlayerModule.cancionActual()?.videoId;
    if (esVideoId(sonando)) return [sonando];
    const [biblioteca, contadores] = await Promise.all([LibraryModule.getLibrary(), StorageModule.get(CLAVE_CONTADORES).catch(() => null)]);
    const veces = (s) => contadores?.[claveEscucha(s)]?.n ?? 0;
    const masEscuchadas = [...biblioteca].filter((s) => esVideoId(s?.videoId)).sort((a, b) => veces(b) - veces(a));
    return masEscuchadas.slice(0, 3).map((s) => s.videoId);
}

/** Para otra lista u otra vista: la sección se esconde y no se pide nada más. */
export function olvidar() {
    if (escucha) stopPreview();
    estado = null;
    pintar();
}
