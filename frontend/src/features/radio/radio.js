/**
 * Modo radio (plan 16, T4): cuando la cola se acaba, la música sigue con
 * canciones parecidas a la última, sacadas de la mezcla que YouTube genera
 * para cada canción (GET /api/radio).
 *
 * Mantiene una ventana de canciones listas por delante (§2.3): 3 normalmente
 * y 6 si se salta deprisa, que se llena cuando a la cola le queda una, con un
 * lote (una sola petición), y se repone de una en una con cada canción que
 * suena o se salta. Lo que no está en la biblioteca se descarga en silencio a
 * la caché de radio (cache.js); lo que ya está, suena tal cual.
 *
 * El reproductor se conecta a través del puente (puente.js), que carga este
 * módulo solo cuando la radio se enciende: la radio no importa el reproductor
 * (sería un ciclo), solo le pide que reproduzca, salte o cambie una canción.
 */

import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { esIdYoutube } from '../../core/utils.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisar } from '../../ui/toast.js';
import { descargarEnSilencio, downloadFromUrl } from '../download/download.js';
import { descargarLote } from '../download/lotes.js';
import { LibraryModule } from '../library/library.js';
import { ajustesReproduccion, alCambiarAjustes, cambiarAjustes } from '../player/settings.js';
import { aBiblioteca, guardarEnCache, protegerCon, recortarCache, vaciarCache } from './cache.js';
import { claveArtista, elegir, ventana } from './pick.js';
import { redMovil } from './red.js';

const CLAVE_VETADAS = 'radio_vetadas';
const MAX_VETADAS = 500;
/** Tras un «demasiadas peticiones» del servidor, no se insiste en este rato. */
const PAUSA_LIMITE_MS = 60_000;
/** Tras un fallo de descarga, se reintenta llenar la ventana pasado este rato. */
const REINTENTO_MS = 5_000;

let jugador = null;
const suscritos = new Set();
let vetadas = new Set();

const nuevoEstado = () => ({
    semilla: null,          // la canción con la que empezó
    ultimaEntera: null,     // la última de la radio escuchada entera
    turnoSemilla: 0,        // para alternar entre las dos al pedir mezclas
    mezclas: new Set(),     // semillas ya pedidas en esta radio
    candidatas: [],
    listas: [],             // listas para sonar, en el orden en que terminaron
    enCurso: new Map(),     // videoId -> { guardar: boolean } mientras se descarga
    sonadas: new Set(),
    artistas: [],           // claves de artista de lo que ha sonado, en orden (plan 25)
    ultimaApuntada: null,
    deRadio: new Set(),     // src de lo que dio la radio (también si era de la biblioteca)
    saltos: [],
    pausaHasta: 0,
    motivoPausa: 'radio_preparing',
    esperando: false,
    llenando: false,
});
let estado = nuevoEstado();

const radioActiva = () => ajustesReproduccion().radio === true;

/** Lo que la hoja de la cola necesita pintar. */
function estadoRadio() {
    return { activa: radioActiva(), listas: [...estado.listas], preparando: estado.enCurso.size, esperando: estado.esperando };
}

/** Avisa de cualquier cambio (la hoja de la cola se repinta). */
function alCambiarRadio(fn) {
    suscritos.add(fn);
}
function notificar() {
    for (const fn of suscritos) {
        try { fn(estadoRadio()); } catch (e) { console.error('[Radio]', e); }
    }
}

/**
 * @param {{ reproducir: (song) => void, saltar: () => void, actual: () => object|null,
 *   actualizarCancion: (src, nueva) => void, revisar: () => void, soloEsta: () => void }} j
 */
function conectarRadio(j) {
    jugador = j;
}

/** ¿Es de la radio? (una descargada a la caché o una de la biblioteca que eligió la radio) */
const esDeRadio = (song) => Boolean(song?.radio || (song?.src && estado.deRadio.has(song.src)));

// ── Pedir la mezcla ──

// Lo que el servidor contesta cuando hay que parar (plan 21, T7), y qué se dice
const AVISO_DE_LIMITE = { youtube_limit: 'err_youtube_limit', server_busy: 'err_server_busy', hour_limit: 'err_hour_limit' };

/** ¿Hay que dejar de bajar un rato? 429 de los topes, o YouTube limitando al servidor (503). */
function frenarSi(status, code) {
    if (status !== 429 && !AVISO_DE_LIMITE[code]) return;
    estado.pausaHasta = Date.now() + PAUSA_LIMITE_MS;
    estado.motivoPausa = AVISO_DE_LIMITE[code] || 'radio_preparing';
}

async function pedirMezcla() {
    // En pausa por un límite no se pregunta: el servidor diría lo mismo
    if (Date.now() < estado.pausaHasta) return false;
    const opciones = [estado.semilla, estado.ultimaEntera].filter((s) => esIdYoutube(s) && !estado.mezclas.has(s));
    if (!opciones.length) return false;
    // Alternando entre la de partida y la última escuchada entera: no se aleja demasiado
    const semilla = opciones[estado.turnoSemilla++ % opciones.length];
    estado.mezclas.add(semilla);
    try {
        const res = await fetch(`${apiBase()}/api/radio?semilla=${encodeURIComponent(semilla)}`);
        if (!res.ok) {
            frenarSi(res.status, (await res.json().catch(() => ({}))).code);
            // Por un límite, la semilla se podrá pedir otra vez al acabar la pausa
            if (Date.now() < estado.pausaHasta) estado.mezclas.delete(semilla);
            return false;
        }
        const { candidatas = [] } = await res.json();
        const ya = new Set(estado.candidatas.map((c) => c.id));
        estado.candidatas.push(...candidatas.filter((c) => c?.id && !ya.has(c.id)));
        return candidatas.length > 0;
    } catch {
        // Sin red: también se podrá volver a pedir
        estado.mezclas.delete(semilla);
        return false;
    }
}

/** Lo que no puede volver a elegirse: lo que ya sonó, lo listo y lo que baja. */
const excluidas = () => new Set([...estado.sonadas, ...estado.listas.map((s) => s.videoId), ...estado.enCurso.keys()]);

/** El artista de lo que suena, para repartir (plan 25). Una vez por canción. */
function apuntarArtista(song) {
    if (!song?.videoId || song.videoId === estado.ultimaApuntada) return;
    estado.ultimaApuntada = song.videoId;
    const artista = claveArtista(song);
    if (artista) estado.artistas.push(artista);
}

/**
 * Repartidas entre artistas (plan 25): los que han sonado en esta radio son los
 * conocidos, y lo último que ha sonado, lo listo y lo que baja cuenta para no
 * pasar de dos del mismo seguidos.
 */
function reparto() {
    return {
        conocidos: new Set(estado.artistas),
        recientes: [
            ...estado.artistas.slice(-3),
            ...estado.listas.map(claveArtista),
            ...[...estado.enCurso.values()].map((v) => v.artista),
        ].filter(Boolean),
    };
}

async function elegirMas(n) {
    const biblioteca = await LibraryModule.getLibrary();
    let elegidas = elegir(estado.candidatas, { sonadas: excluidas(), vetadas, biblioteca, n, ...reparto() });
    // Se acaban las de esta mezcla: otra, de la otra semilla
    while (elegidas.length < n && await pedirMezcla()) {
        elegidas = elegir(estado.candidatas, { sonadas: excluidas(), vetadas, biblioteca, n, ...reparto() });
    }
    return elegidas;
}

// ── Llenar la ventana ──

/** ¿Puede bajar algo ahora? Y si no, por qué (para avisar al esperar). */
async function puedeBajar() {
    if (globalThis.navigator?.onLine === false) return { si: false, motivo: 'radio_offline' };
    const movil = await redMovil().catch(() => false);
    if (movil && ajustesReproduccion().radioSoloWifi) return { si: false, motivo: 'radio_wifi', movil };
    if (Date.now() < estado.pausaHasta) return { si: false, motivo: estado.motivoPausa, movil };
    return { si: true, movil };
}

async function llenar() {
    if (!radioActiva() || estado.llenando || !estado.semilla) return;
    estado.llenando = true;
    try {
        const red = await puedeBajar();
        const objetivo = ventana({ saltos: estado.saltos, redMovil: Boolean(red.movil) });
        const faltan = objetivo - estado.listas.length - estado.enCurso.size;
        if (faltan <= 0) return;
        const elegidas = await elegirMas(faltan);
        // Lo que está en la biblioteca está listo ya; lo demás se baja si se puede
        const remotas = [];
        for (const s of elegidas) {
            if (s.radio) remotas.push(s);
            else llega(s);
        }
        if (!red.si || !remotas.length) return;
        for (const s of remotas) estado.enCurso.set(s.videoId, { guardar: false, artista: claveArtista(s) });
        notificar();
        if (remotas.length > 1) bajarEnLote(remotas);
        else bajarSuelta(remotas[0]);
    } finally {
        estado.llenando = false;
    }
}

/** Varias a la vez: un lote, una sola petición, de 3 en 3 en el servidor. */
async function bajarEnLote(canciones) {
    const r = await descargarLote(canciones, {
        silencioso: true,
        // Sin lanzar nunca: una que no se pudo guardar no deja el lote esperándola
        recoger: async (d) => {
            try { llega(await guardarEnCache(d)); } catch (e) { console.warn('[Radio] No se pudo guardar en la caché', e); }
        },
    });
    for (const s of canciones) if (estado.enCurso.has(s.videoId)) estado.enCurso.delete(s.videoId);
    frenarSi(r.status, r.code);
    tras(r.error || r.fallidas?.length);
}

/** Reponer una: una descarga suelta. */
async function bajarSuelta(cancion) {
    let fallo = false;
    try {
        const d = await descargarEnSilencio(`https://www.youtube.com/watch?v=${cancion.videoId}`);
        llega(await guardarEnCache({ ...d, url: `https://www.youtube.com/watch?v=${cancion.videoId}`, videoInfo: cancion }));
    } catch (e) {
        fallo = true;
        frenarSi(e?.status, e?.code);
        console.warn('[Radio] No se pudo bajar', cancion.videoId, e);
    } finally {
        estado.enCurso.delete(cancion.videoId);
    }
    tras(fallo);
}

function tras(fallo) {
    notificar();
    if (estado.esperando && !estado.enCurso.size && !estado.listas.length) {
        // Esperando y ya no baja nada: se avisa en vez de quedarse callada, y con
        // el motivo si es un límite (YouTube, el servidor o el cupo de la hora)
        estado.esperando = false;
        avisar(i18n.t(Date.now() < estado.pausaHasta ? estado.motivoPausa : 'radio_unavailable'));
    }
    if (fallo) setTimeout(() => llenar(), REINTENTO_MS);
    else llenar();
}

/** Una canción lista (descargada o de la biblioteca). */
function llega(cancion) {
    if (!cancion?.videoId) return;
    const ctrl = estado.enCurso.get(cancion.videoId);
    estado.enCurso.delete(cancion.videoId);
    if (!radioActiva() || vetadas.has(cancion.videoId)) return;
    estado.deRadio.add(cancion.src);
    estado.listas.push(cancion);
    if (ctrl?.guardar) guardar(cancion);
    notificar();
    if (estado.esperando) {
        estado.esperando = false;
        jugador?.reproducir(tomar());
    }
}

// ── Lo que pide el reproductor ──

/**
 * Con cada canción: si a la cola le queda una (o ninguna), la radio se
 * prepara. La primera vez, la semilla es la que suena.
 */
function revisarRadio({ restantes, actual, repetir }) {
    if (!radioActiva() || repetir || restantes > 1) return;
    if (!estado.semilla && esIdYoutube(actual?.videoId)) estado.semilla = actual.videoId;
    if (actual?.videoId) estado.sonadas.add(actual.videoId);
    apuntarArtista(actual);
    llenar();
}

/** La que sonaría ahora, sin sacarla (para prepararla sin cortes o con fundido). */
function proximaDeRadio() {
    return radioActiva() ? estado.listas[0] ?? null : null;
}

/** Saca la siguiente: la primera que esté lista. Null si no hay ninguna. */
function tomar() {
    const s = estado.listas.shift() ?? null;
    if (s) {
        estado.sonadas.add(s.videoId);
        notificar();
        llenar();
    }
    return s;
}

/** El reproductor ya la puso por su cuenta (paso sin cortes): fuera de las listas. */
function consumir(song) {
    const i = estado.listas.findIndex((s) => s.src === song.src);
    if (i >= 0) estado.listas.splice(i, 1);
    if (song.videoId) estado.sonadas.add(song.videoId);
    notificar();
    llenar();
}

/**
 * Al acabar la cola sin nada listo: se espera avisando («Preparando la
 * radio…») y suena en cuanto llega algo. Si no se puede traer nada (sin
 * conexión, solo con Wi-Fi, sin mezcla), se dice por qué. Devuelve si espera.
 */
function esperarRadio(actual) {
    if (!radioActiva()) return false;
    if (!estado.semilla && esIdYoutube(actual?.videoId)) estado.semilla = actual.videoId;
    if (!estado.semilla) return false;
    estado.esperando = true;
    avisar(i18n.t('radio_preparing'));
    notificar();
    llenar().then(async () => {
        if (!estado.esperando) return;
        if (estado.listas.length) {
            estado.esperando = false;
            jugador?.reproducir(tomar());
        } else if (!estado.enCurso.size) {
            estado.esperando = false;
            const red = await puedeBajar();
            avisar(i18n.t(red.si ? 'radio_unavailable' : red.motivo));
            notificar();
        }
    });
    return true;
}

/** Se saltó una canción de la radio: si se salta deprisa, la ventana crece. */
function saltadaEnRadio(song, escuchado) {
    if (!radioActiva() || !esDeRadio(song)) return;
    estado.saltos.push({ en: Date.now(), escuchado });
    llenar();
}

/** Se escuchó entera: la ventana vuelve a lo normal y sirve de semilla. */
function terminadaEnRadio(song) {
    if (!esDeRadio(song)) return;
    estado.saltos = [];
    if (esIdYoutube(song.videoId)) estado.ultimaEntera = song.videoId;
}

/**
 * «Iniciar radio» desde la canción que suena: se queda sola en la cola (lo de
 * «a continuación» se respeta), la radio se enciende y empieza de nuevo con
 * ella de semilla.
 */
function iniciarRadio(song) {
    if (!esIdYoutube(song?.videoId)) {
        avisar(i18n.t('radio_unavailable'));
        return;
    }
    jugador?.soloEsta();
    estado = nuevoEstado();
    if (!radioActiva()) cambiarAjustes({ radio: true });
    estado.semilla = song.videoId;
    estado.sonadas.add(song.videoId);
    notificar();
    llenar();
}

// ── Guardar y vetar ──

/**
 * «Guardar»: a la biblioteca sin volver a descargarla (§2.5). Si aún se está
 * bajando, se guarda al terminar; si ya salió de la caché, se descarga como
 * una canción normal.
 */
async function guardar(song) {
    if (!song?.radio) return;
    if (estado.enCurso.has(song.videoId)) {
        estado.enCurso.get(song.videoId).guardar = true;
        avisar(i18n.t('radio_save_pending'));
        notificar();
        return;
    }
    const nueva = await aBiblioteca(song.videoId);
    if (!nueva) {
        downloadFromUrl(`https://www.youtube.com/watch?v=${song.videoId}`, song, null);
        return;
    }
    const guardada = { ...nueva, radio: false };
    estado.listas = estado.listas.map((s) => (s.src === song.src ? guardada : s));
    estado.deRadio.add(guardada.src);
    jugador?.actualizarCancion(song.src, guardada);
    avisar(i18n.t('radio_saved'));
    notificar();
}

/** «No me gusta»: fuera, y no vuelve (tampoco otras versiones de la misma canción). */
async function noMeGusta(song) {
    if (!song?.videoId) return;
    vetadas.add(song.videoId);
    const lista = [...vetadas].slice(-MAX_VETADAS);
    vetadas = new Set(lista);
    StorageModule.set(CLAVE_VETADAS, lista).catch(() => {});
    estado.listas = estado.listas.filter((s) => s.videoId !== song.videoId);
    if (jugador?.actual()?.src === song.src) jugador.saltar();
    notificar();
    llenar();
}

// ── Arranque ──

async function initRadio() {
    try { vetadas = new Set((await StorageModule.get(CLAVE_VETADAS)) || []); } catch { /* sin vetadas */ }
    // Lo que suena y lo que está listo no se borra de la caché
    protegerCon(() => new Set([jugador?.actual()?.videoId, ...estado.listas.map((s) => s.videoId)].filter(Boolean)));
    let estaba = radioActiva();
    alCambiarAjustes(() => {
        const ahora = radioActiva();
        if (estaba && !ahora) {
            // Apagada: se olvida todo (menos lo vetado) y la caché se vacía
            estado = nuevoEstado();
            vaciarCache().catch(() => {});
        }
        // Encendida con la cola ya en marcha: si le queda poco, se prepara ya
        if (!estaba && ahora) jugador?.revisar?.();
        estaba = ahora;
        notificar();
    });
    recortarCache().catch(() => {});
}

/** «Iniciar radio» en la pantalla completa: a partir de lo que suena. */
function iniciarDesdeActual() {
    const actual = jugador?.actual();
    iniciarRadio(actual);
    if (esIdYoutube(actual?.videoId)) avisar(i18n.t('radio_started'));
}

/**
 * Lo que usa el puente (puente.js), que es lo único que carga este módulo:
 * así la radio no pesa en el arranque (plan 19, T16) mientras está apagada.
 */
export const Radio = {
    init: initRadio, conectar: conectarRadio, alCambiar: alCambiarRadio, estado: estadoRadio, esDeRadio,
    revisar: revisarRadio, proxima: proximaDeRadio, tomar, consumir, esperar: esperarRadio,
    saltada: saltadaEnRadio, terminada: terminadaEnRadio, iniciarDesdeActual, guardar, noMeGusta,
};
