/**
 * Medir la sonoridad de lo que ya estaba descargado (plan 12, T5).
 *
 * Lo nuevo llega medido por el servidor; lo de antes y lo importado del móvil
 * se mide aquí, en segundo plano: una canción cada vez, con el navegador
 * desocupado, nunca mientras se descarga algo ni con la batería por debajo del
 * 20 % sin cargar. Decodificar remuestrea a 22.050 Hz, que basta para medir y
 * deja una canción de 4 minutos en unos 21 MB por canal.
 *
 * Se guarda en la biblioteca y en las copias de las listas. No se aplica a la
 * canción que suena: su volumen cambiaría de golpe a mitad; se aplica la
 * próxima vez que suene.
 */

import { isNative } from '../../config/env.js';
import { IDB_SRC_PREFIX } from '../../core/audio-store.js';
import { medidaSonoridad, siguienteSinMedir, sonoridad } from '../../core/loudness.js';
import { StorageModule } from '../../core/storage.js';
import { queueManager } from '../download/queue.js';
import { LibraryModule } from '../library/library.js';
import { getPlaylists, savePlaylists } from '../playlists/store.js';
import { esperarTurno, PRIORIDAD } from '../../ui/tareas.js';

const FRECUENCIA = 22050;
/** Unos 15 minutos de audio: más grande no se decodifica entero en un móvil modesto. */
export const MAX_BYTES = 15 * 1024 * 1024;
const CLAVE_FALLOS = 'ytdl_loudness_fallos';
/** Entre canción y canción: decodificar una entera es lo más pesado que se hace en segundo plano. */
const PAUSA = 10_000;
const ESPERA_SIN_TRABAJO = 5 * 60_000;

/** El audio de la canción, de donde esté guardado. null si no está en el dispositivo. */
async function leerAudio(song) {
    if (typeof song.src === 'string' && song.src.startsWith(IDB_SRC_PREFIX)) {
        const blob = await StorageModule.getBlob(song.src.slice(IDB_SRC_PREFIX.length));
        if (!blob || blob.size > MAX_BYTES) return null;
        return blob.arrayBuffer();
    }
    const fs = globalThis.Capacitor?.Plugins?.Filesystem;
    if (isNative() && fs && song.localPath) {
        const directory = song.localPath.startsWith('imported_') ? 'DATA' : 'DOCUMENTS';
        const { uri } = await fs.getUri({ path: song.localPath, directory });
        const respuesta = await fetch(globalThis.Capacitor.convertFileSrc(uri));
        if (!respuesta.ok || Number(respuesta.headers.get('content-length')) > MAX_BYTES) return null;
        const datos = await respuesta.arrayBuffer();
        return datos.byteLength > MAX_BYTES ? null : datos;
    }
    // En el servidor o en una URL: no se descarga entera solo para medirla
    return null;
}

let trabajador = null;
let peticiones = 0;

/**
 * La cuenta, en un Worker (plan 19, T12). Si no se puede crear, en el hilo
 * principal como antes: tarda lo mismo, pero sin tirones solo en el Worker.
 */
function contar(canales, fs) {
    try {
        trabajador ??= new Worker(new URL('./loudness-worker.js', import.meta.url), { type: 'module' });
    } catch {
        return sonoridad(canales, fs);
    }
    const id = ++peticiones;
    const w = trabajador;
    return new Promise((ok, ko) => {
        const terminar = () => {
            w.removeEventListener('message', alResponder);
            w.removeEventListener('error', alFallar);
        };
        const alResponder = ({ data }) => {
            if (data?.id !== id) return;
            terminar();
            ok(data.medida);
        };
        // Un Worker que no carga (sin conexión en la web, por ejemplo) se
        // descarta: el siguiente turno lo vuelve a crear
        const alFallar = (e) => {
            terminar();
            if (trabajador === w) trabajador = null;
            ko(e);
        };
        w.addEventListener('message', alResponder);
        w.addEventListener('error', alFallar);
        w.postMessage({ id, canales, fs }, canales.map((c) => c.buffer));
    });
}

async function medir(song) {
    const datos = await leerAudio(song);
    if (!datos) return null;
    const ctx = new OfflineAudioContext(1, 1, FRECUENCIA);
    const buffer = await ctx.decodeAudioData(datos);
    // Los canales originales, ya remuestreados: se miden como manda la norma.
    // Copiados, porque los del AudioBuffer no se pueden transferir al Worker
    const canales = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, i) => buffer.getChannelData(i).slice());
    return contar(canales, buffer.sampleRate);
}

async function puedeTrabajar() {
    if (document.visibilityState !== 'visible' || queueManager.hayActivas()) return false;
    try {
        const bateria = await navigator.getBattery?.();
        if (bateria && !bateria.charging && bateria.level < 0.2) return false;
    } catch { /* sin API de batería: se sigue */ }
    return true;
}

async function guardar(src, loudness) {
    const biblioteca = await LibraryModule.getLibrary();
    const i = biblioteca.findIndex((s) => s.src === src);
    if (i < 0) return;
    biblioteca[i] = { ...biblioteca[i], loudness };
    await LibraryModule.saveLibrary(biblioteca);

    const listas = await getPlaylists();
    let tocadas = false;
    for (const pl of listas) {
        for (const s of pl.songs ?? []) {
            if (s.src === src && !s.loudness) { s.loudness = loudness; tocadas = true; }
        }
    }
    if (tocadas) await savePlaylists(listas);
}

let temporizador = null;

function programar(ms) {
    clearTimeout(temporizador);
    // Con el planificador (plan 19, T12): nunca con el dedo en la pantalla ni
    // en mitad de un scroll, y detrás de lo que el usuario echaría en falta antes
    temporizador = setTimeout(() => esperarTurno(PRIORIDAD.baja).then(turno), ms);
}

async function turno() {
    if (!(await puedeTrabajar())) return programar(30_000);
    const [biblioteca, fallos] = await Promise.all([LibraryModule.getLibrary(), StorageModule.get(CLAVE_FALLOS).catch(() => null)]);
    const song = siguienteSinMedir(biblioteca, fallos || {});
    if (!song) return programar(ESPERA_SIN_TRABAJO);

    let medida = null;
    try {
        medida = medidaSonoridad(await medir(song), 'cliente');
    } catch (e) {
        console.debug('[Sonoridad] No se pudo medir', song.title, e);
    }
    if (medida) {
        await guardar(song.src, medida);
    } else {
        // Sin medida (no está en el dispositivo, es silencio o no se decodifica): se reintenta poco
        const f = fallos || {};
        f[song.src] = (f[song.src] ?? 0) + 1;
        await StorageModule.set(CLAVE_FALLOS, f).catch(() => {});
    }
    programar(PAUSA);
}

/** Arranca la medición en segundo plano. Espera un poco para no competir con el arranque. */
export function iniciarMedicionSonoridad() {
    if (typeof OfflineAudioContext === 'undefined') return;
    programar(15_000);
}
