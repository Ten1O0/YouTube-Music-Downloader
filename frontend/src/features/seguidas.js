/**
 * Listas de YouTube que se siguen (plan 14, T4): las reglas, sin DOM ni red.
 * Se prueban en Node (test/frontend/test_seguidas.mjs); follows.js las usa.
 */

import { isNative } from '../config/env.js';
import { completarMetadatos } from '../core/titles.js';
import { cancionEnLaNube } from './sync/fusion.js';
import { LIMITES } from './sync/limites.js';

/** Sin sesión, cada lista se comprueba como mucho cada 6 horas (con sesión lo hace el servidor). */
export const CADA_MS = 6 * 60 * 60 * 1000;
/** Al seguir una lista con más canciones nuevas que esto, se pregunta antes de bajarlas todas. */
export const PREGUNTAR_DESDE = 50;
/** Como el servidor: una lista más larga no se puede seguir. */
export const MAX_CANCIONES_AL_SEGUIR = 500;
export const AJUSTES_SEGUIMIENTO = Object.freeze({ auto: true, soloWifi: true });

const RE_LISTA = /^[A-Za-z0-9_-]{10,64}$/;
const RE_VIDEO = /^[A-Za-z0-9_-]{11}$/;

/** El id de una lista que se puede seguir (las mezclas RD… no), o null. Como `lista_de` del servidor. */
export function listaDe(texto) {
    if (typeof texto !== 'string') return null;
    const m = /[?&]list=([A-Za-z0-9_-]+)/.exec(texto);
    const id = m ? m[1] : texto.trim();
    return RE_LISTA.test(id) && !id.startsWith('RD') ? id : null;
}

/** ¿Se puede descargar solo ahora? En la web, siempre; en la APK, según el Wi-Fi si así se eligió. */
export function puedeDescargarSolo(ajustes, conexion = globalThis.navigator?.connection, nativo = isNative()) {
    if (!ajustes?.auto) return false;
    if (!nativo || !ajustes.soloWifi) return true;
    // Sin la API de conexión no se sabe: mejor no gastar datos
    return ['wifi', 'ethernet'].includes(conexion?.type);
}

/** Una canción de YouTube (del selector, del servidor) con la forma de una canción de la lista seguida. */
export function cancionDeLista(v) {
    const videoId = v?.videoId ?? v?.id;
    if (typeof videoId !== 'string' || !RE_VIDEO.test(videoId)) return null;
    const duracion = Number(v.duration);
    return {
        videoId,
        title: String(v.title ?? '').slice(0, LIMITES.titulo),
        channel: String(v.channel ?? '').slice(0, LIMITES.canal),
        duration: Number.isFinite(duracion) && duracion >= 0 && duracion <= LIMITES.duracion ? Math.trunc(duracion) : 0,
    };
}

/** Las que no se habían visto aún, sin repetir. */
export function nuevasDe(canciones, vistas) {
    const ya = new Set(vistas ?? []);
    const nuevas = [];
    for (const c of canciones ?? []) {
        const cancion = cancionDeLista(c);
        if (!cancion || ya.has(cancion.videoId)) continue;
        ya.add(cancion.videoId);
        nuevas.push(cancion);
    }
    return nuevas;
}

/** ¿Toca comprobarla ya (sin sesión)? */
export const tocaComprobar = (seguida, ahora = Date.now(), forzar = false) => forzar || ahora - (seguida?.comprobada ?? 0) >= CADA_MS;

/**
 * Añade canciones de una lista seguida a la biblioteca (en la nube, si no
 * están) y a su lista vinculada, sin repetir ninguna. Lo que ya estaba en la
 * lista vinculada se queda: lo que se borra en YouTube no se borra aquí.
 * @returns {{ biblioteca: object[], listas: object[], nuevasEnNube: object[], anadidas: number }}
 */
export function incorporar({ biblioteca, listas }, localPlaylistId, canciones, ahora = new Date().toISOString()) {
    const lib = [...(biblioteca ?? [])];
    const porId = new Map(lib.filter((s) => s?.videoId).map((s) => [s.videoId, s]));
    const validas = (canciones ?? []).map(cancionDeLista).filter(Boolean);
    const nuevasEnNube = [];
    for (const c of validas) {
        if (porId.has(c.videoId) || lib.length >= LIMITES.cancionesCuenta) continue;
        // Artista y canción se deducen del título, como en cualquier descarga
        const enNube = completarMetadatos(Object.fromEntries(Object.entries(cancionEnLaNube({
            ...c, editado: false, addedAt: ahora,
        })).filter(([, v]) => v !== undefined)));
        lib.unshift(enNube);
        porId.set(c.videoId, enNube);
        nuevasEnNube.push(enNube);
    }
    let anadidas = 0;
    const nuevasListas = (listas ?? []).map((pl) => {
        if (pl.id !== localPlaylistId) return pl;
        const ya = new Set((pl.songs ?? []).map((s) => s.videoId));
        const extra = [];
        for (const c of validas) {
            if (ya.has(c.videoId) || !porId.has(c.videoId)) continue;
            ya.add(c.videoId);
            extra.push({ ...porId.get(c.videoId) });
        }
        const songs = [...(pl.songs ?? []), ...extra].slice(0, LIMITES.cancionesLista);
        anadidas = songs.length - (pl.songs ?? []).length;
        return { ...pl, songs };
    });
    return { biblioteca: lib, listas: nuevasListas, nuevasEnNube, anadidas };
}

/** La lista propia que queda vinculada a una de YouTube. */
export function listaVinculada({ id, nombre, listId, ahora = new Date().toISOString() }) {
    return {
        id, name: nombre, description: '', songs: [], createdAt: ahora,
        origen: { tipo: 'youtube', lista: listId },
    };
}

/** ¿Está vinculada a una lista de YouTube? */
export const esSeguida = (pl) => pl?.origen?.tipo === 'youtube' && typeof pl.origen.lista === 'string';

/** La lista sin su vínculo: queda como una lista normal, con lo que ya tenía. */
export function sinVinculo(pl) {
    const resto = { ...pl };
    delete resto.origen;
    return resto;
}
