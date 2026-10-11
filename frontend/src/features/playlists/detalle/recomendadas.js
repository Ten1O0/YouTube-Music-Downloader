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
import { downloadFromUrl } from '../../download/download.js';
import { StorageModule } from '../../../core/storage.js';
import { LibraryModule } from '../../library/library.js';
import { CLAVE_CONTADORES, claveEscucha } from '../../player/listens.js';
import { PlayerModule } from '../../player/player.js';
import { alCambiarEscucha, escucharAntes, stopPreview } from '../../preview.js';
import { aBiblioteca } from '../../radio/cache.js';
import { elegir } from '../../radio/pick.js';
import { esVideoId } from '../../sync/validar.js';
import { PlaylistModule } from '../playlists.js';

const $ = (id) => document.getElementById(id);

export const CUANTAS = 5;
/** Mezclas que se piden como mucho cada vez que se abre una lista. */
const MAX_MEZCLAS = 3;

/** `n` videoId distintos de las canciones, al azar. Pura (salvo `azar`). */
export function semillasDe(canciones, n = 1, { azar = Math.random, usadas = new Set() } = {}) {
    const ids = [...new Set((canciones ?? []).map((s) => s?.videoId).filter((id) => esVideoId(id) && !usadas.has(id)))];
    for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(azar() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return ids.slice(0, n);
}

/**
 * Las siguientes recomendadas: ni las de la lista ni las ya enseñadas. Pura.
 * Devuelve canciones de la biblioteca (si ya están descargadas) u objetos de
 * la radio `{ radio: true, videoId, title, … }`.
 */
export function siguientes(candidatas, { enLista = new Set(), mostradas = new Set(), biblioteca = [], n = CUANTAS } = {}) {
    return elegir(candidatas, { sonadas: new Set([...enLista, ...mostradas]), biblioteca, n });
}

// ── El estado de la lista abierta ──

let estado = null;   // { id, semillas: string[], candidatas, mostradas, usadas, mezclas, visibles, anadidas }

async function pedirMezcla(semilla) {
    estado.usadas.add(semilla);
    estado.mezclas++;
    try {
        const res = await fetch(`${apiBase()}/api/radio?semilla=${encodeURIComponent(semilla)}`);
        if (!res.ok) return false;
        const { candidatas = [] } = await res.json();
        const ya = new Set(estado.candidatas.map((c) => c.id));
        estado.candidatas.push(...candidatas.filter((c) => c?.id && !ya.has(c.id)));
        return true;
    } catch {
        return false;   // sin red: la sección no sale
    }
}

/** Rellena hasta cinco, pidiendo otra mezcla si las de la actual se acaban. */
async function llenar(pl) {
    const yo = estado;
    const enLista = new Set((pl.songs ?? []).map((s) => s?.videoId).filter(Boolean));
    const biblioteca = await LibraryModule.getLibrary();
    let lote = siguientes(yo.candidatas, { enLista, mostradas: yo.mostradas, biblioteca });
    while (lote.length < CUANTAS && yo.mezclas < MAX_MEZCLAS) {
        // Primero las semillas de partida; luego, otra canción de la lista
        const semilla = yo.semillas.find((s) => !yo.usadas.has(s)) ?? semillasDe(pl.songs, 1, { usadas: yo.usadas })[0];
        if (!semilla || !(await pedirMezcla(semilla)) || estado !== yo) break;
        lote = siguientes(yo.candidatas, { enLista, mostradas: yo.mostradas, biblioteca });
    }
    if (estado !== yo) return;
    for (const s of lote) yo.mostradas.add(s.videoId);
    yo.visibles = lote;
    pintar();
}

const ICONO_NOTA = seguro('<svg class="music-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>');
const ICONO_PAUSA = seguro('<svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>');

function pintar() {
    const seccion = $('plRecomendadas');
    const filas = $('plRecomendadasLista');
    if (!seccion || !filas) return;
    seccion.hidden = !estado?.visibles.length;
    if (seccion.hidden) return;
    filas.innerHTML = html`${estado.visibles.map((s) => {
        const { titulo, artista } = nombreDe(s);
        const anadida = estado.anadidas.has(s.videoId);
        return html`<div class="rec-fila" data-video="${s.videoId}">
            <img class="rec-caratula" src="${s.thumbnail || 'favicon.png'}" alt="" width="44" height="44" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
            <span class="rec-textos"><span class="rec-titulo">${titulo}</span><span class="rec-artista">${artista}</span></span>
            <button type="button" class="rec-boton rec-escuchar" data-accion="escuchar" title="${i18n.t('t_preview')}" aria-label="${i18n.t('t_preview')}">${ICONO_NOTA}${ICONO_PAUSA}</button>
            <button type="button" class="rec-boton rec-anadir" data-accion="anadir" ${anadida ? 'disabled' : ''}
                aria-label="${i18n.t(anadida ? 'pl_rec_added' : 'pl_rec_add')}" title="${i18n.t(anadida ? 'pl_rec_added' : 'pl_rec_add')}">
                <span class="material-symbols-outlined" aria-hidden="true">${anadida ? 'check' : 'add'}</span>
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
    if (s.src && !s.radio && !s.nube) return s;
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
    $('plRecomendadasOtras')?.addEventListener('click', () => { if (estado?.pl) llenar(estado.pl); });
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
            id: pl.id, pl, semillas: semillas ?? semillasDe(pl.songs, 1),
            candidatas: [], mostradas: new Set(), usadas: new Set(), mezclas: 0, visibles: [], anadidas: new Set(),
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
