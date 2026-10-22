/**
 * Validar lo que llega de fuera (plan 13, §3): la sincronización y los
 * ficheros de copia. Sin DOM: se prueba en Node.
 *
 * Nada de lo recibido se usa tal cual. Cada campo se comprueba y se recorta
 * con los mismos límites que el servidor; lo que no vale se descarta. Las
 * miniaturas nunca se aceptan de fuera: se rehacen desde el videoId.
 */

import { FUNDIDOS_VALIDOS, IDIOMAS, LIMITES, RE_LISTA_ID, RE_VIDEO_ID } from './limites.js';

const PELIGROSAS = new Set(['__proto__', 'constructor', 'prototype']);

/** JSON.parse que tira las claves con las que se envenena un prototipo. */
export function parseSeguro(texto) {
    return JSON.parse(texto, (clave, valor) => (PELIGROSAS.has(clave) ? undefined : valor));
}

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Texto limpio: sin caracteres de control, recortado. Lo que no es texto, ''. */
export function texto(valor, maximo) {
    if (typeof valor !== 'string') return '';
    return valor.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximo);
}

export const esVideoId = (v) => typeof v === 'string' && RE_VIDEO_ID.test(v);

/** Un título comparable: sin mayúsculas ni espacios de más. */
export const normalizarTitulo = (t) => String(t ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Una fecha ISO válida, normalizada; si no lo es, `defecto`. */
export function fecha(valor, defecto = null) {
    if (typeof valor !== 'string' || valor.length > 40) return defecto;
    const ms = Date.parse(valor);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : defecto;
}

function entero(valor, minimo, maximo, defecto) {
    return typeof valor === 'number' && Number.isFinite(valor) && valor >= minimo && valor <= maximo
        ? Math.trunc(valor) : defecto;
}

export const miniaturaDe = (videoId) => `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Una canción con la forma de la cuenta, o null. */
export function validarCancion(c) {
    if (!esObjeto(c) || !esVideoId(c.videoId)) return null;
    return {
        videoId: c.videoId,
        title: texto(c.title, LIMITES.titulo),
        channel: texto(c.channel, LIMITES.canal),
        artist: texto(c.artist, LIMITES.artista),
        track: texto(c.track, LIMITES.cancion),
        extra: texto(c.extra, LIMITES.extra),
        editado: c.editado === true,
        duration: entero(c.duration, 0, LIMITES.duracion, 0),
        addedAt: fecha(c.addedAt, new Date(0).toISOString()),
        ...(c.deleted === true ? { deleted: true } : {}),
    };
}

/** Las portadas generadas que se pueden elegir (plan 27): `gen:0` … `gen:7`. */
export const RE_PORTADA_GENERADA = /^gen:[0-7]$/;

/** La portada elegida de una lista: una de sus canciones (plan 24) o una generada (plan 27); si no, '' (la automática). */
export const portadaValida = (portada, canciones) => (
    typeof portada === 'string' && (RE_PORTADA_GENERADA.test(portada) || canciones.includes(portada)) ? portada : '');

/** Una lista con la forma de la cuenta (canciones como videoId), o null. */
export function validarLista(l) {
    if (!esObjeto(l) || typeof l.id !== 'string' || !RE_LISTA_ID.test(l.id)) return null;
    if (l.deleted === true) return { id: l.id, deleted: true };
    const nombre = texto(l.name, 1000);
    if (!nombre || nombre.length > LIMITES.nombreLista) return null;
    const canciones = Array.isArray(l.songs) ? [...new Set(l.songs.filter(esVideoId))].slice(0, LIMITES.cancionesLista) : [];
    return {
        id: l.id,
        name: nombre,
        description: texto(l.description, LIMITES.descripcionLista),
        songs: canciones,
        portada: portadaValida(l.portada, canciones),
        createdAt: fecha(l.createdAt, new Date(0).toISOString()),
    };
}

/** Solo los ajustes que se conocen, con valores válidos. */
export function validarAjustes(a) {
    if (!esObjeto(a)) return null;
    const limpios = {};
    if (IDIOMAS.includes(a.idioma)) limpios.idioma = a.idioma;
    if (esObjeto(a.reproduccion)) {
        const r = a.reproduccion;
        const rep = {};
        if (FUNDIDOS_VALIDOS.includes(r.fundido)) rep.fundido = r.fundido;
        if (typeof r.igualar === 'boolean') rep.igualar = r.igualar;
        if (typeof r.visualizador === 'boolean') rep.visualizador = r.visualizador;
        limpios.reproduccion = rep;
    }
    return limpios;
}

export function validarEscucha(e) {
    if (!esObjeto(e) || !esVideoId(e.videoId)) return null;
    const t = entero(e.t, 0, Date.now() + 86_400_000, null);
    if (t === null) return null;
    return {
        videoId: e.videoId,
        artista: texto(e.artista, LIMITES.artista),
        cancion: texto(e.cancion, LIMITES.cancion),
        t,
        s: entero(e.s, 0, LIMITES.duracion, 0),
    };
}

/** Lo que devuelve GET /api/sync, limpio. null si no tiene la forma esperada. */
export function validarRemotos(r) {
    if (!esObjeto(r) || !Number.isInteger(r.seq) || r.seq < 0) return null;
    return {
        seq: r.seq,
        biblioteca: (Array.isArray(r.biblioteca) ? r.biblioteca : []).map(validarCancion).filter(Boolean),
        listas: (Array.isArray(r.listas) ? r.listas : []).map(validarLista).filter(Boolean),
        ajustes: r.ajustes == null ? null : validarAjustes(r.ajustes),
    };
}

export const FORMATO_COPIA = 'music-downloader';

/**
 * Un fichero de copia, limpio: { biblioteca, listas, favoritos, escuchas, ajustes, resumen }.
 * null si no es una copia de esta app. Las entradas que no valen se descartan
 * y se cuentan en `resumen.descartadas`.
 */
export function validarCopia(c) {
    if (!esObjeto(c) || c.formato !== FORMATO_COPIA || c.version !== 1) return null;
    const lista = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
    const crudas = {
        biblioteca: lista(c.biblioteca, LIMITES.cancionesCuenta),
        listas: lista(c.listas, LIMITES.listasCuenta),
        favoritos: lista(c.favoritos, LIMITES.cancionesCuenta),
        escuchas: lista(c.escuchas, LIMITES.escuchasCopia),
    };
    const vistos = new Set();
    const biblioteca = crudas.biblioteca.map(validarCancion).filter((s) => {
        if (!s || s.deleted || vistos.has(s.videoId)) return false;
        vistos.add(s.videoId);
        return true;
    });
    const listas = crudas.listas.map(validarLista).filter((l) => l && !l.deleted);
    const favoritos = [...new Set(crudas.favoritos.filter(esVideoId))];
    const escuchas = crudas.escuchas.map(validarEscucha).filter(Boolean);
    const descartadas = crudas.biblioteca.length - biblioteca.length + crudas.listas.length - listas.length
        + crudas.escuchas.length - escuchas.length;
    return {
        biblioteca, listas, favoritos, escuchas,
        ajustes: validarAjustes(c.ajustes) ?? {},
        creada: fecha(c.creada),
        resumen: { canciones: biblioteca.length, listas: listas.length, favoritos: favoritos.length, escuchas: escuchas.length, descartadas },
    };
}
