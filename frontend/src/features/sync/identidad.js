/**
 * Recuperar la identidad de las canciones antiguas (plan 13).
 *
 * Una canción solo viaja con la cuenta si tiene su id de YouTube. Las
 * descargadas pegando un enlace o buscando antes del 2026-09-27 se guardaron
 * con el id de la descarga: la sincronización las saltaba sin avisar, y en el
 * otro dispositivo la misma canción aparecía «en la nube» aunque aquí
 * estuviera descargada.
 *
 * Se recupera, de más a menos seguro: de la propia canción (la miniatura de
 * YouTube, el nombre del fichero), del historial de descargas (el mismo
 * título con su enlace), de la canción que llega de la cuenta con el mismo
 * título y, por último, del buscador, solo si el título coincide exacto.
 */

import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { esVideoId, normalizarTitulo } from './validar.js';

export { normalizarTitulo };

const PATRONES = [
    /i\.ytimg\.com\/vi(?:_webp)?\/([A-Za-z0-9_-]{11})\//,
    /ytmusic_([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
    /[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
    /youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/,
];

/** El id de YouTube que la propia canción deja ver (miniatura, fichero, enlace), o null. */
export function idDeLaCancion(song) {
    if (esVideoId(song?.videoId)) return song.videoId;
    for (const fuente of [song?.thumbnail, song?.localPath, song?.localThumbnailPath, song?.url, song?.src]) {
        if (typeof fuente !== 'string' || fuente.startsWith('data:')) continue;
        for (const patron of PATRONES) {
            const m = patron.exec(fuente);
            if (m) return m[1];
        }
    }
    return null;
}

/** Título normalizado → id, solo con los títulos que apuntan a un único id. */
export function indicePorTitulo(entradas) {
    const indice = new Map();
    const ambiguos = new Set();
    for (const { title, id } of entradas) {
        const clave = normalizarTitulo(title);
        if (!clave || !esVideoId(id) || ambiguos.has(clave)) continue;
        if (indice.has(clave) && indice.get(clave) !== id) { indice.delete(clave); ambiguos.add(clave); continue; }
        indice.set(clave, id);
    }
    return indice;
}

/** El id de una entrada del historial: el suyo o el de su enlace. */
const idDelHistorial = (h) => [h?.id, h?.videoId].find(esVideoId) ?? idDeLaCancion({ url: h?.url });

/** Lo que viaja de una canción editada en la cuenta: si allí se editó, manda. */
const EDITABLES = ['artist', 'track', 'extra', 'editado'];

/**
 * Da su id a las canciones descargadas que no lo tienen y quita las entradas
 * «en la nube» que resultan ser una de ellas. Pura.
 * @returns {{ biblioteca: object[], reparadas: number, unidas: number, ids: Map<string, string> }}
 *   ids: src de cada canción reparada → su id (para las copias de las listas)
 */
export function repararIds(biblioteca, historial = []) {
    const lib = biblioteca ?? [];
    const nubePorTitulo = indicePorTitulo(lib.filter((s) => s?.nube).map((s) => ({ title: s.title, id: s.videoId })));
    const porTitulo = indicePorTitulo((historial ?? []).map((h) => ({ title: h?.title, id: idDelHistorial(h) })));
    const tomados = new Set(lib.filter((s) => !s?.nube && esVideoId(s?.videoId)).map((s) => s.videoId));
    const ids = new Map();

    let resultado = lib.map((s) => {
        if (!s || s.nube || esVideoId(s.videoId)) return s;
        const titulo = normalizarTitulo(s.title);
        const id = idDeLaCancion(s) ?? porTitulo.get(titulo) ?? nubePorTitulo.get(titulo) ?? null;
        if (!id || tomados.has(id)) return s; // otra canción de aquí ya es esa: no se duplica la identidad
        tomados.add(id);
        ids.set(s.src, id);
        return { ...s, videoId: id };
    });

    // Las entradas en la nube de canciones que ya están descargadas aquí sobran;
    // lo editado en la cuenta pasa a la descargada
    const nubePorId = new Map(resultado.filter((s) => s?.nube).map((s) => [s.videoId, s]));
    let unidas = 0;
    resultado = resultado
        .map((s) => {
            if (!s || s.nube || !tomados.has(s.videoId) || !nubePorId.has(s.videoId)) return s;
            const nube = nubePorId.get(s.videoId);
            return nube.editado ? { ...s, ...Object.fromEntries(EDITABLES.map((k) => [k, nube[k]])) } : s;
        })
        .filter((s) => {
            if (s?.nube && tomados.has(s.videoId)) { unidas++; return false; }
            return true;
        });

    return { biblioteca: resultado, reparadas: ids.size, unidas, ids };
}

/** Las copias de las listas llevan el mismo id que la canción de la biblioteca. */
export function repararIdsDeListas(listas, ids) {
    let tocadas = false;
    const nuevas = (listas ?? []).map((pl) => ({
        ...pl,
        songs: (pl.songs ?? []).map((s) => {
            if (!s || esVideoId(s.videoId) || !ids.has(s.src)) return s;
            tocadas = true;
            return { ...s, videoId: ids.get(s.src) };
        }),
    }));
    return { listas: nuevas, tocadas };
}

/**
 * Del buscador, el id de un vídeo con exactamente ese título, o null. Nunca
 * se adivina: un título parecido no vale.
 */
export function idDeResultados(titulo, resultados) {
    const clave = normalizarTitulo(titulo);
    const exactos = (resultados ?? []).filter((r) => esVideoId(r?.id) && normalizarTitulo(r.title) === clave);
    return new Set(exactos.map((r) => r.id)).size === 1 ? exactos[0].id : null;
}

const CLAVE_INTENTOS = 'sync_ids_buscados';

/** Busca en YouTube el id de una canción por su título. Una vez por canción. */
export async function buscarId(song) {
    const intentos = (await StorageModule.get(CLAVE_INTENTOS).catch(() => null)) || {};
    if (intentos[song.src]) return null;
    await StorageModule.set(CLAVE_INTENTOS, { ...intentos, [song.src]: Date.now() }).catch(() => {});
    const res = await fetch(`${apiBase()}/api/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: String(song.title).slice(0, 200) }),
    });
    if (!res.ok) return null;
    return idDeResultados(song.title, (await res.json()).results);
}

export const yaBuscada = async (song) => Boolean(((await StorageModule.get(CLAVE_INTENTOS).catch(() => null)) || {})[song.src]);
