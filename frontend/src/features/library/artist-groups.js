/**
 * Agrupar la biblioteca por artista (plan 11, T6). Sin DOM: se prueba en Node.
 *
 * Se agrupa por el artista principal (lo de antes de «feat.»), sin distinguir
 * mayúsculas ni tildes, y se ordena como ordena el idioma de la app.
 */

import { nombreDe, normalizarArtista } from '../../core/titles.js';
import { claveEscucha } from '../player/listens.js';

/**
 * @returns {{ clave: string, nombre: string, canciones: object[], escuchas: number, portada: string }[]}
 */
export function agruparPorArtista(biblioteca, contadores = {}, idioma = 'es') {
    const grupos = new Map();
    for (const song of biblioteca ?? []) {
        const nombre = nombreDe(song).artista || '—';
        const clave = normalizarArtista(nombre) || '—';
        if (!grupos.has(clave)) grupos.set(clave, { clave, nombres: new Map(), canciones: [], escuchas: 0 });
        const g = grupos.get(clave);
        // El nombre que más se repite es el que se muestra («Beyoncé» frente a «Beyonce»)
        const principal = nombre.split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0];
        g.nombres.set(principal, (g.nombres.get(principal) ?? 0) + 1);
        g.canciones.push(song);
        g.escuchas += contadores?.[claveEscucha(song)]?.n ?? 0;
    }
    const orden = new Intl.Collator(idioma, { sensitivity: 'base', numeric: true });
    const vecesDe = (song) => contadores?.[claveEscucha(song)]?.n ?? 0;
    return [...grupos.values()].map((g) => {
        const nombre = [...g.nombres.entries()].sort((a, b) => b[1] - a[1])[0][0];
        // La portada, de la canción más escuchada (la primera si ninguna lo ha sido)
        const masEscuchada = [...g.canciones].sort((a, b) => vecesDe(b) - vecesDe(a))[0];
        return { clave: g.clave, nombre, canciones: g.canciones, escuchas: g.escuchas, portada: masEscuchada?.thumbnail || '' };
    }).sort((a, b) => orden.compare(a.nombre, b.nombre));
}
