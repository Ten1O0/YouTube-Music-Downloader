/**
 * El contenido de las ocho diapositivas de «Tu año en música» (plan 17, T4).
 *
 * Una función por diapositiva, todas puras: reciben el resumen y la función de
 * traducción, y devuelven qué hay que enseñar. No tocan el DOM, así que el orden
 * y los textos se pueden probar sin navegador; de pintarlas se encarga
 * `historia.js`.
 *
 * Cada diapositiva es:
 *
 *     { id, titulo, destacado: { valor, sufijo, contar }, detalle, lista, cancion }
 *
 * - `destacado.contar` dice si el número se anima contando hasta su valor.
 * - `lista` son filas con posición, nombre y dato (los cinco artistas o canciones).
 * - `cancion` solo la trae la diapositiva de la canción del año, para el fragmento.
 */

import { miniaturaDe } from '../sync/validar.js';

/** Las diapositivas que puede haber, en orden. */
export const ORDEN = ['minutos', 'artista', 'artistas', 'cancion', 'canciones', 'horas', 'racha', 'final'];

/** Miniatura de una canción, o nada si no tiene vídeo (audio importado). */
const miniatura = (item) => (item?.videoId ? miniaturaDe(item.videoId) : '');

/** Una fila de las listas de cinco. */
const fila = (item, posicion, principal, secundario) => ({
    posicion,
    principal,
    secundario,
    miniatura: miniatura(item),
});

function minutos(r, t) {
    return {
        id: 'minutos',
        titulo: t('wrapped_minutes_title'),
        destacado: { valor: r.minutos, sufijo: t('wrapped_minutes_unit'), contar: true },
        detalle: t('wrapped_minutes_detail', { canciones: r.cancionesDistintas, artistas: r.artistasDistintos }),
    };
}

function artista(r, t) {
    const principal = r.artistaPrincipal;
    return {
        id: 'artista',
        titulo: t('wrapped_top_artist_title'),
        destacado: { valor: principal?.artista ?? '', contar: false },
        detalle: principal
            ? t('wrapped_top_artist_detail', { minutos: principal.minutos, escuchas: principal.escuchas })
            : '',
        miniatura: miniatura(r.canciones.find((c) => c.artista === principal?.artista) ?? r.canciones[0]),
    };
}

function artistas(r, t) {
    return {
        id: 'artistas',
        titulo: t('wrapped_artists_title'),
        lista: r.artistas.map((a, i) => fila(
            r.canciones.find((c) => c.artista === a.artista),
            i + 1, a.artista, t('wrapped_minutes_short', { n: a.minutos }))),
    };
}

function cancion(r, t) {
    const cd = r.cancionDelAnio;
    return {
        id: 'cancion',
        titulo: t('wrapped_top_song_title'),
        destacado: { valor: cd?.cancion ?? '', contar: false },
        detalle: cd ? t('wrapped_top_song_detail', { artista: cd.artista, escuchas: cd.escuchas }) : '',
        miniatura: miniatura(cd),
        // La única diapositiva que suena: 15 s desde el minuto 1 (§2.4)
        cancion: cd ?? null,
    };
}

function canciones(r, t) {
    return {
        id: 'canciones',
        titulo: t('wrapped_songs_title'),
        lista: r.canciones.map((c, i) => fila(c, i + 1, c.cancion, t('wrapped_plays_short', { n: c.escuchas }))),
    };
}

function horas(r, t) {
    const franja = r.franjaPrincipal;
    return {
        id: 'horas',
        titulo: t('wrapped_hours_title'),
        destacado: { valor: franja ? t(`wrapped_band_${franja}`) : '', contar: false },
        detalle: franja ? t('wrapped_hours_detail', { franja: t(`wrapped_band_${franja}`).toLocaleLowerCase() }) : '',
        // Para la gráfica de barras: los minutos de cada franja y su etiqueta
        barras: Object.entries(r.franjas).map(([clave, min]) => ({
            clave, minutos: min, etiqueta: t(`wrapped_band_${clave}`), destacada: clave === franja,
        })),
    };
}

function racha(r, t) {
    return {
        id: 'racha',
        titulo: t('wrapped_streak_title'),
        destacado: { valor: r.racha?.dias ?? 0, sufijo: t('wrapped_streak_unit'), contar: true },
        detalle: r.diaRecord
            ? t('wrapped_record_detail', { fecha: r.diaRecord.fecha, minutos: r.diaRecord.minutos })
            : '',
    };
}

function final(r, t) {
    return {
        id: 'final',
        titulo: t('wrapped_final_title', { anio: r.anio }),
        detalle: t('wrapped_final_detail', { minutos: r.minutos, artistas: r.artistasDistintos }),
        // El resumen de todo, que es también lo que se dibuja en la imagen (T5)
        resumen: {
            minutos: r.minutos,
            artista: r.artistaPrincipal?.artista ?? '',
            cancion: r.cancionDelAnio?.cancion ?? '',
            artistas: r.artistas.slice(0, 5).map((a) => a.artista),
            canciones: r.canciones.slice(0, 5).map((c) => c.cancion),
            descubrimientos: r.descubrimientos.length,
            miniatura: miniatura(r.canciones[0]),
        },
    };
}

const CONSTRUCTORES = { minutos, artista, artistas, cancion, canciones, horas, racha, final };

/**
 * Las diapositivas de un resumen, en orden.
 *
 * Se salta las que no tendrían nada que decir: sin canción del año no hay
 * diapositiva de canción, y sin racha de más de un día tampoco la de la racha.
 * La primera y la última no se saltan nunca: son el principio y el final.
 */
export function construirDiapositivas(resumen, t) {
    if (!resumen?.suficiente) return [];
    return ORDEN
        .filter((id) => tieneSentido(id, resumen))
        .map((id) => CONSTRUCTORES[id](resumen, t));
}

function tieneSentido(id, r) {
    switch (id) {
        case 'artista':
            return Boolean(r.artistaPrincipal);
        case 'artistas':
            return r.artistas.length > 1;
        case 'cancion':
            return Boolean(r.cancionDelAnio);
        case 'canciones':
            return r.canciones.length > 1;
        case 'racha':
            return Boolean(r.racha) || Boolean(r.diaRecord);
        default:
            return true;
    }
}
