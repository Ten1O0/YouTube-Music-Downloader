/**
 * Juntar lo local con lo de la cuenta o con una copia (plan 13, T4). Sin DOM:
 * se prueba en Node.
 *
 * La identidad de una canción entre dispositivos es su videoId: el `src` es
 * distinto en cada sitio (idb:// en la web, una ruta en la APK). Lo que está
 * en la cuenta pero no en este dispositivo se queda «en la nube»: una entrada
 * sin audio, con `nube: true` y un src sintético `nube://<videoId>` para que
 * todo lo que identifica canciones por src siga funcionando.
 */

import { LIMITES, RE_LISTA_ID } from './limites.js';
import { esVideoId, miniaturaDe, normalizarTitulo, portadaValida } from './validar.js';

export const PREFIJO_NUBE = 'nube://';
export const esNube = (song) => song?.nube === true;

/** Las descargadas primero y después las de la nube; cada grupo conserva su orden. */
export const descargadasPrimero = (lib) => [...lib.filter((s) => !esNube(s)), ...lib.filter(esNube)];

/** Los campos que viajan de una canción. */
const CAMPOS = ['title', 'channel', 'artist', 'track', 'extra', 'editado', 'duration', 'addedAt'];

/** Una canción local con la forma de la cuenta, o null si no puede viajar (sin videoId). */
export function cancionACuenta(song) {
    if (!esVideoId(song?.videoId)) return null;
    return {
        videoId: song.videoId,
        title: String(song.title ?? ''),
        channel: String(song.channel ?? ''),
        artist: String(song.artist ?? ''),
        track: String(song.track ?? ''),
        extra: String(song.extra ?? ''),
        editado: song.editado === true,
        duration: Number.isFinite(song.duration) ? Math.trunc(song.duration) : 0,
        addedAt: song.addedAt ?? song.downloadedAt ?? new Date(0).toISOString(),
    };
}

/** Una lista local con la forma de la cuenta: sus canciones como videoId, en orden. */
export function listaACuenta(pl) {
    if (typeof pl?.id !== 'string' || !RE_LISTA_ID.test(pl.id)) return null;
    return {
        id: pl.id,
        name: String(pl.name ?? ''),
        description: String(pl.description ?? ''),
        songs: [...new Set((pl.songs ?? []).map((s) => s?.videoId).filter(esVideoId))],
        // La portada elegida: una de sus canciones (plan 24, P11) o una generada (plan 27)
        portada: portadaValida(pl.portada, (pl.songs ?? []).map((s) => s?.videoId).filter(esVideoId)),
        createdAt: pl.createdAt ?? new Date(0).toISOString(),
    };
}

/** Una canción que está en la cuenta pero no en este dispositivo. */
export function cancionEnLaNube(remota) {
    return {
        ...Object.fromEntries(CAMPOS.map((k) => [k, remota[k]])),
        videoId: remota.videoId,
        src: PREFIJO_NUBE + remota.videoId,
        thumbnail: miniaturaDe(remota.videoId),
        nube: true,
    };
}

const igualesEnCuenta = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Qué cambios de canciones hay entre dos bibliotecas. Solo las que pueden viajar. */
export function diferenciasBiblioteca(antes, despues) {
    const indice = (lib) => new Map((lib ?? []).map(cancionACuenta).filter(Boolean).map((c) => [c.videoId, c]));
    const a = indice(antes);
    const d = indice(despues);
    const cambios = [];
    for (const [id, c] of d) {
        if (!a.has(id) || !igualesEnCuenta(a.get(id), c)) cambios.push({ tipo: 'cancion', accion: 'poner', datos: c });
    }
    for (const id of a.keys()) {
        if (!d.has(id)) cambios.push({ tipo: 'cancion', accion: 'borrar', datos: { videoId: id } });
    }
    return cambios;
}

/** Qué cambios de listas hay entre dos colecciones de listas. */
export function diferenciasListas(antes, despues) {
    const indice = (ls) => new Map((ls ?? []).map(listaACuenta).filter(Boolean).map((l) => [l.id, l]));
    const a = indice(antes);
    const d = indice(despues);
    const cambios = [];
    for (const [id, l] of d) {
        if (!a.has(id) || !igualesEnCuenta(a.get(id), l)) cambios.push({ tipo: 'lista', accion: 'poner', datos: l });
    }
    for (const id of a.keys()) {
        if (!d.has(id)) cambios.push({ tipo: 'lista', accion: 'borrar', datos: { id } });
    }
    return cambios;
}

/** Las más nuevas primero, como se añaden. Estable: las que empatan conservan su orden. */
function ordenarPorFecha(lib) {
    const t = (s) => Date.parse(s.addedAt ?? '') || 0;
    return lib.map((s, i) => [s, i]).sort((x, y) => t(y[0]) - t(x[0]) || x[1] - y[1]).map(([s]) => s);
}

/**
 * Las canciones de una lista de la cuenta (videoId) convertidas en copias de
 * las de la biblioteca. Las locales sin videoId (importadas) no viajan, así que
 * se conservan al final para no perderlas.
 */
function materializarLista(remota, porId, local) {
    const canciones = remota.songs.map((id) => porId.get(id)).filter(Boolean).map((s) => ({ ...s }));
    const sinId = (local?.songs ?? []).filter((s) => !esVideoId(s?.videoId));
    return {
        ...(local ?? {}),
        id: remota.id,
        name: remota.name,
        description: remota.description,
        portada: remota.portada,
        createdAt: remota.createdAt,
        songs: [...canciones, ...sinId].slice(0, LIMITES.cancionesLista),
    };
}

/**
 * Aplica lo que llega del servidor sobre lo local.
 * @param {{ biblioteca: object[], listas: object[] }} local
 * @param {{ biblioteca: object[], listas: object[] }} remotos  ya validados
 * @param {{ pendientes?: Set<string> }} o  claves ('cancion:<id>', 'lista:<id>')
 *   con un cambio local aún sin enviar: lo local manda sobre lo que llega
 * @returns {{ biblioteca, listas, borradas: object[] }}  borradas: canciones
 *   locales que la cuenta ha borrado (para liberar su audio)
 */
export function aplicarRemotos(local, remotos, { pendientes = new Set() } = {}) {
    let biblioteca = [...(local.biblioteca ?? [])];
    const borradas = [];
    const identificadas = new Map(); // src de una descargada sin id → el id que trae la cuenta

    for (const r of remotos.biblioteca ?? []) {
        if (pendientes.has(`cancion:${r.videoId}`)) continue;
        let i = biblioteca.findIndex((s) => s.videoId === r.videoId);
        // Una descargada aquí sin id (de antes de guardarlo) con el mismo título
        // es esa canción: se le da el id, no se duplica en la nube
        if (i < 0 && !r.deleted) {
            const titulo = normalizarTitulo(r.title);
            i = biblioteca.findIndex((s) => !esNube(s) && !esVideoId(s.videoId) && titulo && normalizarTitulo(s.title) === titulo);
            if (i >= 0) {
                identificadas.set(biblioteca[i].src, r.videoId);
                biblioteca[i] = { ...biblioteca[i], videoId: r.videoId };
            }
        }
        if (r.deleted) {
            if (i >= 0) borradas.push(...biblioteca.splice(i, 1));
        } else if (i >= 0) {
            biblioteca[i] = { ...biblioteca[i], ...Object.fromEntries(CAMPOS.map((k) => [k, r[k]])) };
        } else {
            biblioteca.push(cancionEnLaNube(r));
        }
    }
    biblioteca = ordenarPorFecha(biblioteca);

    const porId = new Map(biblioteca.filter((s) => esVideoId(s.videoId)).map((s) => [s.videoId, s]));
    const quitadas = new Set(borradas.map((s) => s.src));
    // Las canciones borradas desaparecen también de las listas locales
    let listas = (local.listas ?? []).map((pl) => ({
        ...pl,
        songs: (pl.songs ?? []).filter((s) => !quitadas.has(s.src))
            .map((s) => (identificadas.has(s?.src) ? { ...s, videoId: identificadas.get(s.src) } : s)),
    }));
    for (const r of remotos.listas ?? []) {
        if (pendientes.has(`lista:${r.id}`)) continue;
        const i = listas.findIndex((pl) => pl.id === r.id);
        if (r.deleted) {
            if (i >= 0) listas.splice(i, 1);
        } else if (i >= 0) {
            listas[i] = materializarLista(r, porId, listas[i]);
        } else {
            listas.push(materializarLista(r, porId, null));
        }
    }
    // Las copias de las listas siguen a la biblioteca: artista, canción y lo demás al día
    listas = listasAlDia(listas, biblioteca).listas;

    return { biblioteca, listas, borradas };
}

/**
 * La copia de una canción dentro de una lista, al día con su entrada de la
 * biblioteca. Si la biblioteca ya tiene su audio, la copia deja de estar en
 * la nube: antes se quedaba con `nube://` para siempre, aunque se descargase.
 */
function copiaAlDia(copia, deLaBiblioteca) {
    if (!deLaBiblioteca) return copia;
    const campos = Object.fromEntries(CAMPOS.map((k) => [k, deLaBiblioteca[k]]));
    if (esNube(deLaBiblioteca)) return { ...copia, ...campos, src: deLaBiblioteca.src, nube: true };
    if (esNube(copia)) return { ...deLaBiblioteca };
    return { ...copia, ...campos };
}

/**
 * Las listas con sus copias al día con la biblioteca (por videoId). Pura.
 * @returns {{ listas: object[], tocadas: number }}  tocadas: copias que salen de la nube
 */
export function listasAlDia(listas, biblioteca) {
    const porId = new Map((biblioteca ?? []).filter((s) => esVideoId(s?.videoId)).map((s) => [s.videoId, s]));
    let tocadas = 0;
    const nuevas = (listas ?? []).map((pl) => ({
        ...pl,
        songs: (pl.songs ?? []).map((s) => {
            if (!esVideoId(s?.videoId) || !porId.has(s.videoId)) return s;
            const al = copiaAlDia(s, porId.get(s.videoId));
            if (esNube(s) && !esNube(al)) tocadas++;
            return al;
        }),
    }));
    return { listas: nuevas, tocadas };
}

/** Un nombre de lista que no choque con los que ya hay: «Viaje (2)». */
export function nombreLibre(nombre, ocupados) {
    const usados = new Set([...ocupados].map((n) => n.toLowerCase()));
    if (!usados.has(nombre.toLowerCase())) return nombre;
    for (let n = 2; ; n++) {
        const sufijo = ` (${n})`;
        const candidato = nombre.slice(0, LIMITES.nombreLista - sufijo.length) + sufijo;
        if (!usados.has(candidato.toLowerCase())) return candidato;
    }
}

/**
 * Junta una copia (ya validada) con lo local.
 * - combinar: suma sin borrar. Lo que ya está aquí se queda como está; lo
 *   nuevo llega en la nube. Una lista con el mismo id suma sus canciones; con
 *   otro id pero el mismo nombre, se renombra.
 * - sustituir: queda lo de la copia. Lo local que no está en ella se borra
 *   (en `borradas`, para liberar su audio); lo que sí está conserva su audio.
 */
export function fusionarCopia(local, copia, modo = 'combinar') {
    const sustituir = modo === 'sustituir';
    const localPorId = new Map((local.biblioteca ?? []).filter((s) => esVideoId(s.videoId)).map((s) => [s.videoId, s]));
    const enCopia = new Set(copia.biblioteca.map((c) => c.videoId));

    let biblioteca;
    let borradas = [];
    if (sustituir) {
        borradas = (local.biblioteca ?? []).filter((s) => !enCopia.has(s.videoId));
        biblioteca = copia.biblioteca.map((c) => (localPorId.has(c.videoId)
            ? { ...localPorId.get(c.videoId), ...Object.fromEntries(CAMPOS.map((k) => [k, c[k]])) }
            : cancionEnLaNube(c)));
    } else {
        biblioteca = [...(local.biblioteca ?? []), ...copia.biblioteca.filter((c) => !localPorId.has(c.videoId)).map(cancionEnLaNube)];
    }
    biblioteca = ordenarPorFecha(biblioteca).slice(0, LIMITES.cancionesCuenta);

    const porId = new Map(biblioteca.filter((s) => esVideoId(s.videoId)).map((s) => [s.videoId, s]));
    let listas;
    if (sustituir) {
        listas = copia.listas.map((l) => materializarLista(l, porId, null));
    } else {
        listas = (local.listas ?? []).map((pl) => ({ ...pl, songs: [...(pl.songs ?? [])] }));
        for (const l of copia.listas) {
            const mismaId = listas.find((pl) => pl.id === l.id);
            if (mismaId) {
                const ya = new Set(mismaId.songs.map((s) => s.videoId));
                const nuevas = l.songs.filter((id) => !ya.has(id)).map((id) => porId.get(id)).filter(Boolean).map((s) => ({ ...s }));
                mismaId.songs = [...mismaId.songs, ...nuevas].slice(0, LIMITES.cancionesLista);
            } else if (listas.length < LIMITES.listasCuenta) {
                const nueva = materializarLista(l, porId, null);
                nueva.name = nombreLibre(nueva.name, listas.map((pl) => pl.name));
                listas.push(nueva);
            }
        }
    }
    return { biblioteca, listas, borradas };
}
