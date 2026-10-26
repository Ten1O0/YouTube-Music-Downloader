/**
 * Escuchar desde la nube (plan 29, T1-T3).
 *
 * Una canción de la cola que no está descargada (`nube`) suena como la radio:
 * se descarga en silencio a la caché temporal de la radio (radio/cache.js) y
 * suena desde ahí. Mientras suena una, se preparan unas pocas de la nube por
 * delante (POR_DELANTE, nunca la lista entera) y, en cuanto están listas,
 * pasan a la cola con su audio: suenan al momento. En el Vivo, prepararla lleva
 * unos 15 s (T0).
 *
 * La caché no suelta la que suena ni las preparadas por delante. Si una no se
 * puede preparar (sin conexión, «solo con Wi-Fi» con datos, un fallo), se
 * salta con un aviso; si fallan varias seguidas, se para en vez de recorrer la
 * lista entera.
 *
 * Se carga aparte (nube/puente.js), solo si la cola tiene canciones de la nube.
 */

import { caratulaDe } from '../../core/portada-generada.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisar } from '../../ui/toast.js';
import { descargarEnSilencio } from '../download/download.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { ajustesReproduccion } from '../player/settings.js';
import { updatePlayerUI } from '../player/ui.js';
import { aBiblioteca, enCache, guardarEnCache, protegerCon } from '../radio/cache.js';
import { guardarDeRadio } from '../radio/puente.js';
import { redMovil } from '../radio/red.js';
import { descargarDeLaNube } from '../sync/nube.js';
import { prepararPorDelante } from './modelo.js';
import { textoEscuchar } from './textos-escuchar.js';
import { textoTuyo } from './textos-tuyo.js';
import estilos from './escuchar.css?inline';

/** Cuántas de la nube se preparan por delante de la que suena. */
export const POR_DELANTE = 3;
/** Tras tantas seguidas sin poder prepararse, se deja de saltar. */
const FALLOS_SEGUIDOS = 3;

/** videoId → promesa de la canción ya preparada (o null si no se pudo). */
const enCamino = new Map();
/** videoId de lo que no se puede soltar de la caché: lo que suena y lo preparado por delante. */
let protegidas = new Set();
let fallos = 0;
const suscritos = new Set();

protegerCon(() => protegidas);

// Los estilos de la T3, en el documento al cargarse (como texto: con un import
// de CSS, el código de arranque crecía con la lista de ficheros a precargar)
document.head?.append(Object.assign(document.createElement('style'), { textContent: estilos }));

// «Guardar» del reproductor, también para las preparadas desde la nube (los de la
// radio los atiende radio/puente.js)
for (const id of ['playerBarRadioSave', 'fullPlayerRadioSave']) {
    const boton = document.getElementById(id);
    boton?.addEventListener('click', (e) => {
        const actual = PlayerModule.cancionActual();
        if (!actual?.desdeNube) return;
        e.stopImmediatePropagation();
        boton.disabled = true;
        guardar(actual).catch(() => { boton.disabled = false; });
    }, true);
}

const t = (clave, n) => textoEscuchar(clave, i18n.currentLang, n);

/** Lo que cambia (cuántas se preparan): para la T3. */
export function alCambiar(fn) {
    suscritos.add(fn);
    return () => suscritos.delete(fn);
}
const notificar = () => suscritos.forEach((fn) => fn({ preparando: [...enCamino.keys()] }));

/**
 * La canción de la nube, ya en la caché, lista para sonar: con lo de la
 * cuenta (nombre editado, portada…) y el audio de la caché.
 */
export function cancionPreparada(deLaNube, enLaCache) {
    const lista = { ...deLaNube, src: enLaCache.src, desdeNube: true };
    delete lista.nube;
    if (enLaCache.localPath) lista.localPath = enLaCache.localPath;
    if (enLaCache.loudness) lista.loudness = enLaCache.loudness;
    if (!lista.duration && enLaCache.duration) lista.duration = enLaCache.duration;
    return lista;
}

/** ¿Se puede descargar ahora? Igual que la radio: con conexión y respetando «solo con Wi-Fi». */
async function sePuede() {
    if (navigator.onLine === false) return { si: false, texto: textoTuyo('noSePuede') };
    const movil = await redMovil().catch(() => false);
    if (movil && ajustesReproduccion().radioSoloWifi) return { si: false, texto: t('soloWifi') };
    return { si: true };
}

/** Prepara una de la nube (una sola vez aunque se pida varias): la canción lista, o null. */
function preparar(song) {
    const id = song.videoId;
    if (enCamino.has(id)) return enCamino.get(id);
    const promesa = (async () => {
        const ya = (await enCache()).find((s) => s.videoId === id);
        if (ya) return cancionPreparada(song, ya);
        const puede = await sePuede();
        if (!puede.si) throw Object.assign(new Error('no se puede'), { texto: puede.texto });
        const url = `https://www.youtube.com/watch?v=${id}`;
        const d = await descargarEnSilencio(url);
        const info = { videoId: id, title: song.title, channel: song.channel, thumbnail: song.thumbnail, duration: song.duration };
        return cancionPreparada(song, await guardarEnCache({ ...d, url, videoInfo: info }));
    })().finally(() => {
        enCamino.delete(id);
        notificar();
    });
    enCamino.set(id, promesa);
    notificar();
    return promesa;
}

/** Una preparada que la caché soltó, otra vez en la nube (para volver a prepararla). */
function alaNube(song) {
    const otra = { ...song, src: `nube://${song.videoId}`, nube: true };
    delete otra.desdeNube;
    delete otra.localPath;
    return otra;
}

/** En la cola, la de la nube pasa a ser la preparada (con su audio): sonará al momento. */
function aLaCola(deLaNube, lista, srcEnLaCola = deLaNube.src) {
    protegidas.add(lista.videoId);
    PlayerModule.actualizarCancion(srcEnLaCola, lista);
    marcarPreparada(lista.videoId);
}

/** En las filas que se ven, la marca de «ya preparada» (T3). */
function marcarPreparada(videoId) {
    for (const fila of document.querySelectorAll(`.library-item[data-src="nube://${videoId}"]`)) fila.classList.add('nube-preparada');
}

/**
 * Mientras se prepara la que se pidió (T3): lo que sonaba se pausa, el mini
 * reproductor ya enseña la canción, los botones de reproducir giran y, en la
 * lista abierta, se dice qué pasa. `primera`: no sonaba nada (una lista solo
 * de nube que empieza).
 */
function esperando(song, si, primera = false) {
    document.documentElement.toggleAttribute('data-preparando-nube', si);
    document.querySelector('.nube-preparando')?.remove();
    if (!si) return;
    PlayerModule.pause();
    PlayerModule.showBar();
    updatePlayerUI(song, caratulaDe(song));
    const lista = document.getElementById('playlistDetailView');
    const botones = lista?.querySelector('.lista-botones');
    if (!botones || lista.classList.contains('hidden')) return;
    const aviso = document.createElement('div');
    aviso.className = 'nube-preparando';
    aviso.setAttribute('role', 'status');
    aviso.textContent = t(primera ? 'primera' : 'preparando');
    const barra = document.createElement('div');
    barra.className = 'nube-preparando-barra';
    aviso.append(barra);
    botones.after(aviso);
}

/**
 * Con cada canción que empieza: prepara las siguientes de la nube de la cola.
 * Con «repetir todo», la cola da la vuelta.
 */
export async function revisar(cola, indice, repetir) {
    // Las ya preparadas que la caché soltó (con «repetir todo», al dar la vuelta) vuelven a la nube
    const enLaCache = new Set((await enCache()).map((s) => s.videoId));
    const vista = cola.map((s) => (s?.desdeNube && !enLaCache.has(s.videoId) ? alaNube(s) : s));
    const siguientes = prepararPorDelante(vista, indice, { cuantas: POR_DELANTE, repetir });
    const actual = cola[indice];
    protegidas = new Set([actual?.videoId, ...siguientes.map((s) => s.videoId),
        ...prepararPorDelante(cola.map((s) => (s?.desdeNube ? { ...s, nube: true } : s)), indice, { cuantas: POR_DELANTE, repetir }).map((s) => s.videoId)]
        .filter(Boolean));
    // De una en una: cada una es una descarga entera en la nube
    (async () => {
        for (const song of siguientes) {
            try {
                // En la cola sigue con su src de antes (el de la caché, si se soltó)
                const enLaCola = cola.find((s) => s?.videoId === song.videoId);
                aLaCola(song, await preparar(song), enLaCola?.src);
            } catch (e) {
                console.warn('[Nube] No se pudo preparar', song.videoId, e);
                break;
            }
        }
    })();
}

/**
 * La que el reproductor va a tocar y está en la nube: se prepara (con la T3
 * enseñándolo) y se devuelve lista para sonar. null si no se puede (se avisa
 * y se salta) o si mientras tanto se pasó a otra.
 */
export async function sonar(song) {
    const objetivo = song.desdeNube ? alaNube(song) : song;
    const yaLista = (await enCache()).some((s) => s.videoId === song.videoId);
    // Lo que se ve mientras tanto, solo si hay que esperar (unos 15 s en el Vivo)
    if (!yaLista) esperando(objetivo, true, document.getElementById('mainAudio')?.paused !== false);
    try {
        const lista = await preparar(objetivo);
        fallos = 0;
        aLaCola(song, lista);
        const actual = PlayerModule.cancionActual();
        // Mientras se preparaba, se eligió otra
        if (actual && actual.videoId !== song.videoId) return null;
        avisarQueSuena(lista);
        return lista;
    } catch (e) {
        avisar(e?.texto || textoTuyo('noSePuede'));
        if (++fallos < FALLOS_SEGUIDOS) setTimeout(() => PlayerModule.next(), 0);
        else fallos = 0;
        return null;
    } finally {
        if (!yaLista) esperando(objetivo, false);
    }
}

let tuyo = null;
/** Para lo que anima a descargar (T5-T7, nube/tuyo.js): empieza a sonar una desde la nube. */
export async function avisarQueSuena(song) {
    try {
        tuyo ??= import('./tuyo.js');
        await tuyo;
    } catch (e) {
        tuyo = null;
        console.warn('[Nube]', e);
    }
    // La marca del reproductor dice de dónde viene
    const marca = song?.radio ? i18n.t('radio_title') : t('desdeLaNube');
    document.querySelectorAll('[data-radio-marca]').forEach((el) => { el.textContent = marca; });
    document.dispatchEvent(new CustomEvent('suena-desde-la-nube', { detail: song }));
}

/**
 * «Guardar»: a la biblioteca, para que sea tuya. De la radio, como siempre; ya
 * preparada, sin volver a descargarla; si aún no se preparó, se descarga.
 */
export async function guardar(song) {
    if (!song?.videoId) return;
    if (song.radio) return guardarDeRadio(song);
    if (song.desdeNube) {
        const nueva = await aBiblioteca(song.videoId);
        if (nueva) {
            // Ya con su audio en la biblioteca, y la portada elegida si la tenía. La
            // marca a false (no basta con quitarla: el reproductor fusiona con la de antes)
            const guardada = { ...nueva, desdeNube: false, ...(song.portada ? { portada: song.portada } : {}) };
            PlayerModule.actualizarCancion(song.src, guardada);
            avisar(textoTuyo('guardada'));
            return alDia();
        }
    }
    await descargarDeLaNube({ ...song, src: `nube://${song.videoId}`, nube: true }, { reproducir: false });
    return alDia();
}

/** Tras guardar: sus copias de las listas dejan de estar en la nube, también en la lista abierta. */
async function alDia() {
    await LibraryModule.sacarDeLaNubeEnListas().catch(() => 0);
    if (PlaylistModule.currentPlaylistId) await PlaylistModule.openPlaylistDetail(PlaylistModule.currentPlaylistId).catch(() => {});
}
