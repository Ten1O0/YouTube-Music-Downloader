/**
 * Favoritos: la lista, su sincronización con la cuenta y los cambios pendientes
 * (plan 01).
 */

import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { extractVideoId, urlYoutubeDe } from '../../core/utils.js';
import { auth } from '../auth.js';
import { renderFavorites } from './panel.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { i18n } from '../../i18n/language-manager.js';
import { avisarHaptico } from '../../ui/haptics.js';
import { showStatus } from '../../ui/status.js';

// ========================================
// FavoritesModule — Sistema de Likes Unificado
// ========================================
export const FavoritesModule = (() => {
    const FAV_KEY = 'favorites'; // Unify with legacy key
    let favIds = new Set();

    let escuchandoConexion = false;

    // Initialize from StorageModule
    async function init() {
        try {
            const saved = await StorageModule.get(FAV_KEY) || [];
            favIds = new Set(saved.map(item => (item.id || item.videoId)?.toString()).filter(Boolean));
        } catch (e) { console.error('Error loading favorites:', e); }

        // Al recuperar la conexión se envía lo que quedó pendiente
        if (!escuchandoConexion) {
            escuchandoConexion = true;
            window.addEventListener('online', () => { syncWithServer(); });
        }
    }

    async function getFavorites() {
        try {
            return await StorageModule.get(FAV_KEY) || [];
        } catch (e) {
            console.error('Error in getFavorites:', e);
            return [];
        }
    }

    function isFavorite(videoId) {
        if (!videoId) return false;
        return favIds.has(videoId.toString());
    }

    let isTransitioning = false;

    // ----------------------------------------
    // Sincronización con la cuenta
    // ----------------------------------------
    // Con sesión, la lista de la cuenta es la referencia: al arrancar y al
    // iniciar sesión el dispositivo adopta la del servidor, así que un
    // favorito borrado en otro dispositivo desaparece también aquí. Juntar las
    // dos listas, en cambio, lo haría reaparecer.
    //
    // Lo que no puede llegar al servidor en el momento —sin sesión o sin red—
    // se apunta como pendiente y se envía en cuanto se puede. Cada pendiente
    // lleva la cuenta a la que pertenece, para no mandar a una cuenta los
    // cambios hechos sobre la lista de otra en un dispositivo compartido.
    //
    // `auth` se declara más abajo con const y no existe como globalThis.auth:
    // se usa por su nombre. Nada de esto se ejecuta durante la carga.
    const PENDING_KEY = 'favorites_pending';
    const OWNER_KEY = 'favorites_owner';   // cuenta cuya lista refleja este dispositivo

    let envios = Promise.resolve();        // los cambios salen de uno en uno y en orden
    let cambiosLocales = 0;                // para no pisar un cambio hecho durante la sincronización
    let sincronizacion = null;

    const cuentaActual = () => String(auth.user.id);

    async function leerPendientes() {
        try { return await StorageModule.get(PENDING_KEY) || []; }
        catch (e) { console.error('Error leyendo favoritos pendientes:', e); return []; }
    }

    async function guardarPendientes(lista) {
        try { await StorageModule.set(PENDING_KEY, lista); }
        catch (e) { console.error('Error guardando favoritos pendientes:', e); }
    }

    async function leerCuentaLocal() {
        try { return await StorageModule.get(OWNER_KEY) ?? null; }
        catch { return null; }
    }

    /** Solo cuenta el último cambio de cada vídeo: añadir y luego quitar es quitar. */
    async function apuntarPendiente(cambio) {
        const lista = (await leerPendientes())
            .filter(c => !(c.id === cambio.id && c.owner === cambio.owner));
        lista.push(cambio);
        await guardarPendientes(lista);
    }

    async function enviarCambio(cambio) {
        const res = cambio.op === 'add'
            ? await fetch(`${apiBase()}/api/user/favorites`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
                body: JSON.stringify(cambio.entry)
            })
            : await fetch(`${apiBase()}/api/user/favorites/${encodeURIComponent(cambio.id)}`, {
                method: 'DELETE',
                headers: auth.getAuthHeaders()
            });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }

    async function registrarCambio(op, videoId, entry) {
        const conSesion = auth.isLoggedIn();
        const cambio = {
            op, id: videoId, entry,
            owner: conSesion ? cuentaActual() : await leerCuentaLocal(),
        };

        if (!conSesion) {
            await apuntarPendiente(cambio);
            return;
        }

        // Este cambio sustituye a cualquier pendiente anterior del mismo vídeo
        await guardarPendientes((await leerPendientes())
            .filter(c => !(c.id === videoId && c.owner === cambio.owner)));
        try {
            await enviarCambio(cambio);
        } catch (e) {
            // Sin red, servidor caído o sesión caducada: se reintenta después
            console.warn('[Favoritos] Queda pendiente de enviar:', videoId, e.message);
            await apuntarPendiente(cambio);
        }
    }

    function encolarCambio(op, videoId, entry = null) {
        cambiosLocales++;
        envios = envios
            .then(() => registrarCambio(op, videoId, entry))
            .catch(e => console.error('[Favoritos] Error registrando el cambio:', e));
        return envios;
    }

    /** Aplica sobre una lista los cambios que aún no han llegado al servidor. */
    function aplicarPendientes(lista, pendientes) {
        let resultado = lista;
        for (const c of pendientes) {
            resultado = resultado.filter(f => String(f.id) !== c.id);
            if (c.op === 'add' && c.entry) resultado = [c.entry, ...resultado];
        }
        return resultado;
    }

    async function adoptarLista(lista) {
        const antes = favIds;
        await StorageModule.set(FAV_KEY, lista);
        favIds = new Set(lista.map(f => String(f.id)));

        for (const id of new Set([...antes, ...favIds])) {
            if (antes.has(id) !== favIds.has(id)) updateFavoriteButtonsDOM(id, favIds.has(id));
        }
        await refrescarVistas();
    }

    async function sincronizar() {
        await envios;  // que termine lo que ya está saliendo
        const cuenta = cuentaActual();
        const cuentaLocal = await leerCuentaLocal();
        let pendientes = await leerPendientes();

        // Primera vez de esta cuenta en este dispositivo sin que la lista local
        // sea de nadie (nunca hubo sesión, o viene de antes de este sistema):
        // los favoritos locales se suman a la cuenta una sola vez. Si la lista
        // local es de otra cuenta, no se sube: pertenece a esa otra cuenta.
        if (cuentaLocal === null) {
            const locales = await getFavorites();
            if (locales.length > 0) {
                const res = await fetch(`${apiBase()}/api/user/sync`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...auth.getAuthHeaders() },
                    body: JSON.stringify({ history: [], favorites: locales })
                });
                if (!res.ok) throw new Error(`sync HTTP ${res.status}`);
            }
            // La subida ya incluye el efecto de los cambios sin dueño
            pendientes = pendientes.filter(c => c.owner !== null);
        }

        // Enviar lo pendiente de esta cuenta; lo de otras cuentas espera
        const restantes = [];
        for (const c of pendientes) {
            if (c.owner !== cuenta) { restantes.push(c); continue; }
            try { await enviarCambio(c); } catch { restantes.push(c); }
        }
        await guardarPendientes(restantes);

        const version = cambiosLocales;
        const res = await fetch(`${apiBase()}/api/user/favorites`, { headers: auth.getAuthHeaders() });
        if (!res.ok) return;  // sin red: la lista local se queda como está
        const { favorites = [] } = await res.json();

        // Si el usuario ha tocado un corazón mientras llegaba la respuesta, la
        // lista del servidor ya no está al día: se adopta en la próxima vuelta.
        if (version !== cambiosLocales) return;

        const delServidor = favorites.map(f => ({ ...f, videoId: f.id }));
        await adoptarLista(aplicarPendientes(delServidor, restantes.filter(c => c.owner === cuenta)));
        await StorageModule.set(OWNER_KEY, cuenta);
    }

    /**
     * Envía los cambios pendientes y adopta la lista de la cuenta. Se llama al
     * arrancar con sesión, al iniciar sesión y al recuperar la conexión.
     */
    function syncWithServer() {
        if (!auth.isLoggedIn()) return Promise.resolve();
        sincronizacion ??= sincronizar()
            .catch(e => console.warn('[Favoritos] No se pudo sincronizar:', e.message))
            .finally(() => { sincronizacion = null; });
        return sincronizacion;
    }

    async function toggleFavorite(video, btnElement) {
        // Robust ID detection
        const videoIdValue = video.id || video.videoId || (extractVideoId(video.url || video.src));
        if (!videoIdValue) return false;

        if (isTransitioning) return false;
        isTransitioning = true;
        avisarHaptico('light');

        try {
            const videoId = videoIdValue.toString();

            const favorites = await getFavorites();
            const existingIndex = favorites.findIndex(item => (item.id || item.videoId) == videoId);
            const isRemoving = existingIndex >= 0;

            if (isRemoving) {
                favorites.splice(existingIndex, 1);
                favIds.delete(videoId);
                showStatus(i18n.t('fav_removed'), 'info');
                encolarCambio('remove', videoId);
            } else {
                const entry = {
                    id: videoId,
                    videoId: videoId, // Ensure both are present for compatibility
                    title: video.title || 'Sin título',
                    thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
                    channel: video.channel || 'Desconocido',
                    // La de YouTube, nunca `src`: en una canción de la biblioteca es la
                    // ruta interna del audio (idb://, el fichero del móvil) y no se puede descargar
                    url: urlYoutubeDe({ ...video, id: videoId }),
                    addedAt: new Date().toISOString(),
                    duration: video.duration
                };
                favorites.unshift(entry);
                favIds.add(videoId);
                showStatus(i18n.t('fav_added'), 'success');
                encolarCambio('add', videoId, entry);
            }

            // Save state
            await StorageModule.set(FAV_KEY, favorites);

            // GLOBAL UI REFRESH
            await refreshAllUI(videoId, !isRemoving);

            // Refresh Favorites View if open
            if (PlaylistModule?.currentPlaylistId === 'favorites') {
                await PlaylistModule.openPlaylistDetail('favorites');
            }

            return !isRemoving;
        } catch (err) {
            console.error('Error in toggleFavorite:', err);
            return false;
        } finally {
            // Unlock after delay
            setTimeout(() => { isTransitioning = false; }, 400);
        }
    }

    /**
     * Actualiza campos de un favorito ya existente. Escribe en IndexedDB,
     * que es la única fuente de verdad (antes se escribía en localStorage).
     */
    async function updateFavorite(videoId, newData) {
        if (!videoId || !newData) return false;

        const favorites = await getFavorites();
        const idx = favorites.findIndex(item => (item.id || item.videoId) == videoId);
        if (idx === -1) return false;

        if (newData.title) favorites[idx].title = newData.title;
        if (newData.thumbnail) favorites[idx].thumbnail = newData.thumbnail;

        await StorageModule.set(FAV_KEY, favorites);
        return true;
    }

    function updateFavoriteButtonsDOM(videoId, isFav) {
        document.querySelectorAll(`.favorite-btn[data-id="${videoId}"]`).forEach(btn => {
            btn.classList.toggle('active', isFav);
            btn.title = isFav ? "Quitar de favoritos" : "Añadir a favoritos";
            const svg = btn.querySelector('svg');
            if (svg) svg.style.fill = isFav ? 'currentColor' : 'none';
        });
    }

    async function refreshOpenPlaylistDetail(currPlId) {
        const detailView = document.getElementById('playlistDetailView');
        if (!detailView || detailView.classList.contains('hidden') || !currPlId) return;

        let plToRefresh = null;
        if (currPlId === 'favorites') {
            const lib = await LibraryModule.getLibrary();
            plToRefresh = { id: 'favorites', name: 'Favoritos', songs: lib.filter(s => isFavorite(s.videoId)) };
        } else if (typeof PlaylistModule.getPlaylists === 'function') {
            const playlists = await PlaylistModule.getPlaylists();
            plToRefresh = playlists.find(p => p.id === currPlId);
        }

        if (plToRefresh && typeof PlaylistModule.renderPlaylistSongs === 'function') {
            PlaylistModule.renderPlaylistSongs(plToRefresh);
        }
    }

    async function refreshAllUI(videoId, isFav) {
        // 1. Update all hearts in DOM directly for immediate feedback
        updateFavoriteButtonsDOM(videoId, isFav);
        await refrescarVistas();
    }

    /** Vuelve a pintar todo lo que depende de la lista de favoritos. */
    async function refrescarVistas() {
        // 2. Notify Modules
        if (typeof PlayerModule.updateFavBtn === 'function') {
            PlayerModule.updateFavBtn();
        }
        if (typeof PlaylistModule.renderGrid === 'function') await PlaylistModule.renderGrid();
        await refreshOpenPlaylistDetail(PlaylistModule.currentPlaylistId);

        // 3. Fallback for legacy renderers
        await renderFavorites();
    }

    return { getFavorites, isFavorite, toggleFavorite, updateFavorite, refreshAllUI, init, syncWithServer };
})();
