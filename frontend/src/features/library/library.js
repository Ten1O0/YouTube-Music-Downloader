/**
 * Biblioteca de canciones descargadas.
 */

import { refrescarArtistas } from './artists.js';
import { completarMetadatos, nombreDe } from '../../core/titles.js';
import { conEsqueleto } from '../../ui/skeleton.js';
import { html } from '../../core/html.js';
import { apiBase, isNative } from '../../config/env.js';
import { cleanupNativeDuplicateSongFile, deleteStoredAudio, IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { isSongDuplicate } from '../../core/songs.js';
import { borrarMiniaturaNativa } from '../../core/miniaturas.js';
import { agrupada, crearColeccion } from '../../core/coleccion.js';
import { anotarBiblioteca } from '../sync/diario.js';
import { descargadasPrimero, esNube, listasAlDia } from '../sync/fusion.js';
import { esVideoId } from '../sync/validar.js';
import { avisar } from '../../ui/toast.js';
import { downloadFromUrl } from '../download/download.js';
import { FavoritesModule } from '../favorites/store.js';
import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { contarCanciones, i18n } from '../../i18n/language-manager.js';
import { toggleLibraryLoader } from './recovery.js';
import { animateListChange, collapseAndRemove, measure } from '../../ui/motion/list.js';
import { showStatus } from '../../ui/status.js';

/**
 * Unifies the rendering of a song item across Library, Playlist and Search views.
 * Ensures consistent swipe-to-queue support and safe data encoding.
 */
export function renderLibraryItem(song, index, options = {}) {
    // Sin guarda: FavoritesModule es un const de este mismo ámbito, así que
    // `globalThis.FavoritesModule` era SIEMPRE undefined y el corazón nunca se
    // pintaba activo al renderizar la biblioteca.
    const isFav = FavoritesModule.isFavorite(song.videoId);
    const context = options.context || 'library'; // 'library', 'playlist', 'search'

    // Actions are context-dependent
    let actionsHtml = '';
    if (context === 'library') {
        actionsHtml = html`
            <button class="library-item-btn favorite-btn lib-fav-btn ${isFav ? 'active' : ''}" data-id="${song.videoId}" data-index="${index}" title="Favorito">
                <svg viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <button class="library-item-btn lib-add-playlist-btn" data-index="${index}" title="Añadir a playlist">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
            </button>
                    <button class="library-item-btn lib-del-btn" data-src="${song.src}" title="Eliminar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
            </button>`;
    } else if (context === 'playlist') {
        const videoId = song.videoId || song.id || '';
        const heartFill = isFav ? 'currentColor' : 'none';
        actionsHtml = html`
            <button class="library-item-btn favorite-btn ${isFav ? 'active' : ''}" data-id="${videoId}" title="Favoritos">
                <svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            ${options.soloLectura ? '' : html`<button class="library-item-btn pl-remove-btn" data-src="${song.src}" title="Quitar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
            <div class="pl-drag-handle">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
            </div>`}`;
    }

    // Entradas cuyo audio se perdió (object URL muerto de versiones anteriores):
    // se muestran atenuadas y con la acción que las arregla, en vez de fallar al pulsarlas.
    if (song.unavailable) {
        return html`
        <div class="library-item library-item-unavailable" data-src="${song.src}" data-index="${index}">
            <div class="library-item-content">
                <img class="library-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" width="40" height="40" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
                <div class="library-item-info">
                    <div class="library-item-title">${nombreDe(song).titulo}</div>
                    <div class="library-item-meta">Audio no disponible — vuelve a descargarla</div>
                </div>
                <div class="library-item-actions">
                    <button class="library-item-btn lib-redownload-btn" data-index="${index}" title="Volver a descargar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                    </button>
                    <button class="library-item-btn lib-del-btn" data-src="${song.src}" title="Eliminar">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>`;
    }

    return html`
        <div class="library-item ${options.isEditMode ? 'edit-mode' : ''} ${esNube(song) ? 'library-item-nube' : ''}" data-src="${song.src}" data-index="${index}">
            <div class="swipe-action-bg">
                <div class="swipe-indicator">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    <span>${i18n.t('swipe_next')}</span>
                </div>
            </div>
            <div class="library-item-content">
                <img class="library-item-thumb" src="${song.thumbnail || 'favicon.png'}" alt="" width="40" height="40" loading="lazy" decoding="async" onerror="this.src='favicon.png'">
                <div class="library-item-info">
                    <div class="library-item-title">${nombreDe(song).titulo}${nombreDe(song).extra ? html` <span class="library-item-extra">${nombreDe(song).extra}</span>` : ''}</div>
                    <div class="library-item-meta">${esNube(song) ? html`<span class="material-symbols-outlined nube-icono" title="${i18n.t('cloud_badge')}" aria-label="${i18n.t('cloud_badge')}">cloud_download</span>` : ''}${nombreDe(song).artista || 'Desconocido'}</div>
                </div>
                <div class="library-item-actions">
                    ${actionsHtml}
                </div>
            </div>
        </div>`;
}

// ========================================
// LibraryModule — Biblioteca local
// ========================================
/** Lo que viaja con la cuenta de una canción (plan 13). */
const CAMPOS_CUENTA = ['title', 'channel', 'artist', 'track', 'extra', 'editado', 'duration', 'addedAt'];
const pick = (o, campos) => Object.fromEntries(campos.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

export const LibraryModule = (() => {
    const LIBRARY_KEY = 'ytdl_library';

    // La biblioteca vive en memoria (plan 19, T3): se lee una vez y se sirven
    // copias. Antes cada llamada leía y deserializaba IndexedDB entero
    const coleccion = crearColeccion(LIBRARY_KEY, {
        // Sanitización: Evitar duplicados invisibles (por src o videoId)
        normalizar: (lib) => {
            const seen = new Set();
            return lib.filter(song => {
                const key = song?.videoId || song?.src;
                if (!key) return true;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        },
    });

    // La copia de seguridad nativa, agrupada: unos segundos después del último
    // cambio y siempre al pasar a segundo plano (antes, entera en cada toque)
    const copiaNativa = agrupada((lib) => {
        if (!isNative() || !globalThis.Capacitor?.Plugins?.Filesystem) return;
        globalThis.Capacitor.Plugins.Filesystem.writeFile({
            path: 'library_backup_v1.json',
            data: JSON.stringify(lib),
            directory: 'DATA',
            encoding: 'utf8'
        }).catch((e) => console.debug('[Library] write backup failed:', e));
    });

    async function getLibrary() {
        try { return await coleccion.get(); } catch { return []; }
    }

    async function saveLibrary(lib) {
        // Lo que cambia se apunta para la cuenta (plan 13): antes (de memoria) y después
        const antes = await coleccion.set(lib);
        anotarBiblioteca(antes, lib);
        copiaNativa(lib);
    }
    async function addSongs(songs) {
        // Artista y canción limpios desde el principio (plan 11, T3)
        songs = (songs || []).map(completarMetadatos);
        if (!songs) return 0;
        const songsArray = Array.isArray(songs) ? songs : [songs];
        if (songsArray.length === 0) return 0;

        const lib = await getLibrary();
        let addedCount = 0;
        const newlyAddedKeys = new Set();

        for (const song of songsArray) {
            if (!song?.src) continue;

            const key = song.videoId || song.src;

            if (isSongDuplicate(song, lib, newlyAddedKeys)) {
                console.log("Canción duplicada ignorada en lote:", song.title);
                await cleanupNativeDuplicateSongFile(song);
                continue;
            }

            lib.unshift({ ...song, addedAt: new Date().toISOString() });
            if (key) newlyAddedKeys.add(key);
            addedCount++;
        }

        if (addedCount > 0) {
            await saveLibrary(lib);
            await render();
            await updateCount();
        }
        return addedCount;
    }
    async function addSong(song) {
        if (!song?.src) return;
        // Artista y canción limpios desde el principio (plan 11, T3)
        song = completarMetadatos(song);
        const lib = await getLibrary();

        // ¿Ya está? Por videoId o por título y canal. Se separa la descargada aquí
        // de su entrada «en la nube» (plan 13), que pueden coexistir si la de
        // aquí es anterior a guardar el id de YouTube
        const mismaCancion = (s) => (s.videoId && song.videoId && s.videoId === song.videoId)
            || (s.title === song.title && s.channel === song.channel);
        const yaAqui = lib.find(s => !esNube(s) && mismaCancion(s));
        const enLaNube = lib.find(s => esNube(s) && mismaCancion(s));

        if (yaAqui) {
            // El audio recién bajado sobra: no se deja huérfano
            if (song.src !== yaAqui.src) await liberarAudio(song);
            let cambiada = false;
            if (enLaNube) {
                lib.splice(lib.indexOf(enLaNube), 1);
                if (!esVideoId(yaAqui.videoId) && esVideoId(enLaNube.videoId)) yaAqui.videoId = enLaNube.videoId;
                cambiada = true;
            }
            if (!esVideoId(yaAqui.videoId) && esVideoId(song.videoId)) { yaAqui.videoId = song.videoId; cambiada = true; }
            if (cambiada) {
                await saveLibrary(lib);
                await render();
                await updateCount();
                await sacarDeLaNubeEnListas(lib);
            }
            // Visible desde cualquier vista: el estado de Inicio no se ve en la Biblioteca
            avisar(i18n.t('lib_duplicate'));
            return yaAqui;
        }

        // La canción estaba en la cuenta pero no aquí (plan 13): ahora tiene
        // audio. Se queda lo que viaja (lo editado, la fecha) y lo local nuevo
        if (enLaNube) {
            const i = lib.indexOf(enLaNube);
            lib[i] = { ...song, ...pick(enLaNube, CAMPOS_CUENTA) };
            await saveLibrary(lib);
            await render();
            await updateCount();
            // Y en las listas donde estaba, al momento
            await sacarDeLaNubeEnListas(lib);
            return lib[i];
        }

        const nueva = { ...song, addedAt: new Date().toISOString() };
        lib.unshift(nueva);
        await saveLibrary(lib);
        await render();
        await updateCount();
        return nueva;
    }

    /**
     * Las listas guardan su propia copia de cada canción: cuando una canción de
     * la nube se descarga, sus copias en las listas pasan a tener su audio. Se
     * llama al descargar y al arrancar (repara las que se quedaron en la nube).
     */
    async function sacarDeLaNubeEnListas(lib) {
        const r = listasAlDia(await PlaylistModule.getPlaylists(), lib ?? await getLibrary());
        if (!r.tocadas) return 0;
        await PlaylistModule.savePlaylists(r.listas);
        await PlaylistModule.renderGrid();
        const abierta = r.listas.find((pl) => pl.id === PlaylistModule.currentPlaylistId);
        if (abierta) PlaylistModule.renderPlaylistSongs(abierta);
        return r.tocadas;
    }

    /**
     * Libera el audio guardado de una canción: el fichero en la APK, el blob en
     * la web. En la APK las descargas van a DOCUMENTS y solo las importadas a
     * DATA; antes se borraba siempre en DATA y el audio de las descargadas se
     * quedaba ocupando sitio para siempre.
     */
    async function liberarAudio(song) {
        const src = song?.src;
        if (!src || esNube(song)) return;
        // Y su miniatura, si es un fichero de la app (plan 19, T2)
        await borrarMiniaturaNativa(song);
        if (song.localPath && globalThis.Capacitor?.isNative && globalThis.Capacitor?.Plugins?.Filesystem) {
            try {
                await globalThis.Capacitor.Plugins.Filesystem.deleteFile({
                    path: song.localPath,
                    directory: song.localPath.startsWith('imported_') ? 'DATA' : 'DOCUMENTS',
                });
            } catch (err) {
                console.error("Error borrando archivo capacitor:", err);
            }
        } else if (typeof src === 'string' && src.startsWith(IDB_SRC_PREFIX)) {
            // Web: liberar el audio guardado en IndexedDB, o se acumulan MB huérfanos
            await deleteStoredAudio(src);
        } else {
            const match = src.match(/\/api\/stream\/([a-zA-Z0-9-]+)/);
            if (match?.[1]) fetch(`${apiBase()}/api/download/${match[1]}`, { method: 'DELETE' }).catch(() => { });
        }
    }

    async function removeSong(src, itemElement) {
        // 1. La fila se pliega al momento (plan 09, T14): antes era una cadena
        //    de setTimeout de 50 y 350 ms con max-height.
        if (itemElement) collapseAndRemove(itemElement);

        const lib = await getLibrary();
        await liberarAudio(lib.find(s => s.src === src));

        const newLib = lib.filter(s => s.src !== src);
        await saveLibrary(newLib);

        // Borrado en cascada: Eliminar también de cualquier playlist
        const playlists = await PlaylistModule.getPlaylists();
        for (const pl of playlists) {
            if (pl.songs.some(s => s.src === src)) {
                await PlaylistModule.removeSongFromPlaylist(pl.id, src);
            }
        }

        // Remove from current playing queue to prevent ghost loading
        PlayerModule.removeSongFromQueue(src);

        updateCount();
    }

    async function updateCount() {
        const count = document.getElementById('libraryCount');
        const lib = await getLibrary();
        // Las descargadas aquí: las de la nube las cuenta su propia barra (plan 13)
        if (count) count.textContent = contarCanciones(lib.filter(s => !esNube(s)).length);
    }

    let cachedEmpty = null;
    let cachedLoader = null;

    // Lo que se ve ahora en la lista: los clics lo buscan por su posición
    let pintada = [];
    let delegada = false;

    function delegarClics(list) {
        if (delegada) return;
        delegada = true;
        list.addEventListener('click', async (e) => {
            const fila = e.target.closest('.library-item');
            if (!fila || !list.contains(fila)) return;
            const i = Number.parseInt(fila.dataset.index, 10);
            const song = pintada[i];
            if (!song) return;
            const boton = e.target.closest('.library-item-btn');
            if (!boton) {
                PlayerModule.play(song, [...pintada], i);
                return;
            }
            e.stopPropagation();
            if (boton.classList.contains('lib-del-btn')) {
                if (confirm('¿Eliminar esta canción de la biblioteca?')) await removeSong(boton.dataset.src, fila);
            } else if (boton.classList.contains('lib-redownload-btn')) {
                // Se quita la entrada rota y se relanza la descarga original
                await removeSong(song.src, fila);
                const url = song.url || (song.videoId ? `https://www.youtube.com/watch?v=${song.videoId}` : null);
                if (url) await downloadFromUrl(url, song);
                else showStatus(i18n.t('lib_no_source'), 'error');
            } else if (boton.classList.contains('lib-add-playlist-btn')) {
                PlaylistModule.showAddToPlaylist(song);
            } else if (boton.classList.contains('lib-fav-btn')) {
                await FavoritesModule.toggleFavorite(song, boton);
            }
        });
    }

    // Fuera de la vista no se repinta (plan 19, T5): se apunta y se hace al
    // entrar, sin la animación de recolocar (como hoy: al llegar, ya está al día)
    let pintadaUnaVez = false;
    let pendiente = false;
    const aLaVista = () => !document.getElementById('libraryView')?.classList.contains('hidden');
    document.addEventListener('vista-cambiada', (e) => {
        if (e.detail === 'libraryView' && pendiente) render({ animar: false });
    });

    async function render({ animar = true } = {}) {
        const list = document.getElementById('libraryList');
        if (!list) return;
        if (pintadaUnaVez && !aLaVista()) {
            pendiente = true;
            await updateCount();
            return;
        }
        pendiente = false;
        pintadaUnaVez = true;

        // Cache the empty and loader nodes before they get destroyed
        if (document.getElementById('libraryEmpty')) cachedEmpty = document.getElementById('libraryEmpty');
        if (document.getElementById('libraryLoader')) cachedLoader = document.getElementById('libraryLoader');

        // La primera carga enseña esqueletos si tarda (plan 10, T8). Antes salía
        // una rueda con «Cargando biblioteca…» en cada repintado, también en
        // los instantáneos; la rueda queda para el escaneo de carpetas de la APK
        const primeraCarga = !list.querySelector('.library-item');
        // Lo que ya suena en este dispositivo va delante; lo de la nube, después.
        // Solo cambia lo que se pinta: los índices de las filas son de esta lista
        const lib = descargadasPrimero(primeraCarga
            ? await conEsqueleto(list, 'fila', 6, getLibrary(), {
                alMostrar: () => { if (cachedEmpty) cachedEmpty.style.display = 'none'; },
            })
            : await getLibrary());

        // Filas que entran y se recolocan (plan 09, T14)
        const antes = animar ? measure(list, '.library-item', el => el.dataset.src) : null;

        list.innerHTML = '';
        if (cachedLoader) list.appendChild(cachedLoader);
        if (cachedEmpty) list.appendChild(cachedEmpty);

        if (lib.length === 0) {
            if (cachedEmpty) {
                cachedEmpty.classList.remove('hidden');
                cachedEmpty.style.display = 'flex';
            }
            refrescarArtistas();
            document.dispatchEvent(new CustomEvent('biblioteca-pintada'));
            return;
        }

        if (cachedEmpty) {
            cachedEmpty.classList.add('hidden');
            cachedEmpty.style.display = 'none';
        }

        const filas = lib.map((song, i) => {
            return renderLibraryItem(song, i, { context: 'library' });
        }).join('');
        list.insertAdjacentHTML('beforeend', filas);
        if (antes) animateListChange(list, '.library-item', el => el.dataset.src, antes);

        // Un solo escuchador para toda la lista (plan 19, T4): antes, cuatro por
        // canción, creados otra vez en cada repintado
        pintada = lib;
        delegarClics(list);

        await updateCount();
        toggleLibraryLoader(false);
        // La vista por artistas se rehace con la biblioteca (plan 11, T6)
        refrescarArtistas();
        document.dispatchEvent(new CustomEvent('biblioteca-pintada'));
    }

    /**
     * Repinta solo la fila de esta canción (plan 19, T5): editar una canción
     * no rehace la lista entera. Si la fila no está pintada, o no se ve, lo de
     * siempre.
     */
    async function renderFila(src) {
        const list = document.getElementById('libraryList');
        const i = pintada.findIndex((s) => s.src === src);
        const fila = [...(list?.querySelectorAll('.library-item') ?? [])].find((el) => el.dataset.src === src);
        const song = (await getLibrary()).find((s) => s.src === src);
        if (!fila || i < 0 || !song || !aLaVista()) return render();
        pintada[i] = song;
        fila.outerHTML = renderLibraryItem(song, i, { context: 'library' });
        refrescarArtistas();
    }

    function setPlaying(src) {
        document.querySelectorAll('.library-item').forEach(el => {
            el.classList.toggle('playing', el.dataset.src === src);
        });
    }

    return { addSong, addSongs, removeSong, liberarAudio, getLibrary, saveLibrary, render, renderFila, setPlaying, updateCount, sacarDeLaNubeEnListas };
})();
