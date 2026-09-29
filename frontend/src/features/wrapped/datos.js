/**
 * De dónde salen las escuchas de «Tu año en música» (plan 17, T3).
 *
 * Sin sesión, del registro local (IndexedDB `escuchas`, plan 11, T5). Con
 * sesión, además de las de **todos** los dispositivos de la cuenta, que devuelve
 * `GET /api/resumen/escuchas`. Las dos fuentes se unen sin duplicar y el cálculo
 * es el mismo en los dos casos (plan 17, §2.2).
 *
 * Lo que llega del servidor es dato externo aunque sea de la propia cuenta: se
 * valida entero antes de usarlo, igual que en la sincronización.
 */

import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { auth } from '../auth.js';
import { esVideoId, texto } from '../sync/validar.js';
import { calcularResumen } from './resumen.js';

/** Topes de lo que se acepta del servidor, en la línea de los de la sincronización. */
const LIMITES = { nombre: 120, escuchas: 100_000, anteriores: 5_000, duracion: 86_400 };

/** La zona horaria del dispositivo, que es con la que se recorta el año. */
export const zonaHorariaActual = () => {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
        return 'UTC';
    }
};

/** Dos escuchas con el mismo vídeo y el mismo milisegundo son la misma. */
const claveEscucha = (e) => `${e.videoId || ''}\u0000${e.t}`;

/**
 * Expande el formato compacto de §2.2 a filas como las del registro local.
 * Devuelve [] si la respuesta no tiene la forma esperada: sin sesión útil se
 * sigue con lo local, que es mejor que no enseñar nada.
 */
export function expandirEscuchas(respuesta) {
    if (!respuesta || typeof respuesta !== 'object') return [];
    const catalogo = Array.isArray(respuesta.catalogo) ? respuesta.catalogo : [];
    const filas = Array.isArray(respuesta.escuchas) ? respuesta.escuchas : [];

    const canciones = catalogo.map((c) => (Array.isArray(c) ? {
        videoId: esVideoId(c[0]) ? c[0] : '',
        artista: texto(c[1], LIMITES.nombre),
        cancion: texto(c[2], LIMITES.nombre),
    } : null));

    const salida = [];
    for (const fila of filas.slice(0, LIMITES.escuchas)) {
        if (!Array.isArray(fila)) continue;
        const cancion = canciones[fila[0]];
        const t = Number(fila[1]);
        if (!cancion || !Number.isFinite(t) || t < 0) continue;
        const s = Number(fila[2]);
        salida.push({
            ...cancion,
            t: Math.trunc(t),
            segundos: Number.isFinite(s) && s > 0 ? Math.min(Math.trunc(s), LIMITES.duracion) : 0,
        });
    }
    return salida;
}

/** Los artistas anteriores que manda el servidor, limpios. */
export function expandirAnteriores(respuesta) {
    const lista = Array.isArray(respuesta?.anteriores) ? respuesta.anteriores : [];
    return lista.slice(0, LIMITES.anteriores).map((a) => texto(a, LIMITES.nombre)).filter(Boolean);
}

/**
 * Une dos listas de escuchas sin duplicar.
 *
 * No se cruzan por `dispositivo + id local`, que es la clave del servidor,
 * porque la respuesta compacta no los trae. Se cruzan por vídeo e instante: dos
 * escuchas del mismo vídeo en el mismo milisegundo son la misma, y eso resuelve
 * de paso que la sincronización reenvíe a propósito la última escucha (puede
 * haber seguido sumando segundos). Cuando una está en las dos, se queda con los
 * segundos mayores, igual que hace el servidor con `MAX(seconds, …)`.
 */
export function unirEscuchas(deLaCuenta, locales) {
    const porClave = new Map();
    for (const e of deLaCuenta) porClave.set(claveEscucha(e), e);
    for (const e of locales) {
        const clave = claveEscucha(e);
        const previa = porClave.get(clave);
        if (!previa) porClave.set(clave, e);
        else if ((e.segundos ?? 0) > (previa.segundos ?? 0)) porClave.set(clave, { ...previa, segundos: e.segundos });
    }
    return [...porClave.values()].sort((a, b) => a.t - b.t);
}

/** El registro local entero, de todos los años: los anteriores marcan los descubrimientos. */
async function leerLocales() {
    try {
        const filas = (await StorageModule.leerEscuchas()) || [];
        return filas.map((f) => ({
            videoId: esVideoId(f?.videoId) ? f.videoId : '',
            artista: texto(f?.artista, LIMITES.nombre),
            cancion: texto(f?.cancion, LIMITES.nombre),
            t: Number(f?.t),
            segundos: Number(f?.segundos) || 0,
        })).filter((f) => Number.isFinite(f.t));
    } catch (e) {
        console.debug('[Resumen] No se pudo leer el registro local:', e);
        return [];
    }
}

/** Las escuchas del año en la cuenta. null si no hay sesión o el servidor no responde. */
async function pedirALaCuenta(anio) {
    if (!auth.isLoggedIn()) return null;
    try {
        const res = await fetch(`${apiBase()}/api/resumen/escuchas?anio=${encodeURIComponent(anio)}`, {
            headers: auth.getAuthHeaders(),
        });
        if (!res.ok) {
            console.debug(`[Resumen] La cuenta no devolvió las escuchas (${res.status})`);
            return null;
        }
        const datos = await res.json();
        return { escuchas: expandirEscuchas(datos), anteriores: expandirAnteriores(datos) };
    } catch (e) {
        console.debug('[Resumen] Sin conexión con la cuenta:', e);
        return null;
    }
}

/**
 * Reúne las escuchas de un año.
 *
 * @returns `{ escuchas, artistasAnteriores, fuente }`, donde `fuente` es
 *   `'cuenta'` si se pudieron sumar las de todos los dispositivos, `'local'` si
 *   solo hay las de este.
 */
export async function reunirEscuchas(anio) {
    const locales = await leerLocales();
    const deLaCuenta = await pedirALaCuenta(anio);
    if (!deLaCuenta) return { escuchas: locales, artistasAnteriores: [], fuente: 'local' };
    return {
        escuchas: unirEscuchas(deLaCuenta.escuchas, locales),
        artistasAnteriores: deLaCuenta.anteriores,
        fuente: 'cuenta',
    };
}

/** El resumen de un año, ya calculado. Es lo que usan las diapositivas (T4). */
export async function resumenDelAnio(anio = new Date().getFullYear()) {
    const { escuchas, artistasAnteriores, fuente } = await reunirEscuchas(anio);
    const resumen = calcularResumen(escuchas, { anio, zonaHoraria: zonaHorariaActual(), artistasAnteriores });
    return { ...resumen, fuente };
}
