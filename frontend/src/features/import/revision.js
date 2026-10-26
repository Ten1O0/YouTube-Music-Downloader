/**
 * La revisión de una lista importada (plan 15, T4), sin DOM ni red: las filas a
 * partir de lo que encuentra el servidor, lo que va en la lista y lo que falta.
 * La hoja que la enseña está en import.js; esto se prueba sin ella.
 */

import { i18n } from '../../i18n/language-manager.js';
import { esNube, nombreLibre, PREFIJO_NUBE } from '../sync/fusion.js';
import { LIMITES } from '../sync/limites.js';
import { esVideoId, miniaturaDe } from '../sync/validar.js';
import { ErrorImportacion } from './parse.js';
import { confianza, mejor } from './score.js';

/** Orden de la revisión: lo que pide atención, primero. */
const ORDEN_CONFIANZA = { ninguna: 0, dudosa: 1, probable: 2, segura: 3 };

/**
 * Las filas de la revisión, a partir de lo que devuelve el servidor.
 *
 * Se puntúa con las canciones tal como se leyeron aquí, no con las que devuelve
 * el servidor: el servidor solo recibe título, artista, duración e ISRC, y para
 * reconocer una versión pedida hace falta también el álbum («Live at Wembley»)
 * y todos los artistas. El servidor conserva el orden, así que se emparejan por
 * posición.
 */
export function prepararRevision(resultado, leidas = []) {
    const canciones = Array.isArray(resultado?.canciones) ? resultado.canciones : [];
    const filas = canciones.map((c, i) => {
        const origen = leidas.length === canciones.length ? leidas[i] : c.origen;
        const r = mejor(origen, c.candidatas);
        return {
            posicion: i,
            origen,
            elegida: r.elegida,
            puntos: r.puntos,
            confianza: r.confianza,
            candidatas: r.candidatas,
            quitada: false,
            manual: false,
            abierta: false,
        };
    });
    // Estable: dentro de cada grupo, el orden de la lista original
    return filas.sort((a, b) => ORDEN_CONFIANZA[a.confianza] - ORDEN_CONFIANZA[b.confianza] || a.posicion - b.posicion);
}

/**
 * Cuántas hay de cada tipo, para el resumen de la revisión.
 *
 * `elegidas` cuenta **vídeos distintos**, no filas: si dos canciones de la
 * lista acabaron en el mismo vídeo, la lista lo tendrá una vez, y el botón
 * «Crear lista y descargar N» tiene que decir lo que de verdad va a pasar.
 */
export function contarRevision(filas) {
    const cuenta = { total: filas.length, ninguna: 0, dudosa: 0, probable: 0, segura: 0, quitadas: 0, elegidas: 0, repetidas: 0 };
    const ids = new Set();
    for (const f of filas) {
        if (f.quitada) { cuenta.quitadas++; continue; }
        cuenta[f.confianza]++;
        if (!f.elegida) continue;
        if (ids.has(f.elegida.id)) cuenta.repetidas++;
        ids.add(f.elegida.id);
    }
    cuenta.elegidas = ids.size;
    return cuenta;
}

/** Elige otra candidata para una fila. La decisión es del usuario: ya no se marca como dudosa. */
export function elegirCandidata(fila, videoId) {
    const c = fila.candidatas.find((x) => x.id === videoId);
    if (!c) return fila;
    return { ...fila, elegida: c, puntos: c.puntos, confianza: confianza(c.puntos), manual: true, abierta: false };
}

/** Una canción que aún no se ha descargado, en la lista: sin audio, «en la nube». */
export function entradaNube(c) {
    return {
        videoId: c.id,
        title: c.title || '',
        channel: c.channel || '',
        artist: c.artist || '',
        track: c.track || '',
        duration: Number.isFinite(c.duration) ? c.duration : 0,
        src: PREFIJO_NUBE + c.id,
        thumbnail: miniaturaDe(c.id),
        nube: true,
    };
}

/**
 * Lo que va en la lista y lo que hay que descargar.
 *
 * - Una canción que ya está en la biblioteca (con audio) entra tal cual y no
 *   se descarga otra vez (plan 15, §2.5).
 * - Si dos filas acabaron en el mismo vídeo, entra una sola vez.
 */
export function cancionesParaLista(filas, biblioteca = []) {
    const enBiblioteca = new Map(biblioteca
        .filter((s) => !esNube(s) && esVideoId(s?.videoId))
        .map((s) => [s.videoId, s]));
    const vistos = new Set();
    const songs = [];
    const pendientes = [];
    let yaEstaban = 0;
    for (const f of filas) {
        const c = f.elegida;
        if (f.quitada || !c || !esVideoId(c.id) || vistos.has(c.id)) continue;
        vistos.add(c.id);
        const tenida = enBiblioteca.get(c.id);
        if (tenida) {
            songs.push(tenida);
            yaEstaban++;
        } else {
            songs.push(entradaNube(c));
            pendientes.push(c);
        }
    }
    return { songs, pendientes, yaEstaban };
}

/** Nombre de la lista: el que haya escrito el usuario, o uno por defecto, sin chocar con los que hay. */
export function nombreParaLista(escrito, listas, porDefecto) {
    const base = String(escrito ?? '').trim().slice(0, LIMITES.nombreLista) || porDefecto;
    return nombreLibre(base, (listas ?? []).map((l) => l.name ?? ''));
}

/** El texto de un error de lectura, traducido. */
export function mensajeDeError(e) {
    const codigos = {
        vacio: 'import_err_empty',
        demasiado_grande: 'import_err_too_big',
        sin_titulo: 'import_err_no_title',
    };
    if (e instanceof ErrorImportacion && codigos[e.codigo]) return i18n.t(codigos[e.codigo]);
    return i18n.t('import_err_read');
}
