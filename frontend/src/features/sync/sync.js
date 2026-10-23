/**
 * La sincronización de la cuenta (plan 13, T5): biblioteca, listas, ajustes y
 * escuchas en todos los dispositivos de la misma cuenta.
 *
 * Una vuelta: enviar lo pendiente, pedir «lo cambiado desde N», aplicarlo en
 * silencio y subir las escuchas nuevas. Se da al arrancar con sesión, al
 * iniciarla, al volver la red o la app al primer plano, y 3 s después del
 * último cambio local. Nunca se envía la biblioteca entera tras un cambio: solo
 * lo que ha cambiado.
 *
 * La primera vez que una cuenta sincroniza en este dispositivo, lo que ya había
 * aquí se suma a la cuenta, sin borrar nada de ninguno de los dos lados.
 * Después, la cuenta manda.
 */

import { apiBase } from '../../config/env.js';
import { StorageModule } from '../../core/storage.js';
import { i18n } from '../../i18n/language-manager.js';
import { confirmar } from '../../ui/confirm.js';
import { ceder, esperarTurno, PRIORIDAD } from '../../ui/tareas.js';
import { auth } from '../auth.js';
import { getLocalHistory } from '../history.js';
import { LibraryModule } from '../library/library.js';
import { PlayerModule } from '../player/player.js';
import { ajustesReproduccion, cambiarAjustes } from '../player/settings.js';
import { PlaylistModule } from '../playlists/playlists.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { alApuntar, apuntados, apuntar, claveDe, configurarDueno, enSilencio, enSilencioAhora, guardarPendientes, leerPendientes } from './diario.js';
import { aplicarRemotos, cancionACuenta, esNube, filasCambiadas, listaACuenta } from './fusion.js';
import { repararIds, repararIdsDeListas } from './identidad.js';
import { BORRADOS_SIN_PREGUNTAR, LIMITES } from './limites.js';
import { esVideoId, validarRemotos } from './validar.js';

const CLAVES = {
    cursor: 'sync_cursor',          // { cuenta, seq }: lo último que se conoce de esa cuenta
    cuenta: 'sync_cuenta',          // la cuenta cuya biblioteca refleja este dispositivo
    dispositivo: 'sync_dispositivo',
    ultima: 'sync_ultima',
    escuchas: 'sync_escuchas_hasta', // { [cuenta]: id local de la última escucha enviada }
};
const ESPERA_TRAS_CAMBIO = 3_000;
const ENTRE_VUELTAS_MINIMO = 10_000;
/** Sin cuenta, el buscador de ids (plan 27, T4) empieza cuando la app ya ha arrancado. */
const BUSCAR_SIN_CUENTA_TRAS = 20_000;

const cuentaActual = () => (auth.isLoggedIn() ? String(auth.user.id) : null);
const leer = async (clave) => { try { return await StorageModule.get(clave); } catch { return null; } };

/** Un identificador de este dispositivo, creado una vez. */
export async function dispositivo() {
    let id = await leer(CLAVES.dispositivo);
    if (typeof id !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
        id = globalThis.crypto?.randomUUID?.() ?? `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        await StorageModule.set(CLAVES.dispositivo, id);
    }
    return id;
}

const cabeceras = () => ({ 'Content-Type': 'application/json', ...auth.getAuthHeaders() });

/** Envía lo pendiente de `cuenta` en tandas. Lo que el servidor rechaza por inválido no se reintenta. */
async function enviarPendientes(cuenta, adoptarSinDueno) {
    let todos = await leerPendientes();
    if (adoptarSinDueno) {
        // Cambios hechos sin sesión en un dispositivo que aún no era de nadie: de esta cuenta
        todos = todos.map((c) => (c.owner == null ? { ...c, owner: cuenta } : c));
        await guardarPendientes(todos);
    }
    const mios = todos.filter((c) => c.owner === cuenta);
    const enviados = new Set();
    const disp = await dispositivo();
    for (let i = 0; i < mios.length; i += LIMITES.cambiosPorPeticion) {
        const tanda = mios.slice(i, i + LIMITES.cambiosPorPeticion);
        const res = await fetch(`${apiBase()}/api/sync`, {
            method: 'POST',
            headers: cabeceras(),
            body: JSON.stringify({ dispositivo: disp, cambios: tanda.map(({ tipo, accion, datos }) => ({ tipo, accion, datos })) }),
        });
        if (res.ok || res.status === 400 || res.status === 413) {
            if (!res.ok) console.warn(`[Sincronización] El servidor rechazó ${tanda.length} cambios (${res.status})`);
            tanda.forEach((c) => enviados.add(c.cid));
        } else {
            break; // sin red, sesión caducada, límite de peticiones: se reintenta en la próxima vuelta
        }
    }
    // Se relee: mientras se enviaba pudieron apuntarse cambios nuevos
    if (enviados.size) await guardarPendientes((await leerPendientes()).filter((c) => !enviados.has(c.cid)));
    return mios.length === enviados.size;
}

const ajustesActuales = () => ({ idioma: i18n.currentLang, reproduccion: { ...ajustesReproduccion() } });

async function aplicarAjustes(a) {
    if (a.idioma && a.idioma !== i18n.currentLang) await i18n.setLanguage(a.idioma);
    if (a.reproduccion && Object.keys(a.reproduccion).length) cambiarAjustes(a.reproduccion);
}

/** Aplica lo recibido. Si fuera a borrar más de 10 canciones con audio, pregunta antes. */
async function aplicar(remotos, cuenta, primera) {
    const pendientes = new Set((await leerPendientes()).filter((c) => c.owner === cuenta).map(claveDe));
    const local = { biblioteca: await LibraryModule.getLibrary(), listas: await getPlaylists() };
    let resultado = aplicarRemotos(local, remotos, { pendientes });

    let conservadas = [];
    const conAudio = resultado.borradas.filter((s) => !esNube(s));
    if (conAudio.length > BORRADOS_SIN_PREGUNTAR) {
        const aplicarlo = await confirmar({
            titulo: i18n.t('sync_delete_title'),
            mensaje: i18n.t('sync_delete_message', { n: conAudio.length }),
            si: i18n.t('sync_delete_yes', { n: conAudio.length }),
            no: i18n.t('sync_delete_no'),
            icono: 'delete_sweep',
            peligro: true,
        });
        if (!aplicarlo) {
            // Se quedan aquí y vuelven a la cuenta
            conservadas = conAudio;
            const quedan = new Set(conAudio.map((s) => s.videoId));
            const sinEsos = { ...remotos, biblioteca: remotos.biblioteca.filter((r) => !(r.deleted && quedan.has(r.videoId))) };
            resultado = aplicarRemotos(local, sinEsos, { pendientes });
        }
    }

    await enSilencio(async () => {
        await LibraryModule.saveLibrary(resultado.biblioteca);
        await savePlaylists(resultado.listas);
        for (const song of resultado.borradas) {
            await LibraryModule.liberarAudio(song);
            PlayerModule.removeSongFromQueue(song.src);
        }
        if (remotos.ajustes) await aplicarAjustes(remotos.ajustes);
    });

    if (conservadas.length) {
        await apuntar(conservadas.map(cancionACuenta).filter(Boolean).map((datos) => ({ tipo: 'cancion', accion: 'poner', datos })));
    }
    // La cuenta aún no tenía ajustes: los de este dispositivo
    if (primera && !remotos.ajustes) await apuntar([{ tipo: 'ajustes', accion: 'poner', datos: ajustesActuales() }]);

    if (remotos.biblioteca.length || remotos.listas.length) {
        // Casi siempre llega el eco de lo que acaba de subir este mismo dispositivo,
        // que no cambia nada: solo se rehacen las filas que cambian, y la lista
        // entera si entra, sale o se mueve alguna
        const cambiadas = filasCambiadas(local.biblioteca, resultado.biblioteca);
        // La respuesta del servidor llega cuando llega: se repinta con turno, no en mitad de un scroll
        await esperarTurno();
        if (!cambiadas || cambiadas.length > FILAS_SUELTAS) await LibraryModule.render();
        else for (const src of cambiadas) await LibraryModule.renderFila(src);
        await LibraryModule.updateCount();
        await PlaylistModule.renderGrid();
        // La lista abierta, solo si le llegó algo (una canción cambiada puede estar en ella):
        // sus filas, con turno y ancladas. Abrirla otra vez repintaba también la cabecera y
        // las recomendadas, y salía del modo de ordenar
        const abierta = PlaylistModule.currentPlaylistId;
        if (abierta && (remotos.biblioteca.length || remotos.listas.some((l) => l.id === abierta))) {
            await PlaylistModule.repintarAbiertaConTurno();
        }
    }
}

/** Sube las escuchas nuevas. La última se vuelve a mandar la próxima vez: puede seguir sumando segundos. */
async function enviarEscuchas(cuenta) {
    const marcas = (await leer(CLAVES.escuchas)) || {};
    const hasta = marcas[cuenta] ?? 0;
    let filas = [];
    try { filas = (await StorageModule.leerEscuchas()) || []; } catch { return; }
    filas = filas.filter((f) => f.id > hasta && esVideoId(f.videoId)).sort((a, b) => a.id - b.id);
    if (!filas.length) return;
    const disp = await dispositivo();
    let ultimo = hasta;
    for (let i = 0; i < filas.length; i += LIMITES.cambiosPorPeticion) {
        const tanda = filas.slice(i, i + LIMITES.cambiosPorPeticion);
        const res = await fetch(`${apiBase()}/api/sync/escuchas`, {
            method: 'POST',
            headers: cabeceras(),
            body: JSON.stringify({
                dispositivo: disp,
                escuchas: tanda.map((f) => ({ id: f.id, videoId: f.videoId, artista: f.artista ?? '', cancion: f.cancion ?? '', t: f.t, s: f.segundos ?? 0 })),
            }),
        });
        if (!res.ok && res.status !== 400) break;
        ultimo = tanda.at(-1).id;
    }
    await StorageModule.set(CLAVES.escuchas, { ...marcas, [cuenta]: Math.max(hasta, ultimo - 1) });
}

/**
 * Da su id de YouTube a las canciones descargadas que no lo tenían (de antes de
 * guardarlo): sin él no viajan. Con el historial de descargas, el local y el de
 * la cuenta. Lo reparado se guarda sin silenciar: sube a la cuenta.
 */
async function repararIdentidades(extra = new Map()) {
    const historial = [...(await getLocalHistory().catch(() => [])), ...(auth._serverHistoryCache ?? [])];
    let biblioteca = await LibraryModule.getLibrary();
    // Lo que ha encontrado el buscador, como si viniera del historial
    for (const [src, id] of extra) {
        const s = biblioteca.find((x) => x.src === src);
        if (s) historial.push({ title: s.title, id });
    }
    const r = repararIds(biblioteca, historial);
    if (!r.reparadas && !r.unidas) return 0;
    biblioteca = r.biblioteca;
    await LibraryModule.saveLibrary(biblioteca);
    const l = repararIdsDeListas(await getPlaylists(), r.ids);
    if (l.tocadas) await savePlaylists(l.listas);
    // A la vista, otra vez con turno: la búsqueda que trajo el id tarda, y el
    // repintado llegaba en mitad del scroll. Con solo ids nuevos se rehacen esas
    // filas; si alguna se unió con su copia de la nube, la lista entera
    await esperarTurno(PRIORIDAD.baja);
    if (r.unidas || r.ids.size > FILAS_SUELTAS) await LibraryModule.render({ animar: false });
    else for (const src of r.ids.keys()) await LibraryModule.renderFila(src);
    await LibraryModule.updateCount();
    // Con su id, la carátula de las que no tenían (plan 27, T4)
    if (r.ids.size) caratulas().then((m) => m.recuperarCaratulas()).catch(() => {});
    return r.reparadas;
}

/** Hasta cuántas canciones reparadas o cambiadas se rehacen fila a fila; con más, la lista entera una vez. */
const FILAS_SUELTAS = 5;

/** La búsqueda de ids y la recuperación de carátulas (plan 27, T4), cargadas aparte. */
const caratulas = () => import('../library/caratulas-recuperadas.js');
let buscando = false;

/**
 * Lo que ni la canción ni el historial saben, se busca en segundo plano: una
 * vez por canción, también sin cuenta (solo las que no tienen carátula).
 */
async function buscarIdsPendientes() {
    if (buscando) return;
    buscando = true;
    try {
        await (await caratulas()).buscarPendientes({ conCuenta: Boolean(cuentaActual()), reparar: repararIdentidades });
    } catch (e) {
        console.warn('[Carátulas]', e?.message ?? e);
    } finally {
        buscando = false;
    }
}

let enCurso = null;
let otraVuelta = false;
let ultimaVuelta = 0;
const oyentesEstado = new Set();

async function vuelta() {
    const cuenta = cuentaActual();
    if (!cuenta || globalThis.navigator?.onLine === false) return;
    // Cuando toque (plan 19, T12): nunca en mitad de un scroll o de un toque,
    // y cediendo entre paso y paso, que cada uno puede repintar la biblioteca
    await esperarTurno();
    await apuntados();
    ultimaVuelta = Date.now();
    await repararIdentidades();
    await ceder();

    const cuentaLocal = await leer(CLAVES.cuenta);
    const cursorGuardado = await leer(CLAVES.cursor);
    let cursor = cursorGuardado?.cuenta === cuenta ? cursorGuardado.seq : 0;
    const primera = cuentaLocal == null;
    if (cuentaLocal !== cuenta) {
        cursor = 0;
        if (primera) {
            // Primera vez de este dispositivo: lo de aquí se suma a la cuenta
            const [biblioteca, listas] = [await LibraryModule.getLibrary(), await getPlaylists()];
            await apuntar([
                ...biblioteca.map(cancionACuenta).filter(Boolean).map((datos) => ({ tipo: 'cancion', accion: 'poner', datos })),
                ...listas.map(listaACuenta).filter(Boolean).map((datos) => ({ tipo: 'lista', accion: 'poner', datos })),
            ]);
        }
    }

    await enviarPendientes(cuenta, primera);
    await ceder();

    const res = await fetch(`${apiBase()}/api/sync?desde=${cursor}`, { headers: auth.getAuthHeaders() });
    if (!res.ok) return;
    const remotos = validarRemotos(await res.json());
    if (!remotos) return;
    await ceder();
    await aplicar(remotos, cuenta, primera);
    await StorageModule.set(CLAVES.cursor, { cuenta, seq: remotos.seq });
    await StorageModule.set(CLAVES.cuenta, cuenta);
    await StorageModule.set(CLAVES.ultima, Date.now());

    await enviarEscuchas(cuenta);
    // Sin esperar: tarda y no bloquea la próxima vuelta
    buscarIdsPendientes();
}

/** Una vuelta de sincronización. Si ya hay una en marcha, se da otra al terminar. */
export function sincronizar() {
    if (enCurso) { otraVuelta = true; return enCurso; }
    enCurso = vuelta()
        .catch((e) => console.warn('[Sincronización] No se pudo sincronizar:', e?.message ?? e))
        .finally(async () => {
            enCurso = null;
            for (const fn of oyentesEstado) fn(await estadoSincronizacion());
            if (otraVuelta) { otraVuelta = false; programar(ESPERA_TRAS_CAMBIO); }
        });
    return enCurso;
}

let temporizador = null;
// Con un aviso de deshacer a la vista (plan 24, P9), lo apuntado espera: a la
// cuenta no llega un borrado que luego se deshace
let deshacerPendiente = false;
function programar(ms) {
    clearTimeout(temporizador);
    temporizador = setTimeout(() => (deshacerPendiente ? programar(ESPERA_TRAS_CAMBIO) : sincronizar()), ms);
}
globalThis.document?.addEventListener('deshacer-pendiente', (e) => {
    deshacerPendiente = e.detail === true;
});

/** Para la hoja «Tus datos»: cuándo fue la última y cuántos cambios esperan. */
export async function estadoSincronizacion() {
    const cuenta = cuentaActual();
    const pendientes = (await leerPendientes()).filter((c) => c.owner === (cuenta ?? c.owner)).length;
    return { conSesion: Boolean(cuenta), ultima: (await leer(CLAVES.ultima)) ?? null, pendientes };
}

export function alCambiarEstado(fn) {
    oyentesEstado.add(fn);
}

export function iniciarSincronizacion() {
    configurarDueno(async () => cuentaActual() ?? (await leer(CLAVES.cuenta)) ?? null);
    alApuntar(() => {
        if (cuentaActual()) programar(ESPERA_TRAS_CAMBIO);
        estadoSincronizacion().then((e) => oyentesEstado.forEach((fn) => fn(e)));
    });

    // Los ajustes y el idioma, solo cuando los cambia el usuario (no al arrancar)
    const anotarAjustes = () => {
        if (!enSilencioAhora()) apuntar([{ tipo: 'ajustes', accion: 'poner', datos: ajustesActuales() }]);
    };
    document.addEventListener('ajustes-elegidos', anotarAjustes);
    document.addEventListener('idioma-elegido', anotarAjustes);

    globalThis.addEventListener('online', () => programar(0));
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - ultimaVuelta > ENTRE_VUELTAS_MINIMO) programar(0);
    });
    document.addEventListener('sesion-iniciada', () => programar(0));

    if (cuentaActual()) programar(0);
    // Sin cuenta no hay vueltas que lancen el buscador: una vez, ya arrancada la app
    else setTimeout(buscarIdsPendientes, BUSCAR_SIN_CUENTA_TRAS);
}

