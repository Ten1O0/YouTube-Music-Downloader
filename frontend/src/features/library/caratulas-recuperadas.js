/**
 * Recuperar la carátula real de las canciones que no tienen (plan 27, T4).
 *
 * Las canciones viejas importadas del móvil suelen llegar sin carátula. Lo
 * decidió el usuario: un solo intento por canción, solo en las que no tienen
 * ninguna, y lo que no se encuentra se queda así (con la portada generada) sin
 * volver a buscarlo nunca.
 *
 * a) Con su id de YouTube, la carátula sale de él sin buscar nada: se pide la
 *    miniatura una vez. En la APK se guarda como fichero, para verla sin
 *    conexión; en la web, el enlace. Un vídeo borrado da 404: intentada y no
 *    encontrada. Un fallo de red no gasta el intento.
 * b) Sin id, el buscador (una vez por canción, una cada 6 s y como mucho 60 por
 *    sesión) lo busca por título, artista y duración. Si lo encuentra, la
 *    reparación de identidades le da el id y después pasa por a).
 *
 * Se carga aparte (presupuesto de arranque del plan 19): desde main.js al
 * arrancar y desde la sincronización.
 */

import { apiBase, isNative } from '../../config/env.js';
import { claveDe, guardarMiniaturaNativa, miniaturaDeYoutube } from '../../core/miniaturas.js';
import { StorageModule } from '../../core/storage.js';
import { esperarTurno, PRIORIDAD } from '../../ui/tareas.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { esVideoId } from '../sync/validar.js';
import { datosParaCoincidir, idDeResultados, pendientesDeCaratula, ponerCaratula, tieneCaratula } from './caratulas-modelo.js';
import { LibraryModule } from './library.js';

/** { [src]: fecha } de las canciones cuya carátula ya se intentó. */
const CLAVE_CARATULAS = 'ytdl_caratulas_intentadas';
/** { [src]: fecha } de las canciones que ya se buscaron por título (desde el plan 13). */
const CLAVE_BUSCADAS = 'sync_ids_buscados';
/** Cada cuántas carátulas se guarda: si se cierra la app a medias, no se repite lo hecho. */
const GUARDAR_CADA = 10;
/** Hasta cuántas canciones se rehacen fila a fila; con más, la lista entera una vez. */
const FILAS_SUELTAS = 5;
/** Entre una miniatura y otra: es i.ytimg.com, no el servidor, pero sin prisa. */
const PAUSA_CARATULA = 300;
/** Entre búsqueda y búsqueda: el buscador admite 20 por minuto. */
const PAUSA_BUSQUEDA = 6_000;
export const MAX_BUSQUEDAS_POR_SESION = 60;

const leer = async (clave) => (await StorageModule.get(clave).catch(() => null)) || {};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const sinRed = () => globalThis.navigator?.onLine === false;

/** El blob de una imagen, en base64. */
function aDataUrl(blob) {
    return new Promise((ok, mal) => {
        const lector = new FileReader();
        lector.onload = () => ok(lector.result);
        lector.onerror = () => mal(lector.error);
        lector.readAsDataURL(blob);
    });
}

/**
 * La carátula de YouTube de una canción: los campos para guardarla, o null si
 * el vídeo ya no existe o no se pudo guardar (cuenta como intentada). Lanza
 * solo si no hay red, para no gastar el intento.
 */
async function caratulaDeYoutube(song) {
    const url = miniaturaDeYoutube(song.videoId);
    const res = await fetch(url);
    if (!res.ok) return null;
    if (!isNative()) return { thumbnail: url };
    try {
        return await guardarMiniaturaNativa(claveDe(song, 'yt'), await aDataUrl(await res.blob()));
    } catch (e) {
        console.warn('[Carátulas] No se pudo guardar:', e?.message ?? e);
        return null;
    }
}

/** Guarda lo encontrado en la biblioteca y en las copias de las listas, leyéndolas en el momento. */
async function guardar(encontradas) {
    if (!encontradas.size) return;
    const biblioteca = await LibraryModule.getLibrary();
    const listas = await getPlaylists();
    let enListas = 0;
    for (const [src, campos] of encontradas) {
        ponerCaratula(biblioteca, src, campos);
        for (const pl of listas) enListas += ponerCaratula(pl.songs, src, campos);
    }
    await LibraryModule.saveLibrary(biblioteca);
    if (enListas) await savePlaylists(listas);
}

/** A la vista, una vez y con turno: las filas sueltas, o la lista entera si son muchas. */
async function repintar(srcs) {
    await esperarTurno(PRIORIDAD.baja);
    if (srcs.length > FILAS_SUELTAS) await LibraryModule.render({ animar: false });
    else for (const src of srcs) await LibraryModule.renderFila(src);
    await PlaylistModule.renderGrid();
}

let enMarcha = null;
let otraVez = false;

/**
 * a) Las canciones sin carátula que ya tienen su id: una vez cada una. Si ya
 * hay una pasada en marcha, se da otra al terminar (llega un id nuevo).
 */
export function recuperarCaratulas() {
    if (enMarcha) { otraVez = true; return enMarcha; }
    enMarcha = pasada()
        .catch((e) => console.warn('[Carátulas]', e?.message ?? e))
        .finally(() => {
            enMarcha = null;
            if (otraVez) { otraVez = false; recuperarCaratulas(); }
        });
    return enMarcha;
}

async function pasada() {
    const intentadas = await leer(CLAVE_CARATULAS);
    const pendientes = pendientesDeCaratula(await LibraryModule.getLibrary(), intentadas);
    const encontradas = new Map();
    const tocadas = [];
    for (const song of pendientes) {
        if (sinRed()) break;
        await esperarTurno(PRIORIDAD.baja);
        let campos;
        try {
            campos = await caratulaDeYoutube(song);
        } catch (e) {
            console.debug('[Carátulas] Sin red, se deja para otro día:', e?.message ?? e);
            break;
        }
        intentadas[song.src] = Date.now();
        if (campos?.thumbnail) { encontradas.set(song.src, campos); tocadas.push(song.src); }
        if (encontradas.size >= GUARDAR_CADA) { await guardar(encontradas); encontradas.clear(); }
        await StorageModule.set(CLAVE_CARATULAS, intentadas).catch(() => {});
        await esperar(PAUSA_CARATULA);
    }
    await guardar(encontradas);
    if (tocadas.length) await repintar(tocadas);
}

/** Del buscador, el id de esa canción por título, artista y duración. Apunta antes que es la única vez. */
async function buscarId(song, buscadas) {
    buscadas[song.src] = Date.now();
    await StorageModule.set(CLAVE_BUSCADAS, buscadas).catch(() => {});
    const res = await fetch(`${apiBase()}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: String(song.title).slice(0, 200) }),
    });
    if (!res.ok) return null;
    return idDeResultados(song.title, (await res.json()).results, datosParaCoincidir(song));
}

let busquedasEnSesion = 0;

/**
 * b) Lo que ni la canción ni el historial saben, por el buscador, en segundo
 * plano. Con cuenta, toda canción sin id (el id es lo que la sincroniza); sin
 * cuenta, solo las que además no tienen carátula. `reparar(Map src → id)` es la
 * reparación de identidades de la sincronización; lo reparado pasa después por
 * a). Quien llama evita dos a la vez.
 */
export async function buscarPendientes({ conCuenta, reparar }) {
    const buscadas = await leer(CLAVE_BUSCADAS);
    const sinId = (await LibraryModule.getLibrary()).filter((s) => s?.src && !s.nube && !esVideoId(s.videoId)
        && String(s.title ?? '').trim().length >= 2 && (conCuenta || !tieneCaratula(s)));
    for (const song of sinId) {
        if (busquedasEnSesion >= MAX_BUSQUEDAS_POR_SESION || sinRed()) break;
        if (document.visibilityState !== 'visible' || buscadas[song.src]) continue;
        await esperarTurno(PRIORIDAD.baja);
        busquedasEnSesion++;
        const id = await buscarId(song, buscadas).catch(() => null);
        if (id) await reparar(new Map([[song.src, id]]));
        await esperar(PAUSA_BUSQUEDA);
    }
}
