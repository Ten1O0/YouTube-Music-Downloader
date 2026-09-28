/**
 * Listas de YouTube que se siguen (plan 14, T4): seguir, recibir y descargar.
 *
 * Seguir una lista crea una lista propia vinculada (con su distintivo) y trae
 * lo que la lista de YouTube vaya añadiendo. Lo nuevo llega «en la nube» y se
 * descarga solo si «Descargar automáticamente» está activado (y, en la APK,
 * con Wi-Fi si así se eligió). Lo que se borra de la lista de YouTube no se
 * borra de la tuya: seguir es traer lo nuevo, no copiar la lista.
 *
 * Con sesión, el servidor la vigila cada 6 horas y lo nuevo llega a cualquier
 * dispositivo. Sin sesión, la comprueba este dispositivo al abrir la app, como
 * mucho una vez cada 6 horas por lista. Las reglas están en seguidas.js.
 */

import { apiBase, isNative } from '../config/env.js';
import { StorageModule } from '../core/storage.js';
import { i18n } from '../i18n/language-manager.js';
import { avisarSistema } from '../native/notifications.js';
import { confirmar } from '../ui/confirm.js';
import { avisar } from '../ui/toast.js';
import { auth } from './auth.js';
import { LibraryModule } from './library/library.js';
import { PlaylistModule } from './playlists/playlists.js';
import { getPlaylists, savePlaylists } from './playlists/store.js';
import {
    AJUSTES_SEGUIMIENTO, MAX_CANCIONES_AL_SEGUIR, PREGUNTAR_DESDE, cancionDeLista, esSeguida, incorporar,
    listaDe, listaVinculada, nuevasDe, puedeDescargarSolo, sinVinculo, tocaComprobar,
} from './seguidas.js';
import { nombreLibre } from './sync/fusion.js';
import { LIMITES } from './sync/limites.js';
import { descargarVarias } from './sync/nube.js';
import { hidePlaylistSelector, listaMostrada } from './youtube-playlist.js';

const CLAVE = 'ytdl_seguidas';            // [{ listId, title, localPlaylistId, autoDownload, vistas, comprobada }]
const CLAVE_AJUSTES = 'ytdl_seguimiento'; // { auto, soloWifi }

// ─── Estado local ───

export async function leerSeguidas() {
    try { return (await StorageModule.get(CLAVE)) || []; } catch { return []; }
}
const guardarSeguidas = (lista) => StorageModule.set(CLAVE, lista);

export async function leerAjustesSeguimiento() {
    try { return { ...AJUSTES_SEGUIMIENTO, ...((await StorageModule.get(CLAVE_AJUSTES)) || {}) }; }
    catch { return { ...AJUSTES_SEGUIMIENTO }; }
}

export async function cambiarAjustesSeguimiento(cambios) {
    const ajustes = { ...(await leerAjustesSeguimiento()), ...cambios };
    await StorageModule.set(CLAVE_AJUSTES, ajustes);
    return ajustes;
}

const cabeceras = () => ({ 'Content-Type': 'application/json', ...auth.getAuthHeaders() });
const nombreDe = (titulo) => titulo || i18n.t('follow_default_name');

async function repintar(localPlaylistId) {
    await LibraryModule.render();
    await LibraryModule.updateCount();
    await PlaylistModule.renderGrid();
    if (PlaylistModule.currentPlaylistId === localPlaylistId) await PlaylistModule.openPlaylistDetail(localPlaylistId);
}

/** Guarda en la biblioteca y en la lista vinculada lo que trae una lista seguida. */
async function guardarIncorporadas(localPlaylistId, canciones, { titulo, listId }) {
    let listas = await getPlaylists();
    const existente = listas.find((pl) => pl.id === localPlaylistId);
    if (!existente) {
        // Aún no está aquí (otro dispositivo empezó a seguirla, o se borró): se crea
        const nombre = nombreLibre(nombreDe(titulo).slice(0, LIMITES.nombreLista), listas.map((pl) => pl.name));
        listas = [...listas, listaVinculada({ id: localPlaylistId, nombre, listId })];
    } else if (!esSeguida(existente)) {
        // El vínculo no viaja con la sincronización: se recupera aquí
        listas = listas.map((pl) => (pl.id === localPlaylistId ? { ...pl, origen: { tipo: 'youtube', lista: listId } } : pl));
    }
    const r = incorporar({ biblioteca: await LibraryModule.getLibrary(), listas }, localPlaylistId, canciones);
    if (r.nuevasEnNube.length) await LibraryModule.saveLibrary(r.biblioteca);
    await savePlaylists(r.listas);
    await repintar(localPlaylistId);
    return r;
}

/** Baja lo nuevo si toca. Devuelve si se puso a descargar. */
async function descargarSiToca(nuevas, auto) {
    if (!nuevas.length || !auto || !puedeDescargarSolo(await leerAjustesSeguimiento())) return false;
    descargarVarias(nuevas).catch((e) => console.warn('[Seguidas] Descarga automática:', e));
    return true;
}

/**
 * Seguir una lista. `videos`: lo que enseña el selector. Sin sesión es lo
 * único que hay; con sesión, el servidor la vuelve a leer y manda él.
 */
export async function seguirLista({ url, titulo = '', videos = [] }) {
    const listId = listaDe(url);
    if (!listId) { avisar(i18n.t('follow_cannot')); return null; }
    if (videos.length > MAX_CANCIONES_AL_SEGUIR) { avisar(i18n.t('follow_too_big', { n: MAX_CANCIONES_AL_SEGUIR })); return null; }
    const ajustes = await leerAjustesSeguimiento();
    const seguidas = await leerSeguidas();
    const localPlaylistId = seguidas.find((s) => s.listId === listId)?.localPlaylistId ?? Date.now().toString();

    let canciones = videos.map(cancionDeLista).filter(Boolean);
    if (auth.isLoggedIn()) {
        const res = await fetch(`${apiBase()}/api/follows`, {
            method: 'POST', headers: cabeceras(),
            body: JSON.stringify({ lista: listId, localPlaylistId, autoDownload: ajustes.auto }),
        }).catch(() => null);
        const datos = res ? await res.json().catch(() => ({})) : {};
        if (!res?.ok) { avisar(datos.error || i18n.t('follow_error')); return null; }
        canciones = (datos.canciones ?? []).map(cancionDeLista).filter(Boolean);
        titulo = datos.title || titulo;
    }

    await guardarSeguidas([
        ...seguidas.filter((s) => s.listId !== listId),
        { listId, title: titulo, localPlaylistId, autoDownload: ajustes.auto, vistas: canciones.map((c) => c.videoId), comprobada: Date.now() },
    ]);
    const r = await guardarIncorporadas(localPlaylistId, canciones, { titulo, listId });
    avisar(i18n.t('follow_done', { name: nombreDe(titulo), n: canciones.length }));

    // Las que no estaban aquí: si son muchas se pregunta; si no, se bajan si toca
    if (r.nuevasEnNube.length > PREGUNTAR_DESDE) {
        const si = await confirmar({
            titulo: i18n.t('follow_many_title'),
            mensaje: i18n.t('follow_many_message', { n: r.nuevasEnNube.length }),
            si: i18n.t('follow_many_yes', { n: r.nuevasEnNube.length }),
            no: i18n.t('follow_many_no'),
            icono: 'cloud_download',
        });
        if (si) descargarVarias(r.nuevasEnNube).catch((e) => console.warn('[Seguidas] Descarga:', e));
    } else {
        await descargarSiToca(r.nuevasEnNube, ajustes.auto);
    }
    return { localPlaylistId, listId };
}

/** Con sesión: lo que el servidor ha ido apuntando. */
async function traerDelServidor() {
    const res = await fetch(`${apiBase()}/api/follows`, { headers: auth.getAuthHeaders() }).catch(() => null);
    if (!res?.ok) return null;
    const { listas = [] } = await res.json().catch(() => ({}));
    const traidas = [];
    const locales = await leerSeguidas();
    for (const l of listas) {
        const nuevas = (l.nuevas ?? []).map(cancionDeLista).filter(Boolean);
        if (!nuevas.length) continue;
        const r = await guardarIncorporadas(l.localPlaylistId, nuevas, { titulo: l.title, listId: l.listId });
        await fetch(`${apiBase()}/api/follows/entregadas`, {
            method: 'POST', headers: cabeceras(),
            body: JSON.stringify({ listId: l.listId, videoIds: nuevas.map((c) => c.videoId) }),
        }).catch(() => {});
        await descargarSiToca(r.nuevasEnNube, l.autoDownload);
        traidas.push({ titulo: l.title, n: nuevas.length, localPlaylistId: l.localPlaylistId });
    }
    // Las de la cuenta quedan apuntadas aquí también (para «Dejar de seguir» y el distintivo)
    await guardarSeguidas(listas.map((l) => ({
        ...(locales.find((s) => s.listId === l.listId) ?? { vistas: [] }),
        listId: l.listId, title: l.title, localPlaylistId: l.localPlaylistId, autoDownload: l.autoDownload,
        disponible: l.available !== false, comprobada: Date.now(),
    })));
    return traidas;
}

/** Sin sesión: este dispositivo pregunta a YouTube por cada lista que toque. */
async function comprobarAqui(forzar) {
    const traidas = [];
    const seguidas = await leerSeguidas();
    for (const s of seguidas) {
        if (!tocaComprobar(s, Date.now(), forzar)) continue;
        const res = await fetch(`${apiBase()}/api/playlist-info`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: `https://www.youtube.com/playlist?list=${s.listId}` }),
        }).catch(() => null);
        if (!res?.ok) continue;
        const { videos = [], title } = await res.json().catch(() => ({}));
        const nuevas = nuevasDe(videos, s.vistas);
        s.vistas = [...(s.vistas ?? []), ...nuevas.map((c) => c.videoId)];
        s.comprobada = Date.now();
        if (title && !s.title) s.title = title;
        if (!nuevas.length) continue;
        const r = await guardarIncorporadas(s.localPlaylistId, nuevas, { titulo: s.title, listId: s.listId });
        await descargarSiToca(r.nuevasEnNube, s.autoDownload);
        traidas.push({ titulo: s.title, n: nuevas.length, localPlaylistId: s.localPlaylistId });
    }
    await guardarSeguidas(seguidas);
    return traidas;
}

let comprobando = null;

/**
 * Trae lo nuevo de las listas seguidas. Con `forzar` (el botón «Buscar
 * novedades»), sin esperar las 6 horas. Devuelve lo que ha traído.
 */
export function comprobarNovedades({ forzar = false } = {}) {
    comprobando ??= (async () => {
        if (globalThis.navigator?.onLine === false) return [];
        const traidas = (auth.isLoggedIn() ? await traerDelServidor() : await comprobarAqui(forzar)) ?? [];
        for (const t of traidas) {
            const texto = i18n.t('follow_new', { name: nombreDe(t.titulo), n: t.n });
            // Con la app delante, dentro de la app; si no, aviso del sistema (§2.4)
            if (document.visibilityState === 'visible') avisar(texto);
            else avisarSistema({ titulo: i18n.t('follow_new_title'), texto, destino: { vista: 'playlist', id: t.localPlaylistId } });
        }
        return traidas;
    })().finally(() => { comprobando = null; });
    return comprobando;
}

/** Deja de seguir: la lista se queda como una lista normal, con lo que ya tenía. */
export async function dejarDeSeguir(localPlaylistId) {
    const seguidas = await leerSeguidas();
    const listas = await getPlaylists();
    const pl = listas.find((x) => x.id === localPlaylistId);
    const listId = seguidas.find((x) => x.localPlaylistId === localPlaylistId)?.listId ?? pl?.origen?.lista;
    if (listId && auth.isLoggedIn()) {
        const res = await fetch(`${apiBase()}/api/follows/${encodeURIComponent(listId)}`, {
            method: 'DELETE', headers: auth.getAuthHeaders(),
        }).catch(() => null);
        // Sin red, se deja como estaba: si no, el servidor la seguiría vigilando
        if (!res || (!res.ok && res.status !== 404)) { avisar(i18n.t('follow_error')); return false; }
    }
    await guardarSeguidas(seguidas.filter((x) => x.localPlaylistId !== localPlaylistId && x.listId !== listId));
    if (pl && esSeguida(pl)) await savePlaylists(listas.map((x) => (x.id === localPlaylistId ? sinVinculo(x) : x)));
    await repintar(localPlaylistId);
    avisar(i18n.t('follow_stopped'));
    return true;
}

// ─── Interfaz ───

/** El botón «Seguir esta lista» del selector: solo con una lista que se pueda seguir. */
function pintarBotonSeguir() {
    const boton = document.getElementById('followPlaylistBtn');
    if (!boton) return;
    const mostrada = listaMostrada();
    boton.hidden = !mostrada || !listaDe(mostrada.url);
}

/** La barra de la lista vinculada en su detalle. */
async function pintarBarra(pl) {
    const barra = document.getElementById('plFollowBar');
    if (!barra) return;
    barra.hidden = !esSeguida(pl);
    if (barra.hidden) return;
    const seguida = (await leerSeguidas()).find((s) => s.localPlaylistId === pl.id);
    const texto = document.getElementById('plFollowText');
    if (texto) {
        texto.textContent = seguida?.disponible === false ? i18n.t('follow_unavailable') : i18n.t('follow_linked');
    }
    const buscar = document.getElementById('plFollowCheck');
    const dejar = document.getElementById('plFollowStop');
    if (buscar) {
        buscar.onclick = async () => {
            buscar.disabled = true;
            try {
                const traidas = await comprobarNovedades({ forzar: true });
                if (!traidas.some((t) => t.localPlaylistId === pl.id)) avisar(i18n.t('follow_nothing_new'));
            } finally { buscar.disabled = false; }
        };
    }
    if (dejar) {
        dejar.onclick = async () => {
            const si = await confirmar({
                titulo: i18n.t('follow_stop_title'),
                mensaje: i18n.t('follow_stop_message'),
                si: i18n.t('follow_stop'),
                no: i18n.t('follow_keep'),
                icono: 'playlist_remove',
            });
            if (si) await dejarDeSeguir(pl.id);
        };
    }
}

/** Los interruptores de «Tus datos». «Solo con Wi-Fi», solo en la APK. */
async function initAjustes() {
    const auto = document.getElementById('followAuto');
    const wifi = document.getElementById('followWifi');
    const ajustes = await leerAjustesSeguimiento();
    if (auto) {
        auto.checked = ajustes.auto;
        auto.addEventListener('change', () => cambiarAjustesSeguimiento({ auto: auto.checked }));
    }
    if (wifi) {
        document.getElementById('followWifiAjuste').hidden = !isNative();
        wifi.checked = ajustes.soloWifi;
        wifi.addEventListener('change', () => cambiarAjustesSeguimiento({ soloWifi: wifi.checked }));
    }
}

let ultimaVuelta = 0;
const ENTRE_VUELTAS = 30 * 60_000;

export function initSeguimiento() {
    initAjustes().catch(() => {});
    document.getElementById('followPlaylistBtn')?.addEventListener('click', async (e) => {
        const mostrada = listaMostrada();
        if (!mostrada) return;
        const boton = e.currentTarget;
        boton.disabled = true;
        try {
            const hecho = await seguirLista(mostrada);
            if (hecho) {
                hidePlaylistSelector();
                await PlaylistModule.openPlaylistDetail(hecho.localPlaylistId);
            }
        } finally { boton.disabled = false; }
    });
    document.addEventListener('lista-yt-mostrada', pintarBotonSeguir);
    document.addEventListener('lista-abierta', (e) => { pintarBarra(e.detail).catch(() => {}); });

    const vuelta = () => {
        ultimaVuelta = Date.now();
        comprobarNovedades().catch((e) => console.warn('[Seguidas]', e));
    };
    // Al arrancar, sin estorbar el primer pintado; al volver al primer plano, como mucho cada 30 min
    setTimeout(vuelta, 4_000);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - ultimaVuelta > ENTRE_VUELTAS) vuelta();
    });
    document.addEventListener('sesion-iniciada', vuelta);
}
