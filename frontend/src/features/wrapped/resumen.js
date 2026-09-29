/**
 * El cálculo de «Tu año en música» (plan 17, T2).
 *
 * Función pura: entra el registro de escuchas y sale el resumen. No toca el DOM,
 * ni el almacenamiento, ni la red. Es la misma para el registro local y para las
 * escuchas que devuelve la cuenta (plan 17, §2.2): una sola lógica, un solo
 * juego de tests.
 *
 * Una escucha es `{ videoId, artista, cancion, t, segundos }`, con `t` en
 * milisegundos. Las filas del registro local (plan 11, T5) traen además `id` y
 * `clave`, que aquí no se usan.
 */

import { normalizarArtista } from '../../core/titles.js';

/** Franjas de 6 h, en la hora local del dispositivo. */
export const FRANJAS = ['madrugada', 'manana', 'tarde', 'noche'];

/** Mínimo para que el resumen tenga sentido (plan 17, §2.1). */
export const MINIMO_MINUTOS = 60;
export const MINIMO_ESCUCHAS = 20;

/** Cuántos artistas y canciones lleva el resumen. */
const CUANTOS = 5;

const MS_POR_DIA = 86_400_000;
const MS_POR_HORA = 3_600_000;

/** La franja de una hora del día: 0-5 madrugada, 6-11 mañana, 12-17 tarde, 18-23 noche. */
export const franjaDe = (hora) => FRANJAS[Math.min(FRANJAS.length - 1, Math.floor(hora / 6))];

/**
 * Traduce instantes a la hora local de una zona.
 *
 * `Intl.DateTimeFormat` es lo único que sabe de husos y de horarios de verano,
 * pero llamarlo una vez por escucha cuesta caro con decenas de miles de filas.
 * Se le pregunta el desfase una vez por hora UTC y se guarda: a partir de ahí es
 * aritmética. El desfase solo cambia dos veces al año, así que el único error
 * posible es que una escucha dentro de la hora exacta del cambio quede en la
 * franja de al lado; nunca en otro día ni en otro año.
 */
function relojLocal(zonaHoraria) {
    let formato = null;
    try {
        formato = new Intl.DateTimeFormat('en-US', {
            timeZone: zonaHoraria || undefined,
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    } catch {
        // Zona desconocida: se usa la del dispositivo, que es lo que haría el navegador
        formato = new Intl.DateTimeFormat('en-US', {
            hourCycle: 'h23',
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    }

    function desfase(t) {
        const p = {};
        for (const { type, value } of formato.formatToParts(t)) p[type] = value;
        const comoUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
        // t puede traer milisegundos, que el formato no devuelve: se descuentan
        return comoUtc - Math.floor(t / 1000) * 1000;
    }

    const cache = new Map();
    return function partes(t) {
        const cubo = Math.floor(t / MS_POR_HORA);
        let off = cache.get(cubo);
        if (off === undefined) {
            off = desfase(t);
            cache.set(cubo, off);
        }
        const local = t + off;
        const d = new Date(local);
        return {
            anio: d.getUTCFullYear(),
            hora: d.getUTCHours(),
            dia: Math.floor(local / MS_POR_DIA),
            fecha: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`,
        };
    };
}

/** Segundos de una escucha, saneados: lo que no sea un número positivo es 0. */
function segundosDe(escucha) {
    const s = Number(escucha?.segundos);
    return Number.isFinite(s) && s > 0 ? s : 0;
}

/** Identidad de una canción en el resumen: el vídeo de YouTube, o su nombre si no lo tiene. */
const claveCancion = (e) => e.videoId || `${e.artista}\u0000${e.cancion}`;

/** Minutos redondeados, que es como se muestran siempre. */
const aMinutos = (segundos) => Math.round(segundos / 60);

/**
 * El nombre del artista que más veces se ha escrito así. Se agrupa por
 * `normalizarArtista` («Bad Bunny» y «bad bunny» son el mismo), pero se muestra
 * la forma más habitual, no la normalizada.
 */
function nombreMasUsado(cuentas) {
    let mejor = '';
    let mejorN = -1;
    for (const [nombre, n] of cuentas) {
        if (n > mejorN || (n === mejorN && nombre < mejor)) {
            mejor = nombre;
            mejorN = n;
        }
    }
    return mejor;
}

/** La racha más larga de días seguidos con alguna escucha. */
function rachaMasLarga(dias) {
    if (!dias.size) return null;
    const orden = [...dias.keys()].sort((a, b) => a - b);
    let mejor = { dias: 1, desde: orden[0], hasta: orden[0] };
    let inicio = orden[0];
    for (let i = 1; i < orden.length; i++) {
        if (orden[i] !== orden[i - 1] + 1) inicio = orden[i];
        const largo = orden[i] - inicio + 1;
        if (largo > mejor.dias) mejor = { dias: largo, desde: inicio, hasta: orden[i] };
    }
    return { dias: mejor.dias, desde: dias.get(mejor.desde), hasta: dias.get(mejor.hasta) };
}

/**
 * El resumen del año.
 *
 * @param escuchas Todas las escuchas disponibles, de cualquier año: los años
 *   anteriores se usan para saber qué artistas son un descubrimiento.
 * @param anio Año a resumir.
 * @param zonaHoraria Zona IANA (`'Europe/Madrid'`). Sin ella, la del dispositivo.
 * @param artistasAnteriores Artistas ya escuchados antes del año en otros
 *   dispositivos (§2.2). Se suman a los que se deduzcan de `escuchas`.
 */
export function calcularResumen(escuchas, { anio, zonaHoraria, artistasAnteriores = [] } = {}) {
    const partesDe = relojLocal(zonaHoraria);
    const filas = Array.isArray(escuchas) ? escuchas : [];

    // Artistas con alguna escucha anterior al año: no son descubrimientos
    const previos = new Set(artistasAnteriores.map(normalizarArtista).filter(Boolean));

    const delAnio = [];
    for (const e of filas) {
        const t = Number(e?.t);
        if (!Number.isFinite(t)) continue;
        const p = partesDe(t);
        if (p.anio === anio) delAnio.push({ e, p, s: segundosDe(e) });
        else if (p.anio < anio) {
            const clave = normalizarArtista(e.artista);
            if (clave) previos.add(clave);
        }
    }

    const porArtista = new Map();   // clave normalizada -> { segundos, escuchas, nombres, primera }
    const porCancion = new Map();   // clave de canción  -> { …datos, segundos, escuchas }
    const porDia = new Map();       // día local (entero) -> segundos
    const fechaDeDia = new Map();   // día local (entero) -> 'YYYY-MM-DD'
    const franjas = Object.fromEntries(FRANJAS.map((f) => [f, 0]));

    let segundosTotales = 0;
    let primera = null;

    for (const { e, p, s } of delAnio) {
        segundosTotales += s;
        franjas[franjaDe(p.hora)] += s;
        porDia.set(p.dia, (porDia.get(p.dia) ?? 0) + s);
        fechaDeDia.set(p.dia, p.fecha);
        if (!primera || Number(e.t) < Number(primera.t)) primera = e;

        const artista = normalizarArtista(e.artista);
        if (artista) {
            const a = porArtista.get(artista) ?? { segundos: 0, escuchas: 0, nombres: new Map() };
            a.segundos += s;
            a.escuchas += 1;
            a.nombres.set(e.artista, (a.nombres.get(e.artista) ?? 0) + 1);
            porArtista.set(artista, a);
        }

        const clave = claveCancion(e);
        const c = porCancion.get(clave) ?? {
            videoId: e.videoId || '', artista: e.artista || '', cancion: e.cancion || '', segundos: 0, escuchas: 0,
        };
        c.segundos += s;
        c.escuchas += 1;
        porCancion.set(clave, c);
    }

    // Los artistas se ordenan por minutos, no por escuchas: así uno de canciones
    // largas no sale perjudicado (§2.1). Empate: más escuchas y luego el nombre,
    // para que el resultado no dependa del orden de llegada de los datos.
    const artistas = [...porArtista.entries()]
        .map(([clave, a]) => ({ clave, artista: nombreMasUsado(a.nombres), minutos: aMinutos(a.segundos), segundos: a.segundos, escuchas: a.escuchas }))
        .sort((x, y) => y.segundos - x.segundos || y.escuchas - x.escuchas || x.artista.localeCompare(y.artista))
        .slice(0, CUANTOS);

    // Las canciones, por número de escuchas; empate, más minutos (§2.1)
    const canciones = [...porCancion.values()]
        .map((c) => ({ ...c, minutos: aMinutos(c.segundos) }))
        .sort((x, y) => y.escuchas - x.escuchas || y.segundos - x.segundos || x.cancion.localeCompare(y.cancion))
        .slice(0, CUANTOS);

    let diaRecord = null;
    for (const [dia, segundos] of porDia) {
        if (!diaRecord || segundos > diaRecord.segundos || (segundos === diaRecord.segundos && dia < diaRecord.dia)) {
            diaRecord = { dia, segundos, fecha: fechaDeDia.get(dia), minutos: aMinutos(segundos) };
        }
    }
    if (diaRecord) delete diaRecord.dia;

    const descubrimientos = [...porArtista.entries()]
        .filter(([clave]) => !previos.has(clave))
        .map(([clave, a]) => ({ clave, artista: nombreMasUsado(a.nombres), minutos: aMinutos(a.segundos), segundos: a.segundos }))
        .sort((x, y) => y.segundos - x.segundos || x.artista.localeCompare(y.artista));

    const minutos = aMinutos(segundosTotales);
    const total = delAnio.length;
    const suficiente = minutos >= MINIMO_MINUTOS && total >= MINIMO_ESCUCHAS;

    return {
        anio,
        suficiente,
        faltan: suficiente ? null : { minutos: Math.max(0, MINIMO_MINUTOS - minutos), escuchas: Math.max(0, MINIMO_ESCUCHAS - total) },
        minutos,
        segundos: Math.round(segundosTotales),
        escuchas: total,
        cancionesDistintas: porCancion.size,
        artistasDistintos: porArtista.size,
        artistas,
        canciones,
        cancionDelAnio: canciones[0] ?? null,
        artistaPrincipal: artistas[0] ?? null,
        diaRecord,
        racha: rachaMasLarga(fechaDeDia),
        franjas: Object.fromEntries(FRANJAS.map((f) => [f, aMinutos(franjas[f])])),
        franjaPrincipal: total ? FRANJAS.reduce((a, b) => (franjas[b] > franjas[a] ? b : a)) : null,
        descubrimientos,
        primeraCancion: primera
            ? { videoId: primera.videoId || '', artista: primera.artista || '', cancion: primera.cancion || '', t: Number(primera.t) }
            : null,
    };
}
