/**
 * Borrar con deshacer (plan 24, P9): quitar canciones de una lista, borrarlas
 * de la biblioteca y borrar una lista entera.
 *
 * Lo usan la X de las filas en modo edición, los gestos (P10), la barra de la
 * selección múltiple (P8) y el menú ⋮ de una lista. Se carga con import() al
 * borrar algo: el arranque está en el límite de su presupuesto.
 *
 * Lo visible cambia al momento y se guarda; deshacer lo vuelve a poner donde
 * estaba. Lo único irreversible, borrar el audio del dispositivo, espera a que
 * acabe el aviso.
 */

import { nombreDe } from '../../core/titles.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { conDeshacer, DURACION_CANCION, DURACION_LISTA } from '../../ui/deshacer.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { guardarYRepintarLista } from '../playlists/helpers.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { reinsertar, separar } from './sitios.js';

/** El texto y la carátula del aviso: el título si es una, o cuántas. */
function presentacion(canciones, { una, varias, name }) {
    if (canciones.length === 1) {
        const song = canciones[0];
        return { titulo: nombreDe(song).titulo, texto: i18n.t(una, { name }), miniatura: song.thumbnail || '' };
    }
    return { titulo: '', texto: i18n.t(varias, { n: canciones.length, name }), miniatura: '' };
}

/** Guarda las listas y repinta la rejilla y, si está abierta, la lista. */
async function guardarListas(playlists) {
    const abierta = playlists.find((p) => p.id === PlaylistModule.currentPlaylistId);
    if (abierta) return guardarYRepintarLista(abierta.id, playlists, abierta);
    await PlaylistModule.savePlaylists(playlists);
    await PlaylistModule.renderGrid();
}

/** Quita canciones de una lista, con 3 s para deshacerlo. */
export async function quitarDeListaConDeshacer(playlistId, srcs) {
    if (!srcs?.length) return;
    const playlists = await PlaylistModule.getPlaylists();
    const pl = playlists.find((p) => p.id === playlistId);
    if (!pl) return;
    const { quedan, quitados } = separar(pl.songs, srcs);
    if (!quitados.length) return;
    pl.songs = quedan;
    await guardarYRepintarLista(playlistId, playlists, pl);

    conDeshacer({
        ...presentacion(quitados.map((q) => q.item), { una: 'undo_removed_from', varias: 'undo_n_removed_from', name: pl.name }),
        duracionMs: DURACION_CANCION,
        deshacer: async () => {
            const ahora = await PlaylistModule.getPlaylists();
            const lista = ahora.find((p) => p.id === playlistId);
            if (!lista) return;
            reinsertar(lista.songs, quitados);
            await guardarYRepintarLista(playlistId, ahora, lista);
        },
    });
}

/**
 * Borra canciones de la biblioteca y, en cascada, de todas las listas, con 3 s
 * para deshacerlo. El audio del dispositivo se borra al acabar el aviso.
 * `filas`: las de la biblioteca, que se pliegan al momento en vez de repintar.
 */
export async function borrarDeBibliotecaConDeshacer(srcs, { filas = [] } = {}) {
    if (!srcs?.length) return;
    const biblioteca = await LibraryModule.getLibrary();
    const { quedan, quitados } = separar(biblioteca, srcs);
    if (!quitados.length) return;

    // En cascada: de cada lista que las tenga, con su sitio para deshacer
    const playlists = await PlaylistModule.getPlaylists();
    const enListas = [];
    for (const pl of playlists) {
        const r = separar(pl.songs, srcs);
        if (!r.quitados.length) continue;
        pl.songs = r.quedan;
        enListas.push({ id: pl.id, quitados: r.quitados });
    }

    await LibraryModule.saveLibrary(quedan);
    if (enListas.length) await guardarListas(playlists);
    for (const { item } of quitados) PlayerModule.removeSongFromQueue(item.src);
    if (filas.length) {
        const { collapseAndRemove } = await import('../../ui/motion/list.js');
        filas.forEach((f) => collapseAndRemove(f));
    } else {
        await LibraryModule.render({ animar: false });
    }
    await LibraryModule.updateCount();

    const canciones = quitados.map((q) => q.item);
    conDeshacer({
        ...presentacion(canciones, { una: 'undo_lib_deleted', varias: 'undo_lib_n_deleted' }),
        duracionMs: DURACION_CANCION,
        // Lo irreversible, solo si no se deshace
        confirmar: async () => {
            for (const song of canciones) await LibraryModule.liberarAudio(song);
        },
        deshacer: async () => {
            await LibraryModule.saveLibrary(reinsertar(await LibraryModule.getLibrary(), quitados));
            if (enListas.length) {
                const ahora = await PlaylistModule.getPlaylists();
                for (const { id, quitados: q } of enListas) {
                    const pl = ahora.find((p) => p.id === id);
                    if (pl) reinsertar(pl.songs, q);
                }
                await guardarListas(ahora);
            }
            await LibraryModule.render({ animar: false });
            await LibraryModule.updateCount();
        },
    });
}

/**
 * Borra una lista entera sin preguntar (plan 24: un paso menos, como en
 * Spotify) y da 5 s para deshacerlo. Quien llama sale antes de su detalle.
 */
export async function borrarListaConDeshacer(pl) {
    const playlists = await PlaylistModule.getPlaylists();
    const indice = playlists.findIndex((p) => p.id === pl.id);
    if (indice < 0) return;
    const lista = playlists[indice];
    await PlaylistModule.deletePlaylist(pl.id);

    const conCaratula = lista.songs?.find((s) => s?.thumbnail);
    conDeshacer({
        titulo: lista.name,
        texto: `${i18n.t('undo_pl_deleted')} · ${contarCanciones(lista.songs?.length ?? 0)}`,
        miniatura: conCaratula?.thumbnail || '',
        duracionMs: DURACION_LISTA,
        deshacer: async () => {
            const ahora = await PlaylistModule.getPlaylists();
            if (ahora.some((p) => p.id === lista.id)) return;
            ahora.splice(Math.min(indice, ahora.length), 0, lista);
            await PlaylistModule.savePlaylists(ahora);
            await PlaylistModule.renderGrid();
        },
    });
}
