/**
 * Contar escuchas (plan 11, T5).
 *
 * Una reproducción cuenta cuando se han escuchado de verdad 30 s, o la mitad de
 * la canción si dura menos de un minuto (el criterio de Spotify). Arrastrar la
 * barra no suma: solo cuentan los avances pequeños entre dos `timeupdate`.
 *
 * Cada escucha deja dos huellas:
 * - el contador de la canción (`ytdl_escuchas`), que usan las listas
 *   automáticas: { [clave]: { n, ultima, segundos } };
 * - una fila en el registro (IndexedDB `escuchas`), que usará «Tu año en
 *   música» (plan 17). Empieza a llenarse aquí para que haya historia cuando
 *   llegue ese plan.
 */

import { nombreDe } from '../../core/titles.js';
import { StorageModule } from '../../core/storage.js';

export const CLAVE_CONTADORES = 'ytdl_escuchas';

/** Un avance mayor que esto entre dos timeupdate es un salto, no escucha. */
const SALTO_MAXIMO = 2;

/** Segundos que hay que escuchar para que cuente. */
export const umbralEscucha = (duracion) => (duracion > 0 && duracion < 60 ? duracion / 2 : 30);

/** Identidad de una canción en los contadores: la misma en todos los dispositivos si tiene videoId. */
export const claveEscucha = (song) => song?.videoId || song?.src || null;

/**
 * Lógica pura del contador. `alContar(song, segundos)` se llama una vez por
 * reproducción al cruzar el umbral; `alCerrar(song, segundos)`, al acabar una
 * reproducción que contó, con el total escuchado.
 */
export function crearContador({ alContar, alCerrar }) {
    let cancion = null;
    let escuchado = 0;
    let ultimo = null;
    let contada = false;

    function cerrar() {
        if (cancion && contada) alCerrar?.(cancion, escuchado);
        cancion = null;
        escuchado = 0;
        ultimo = null;
        contada = false;
    }

    return {
        /** Empieza una reproducción (también al repetir la misma canción). */
        nueva(song) {
            cerrar();
            cancion = song;
        },
        /** Llega un timeupdate. */
        avance(tiempo, duracion) {
            if (!cancion) return;
            if (ultimo !== null) {
                const delta = tiempo - ultimo;
                if (delta > 0 && delta < SALTO_MAXIMO) escuchado += delta;
            }
            ultimo = tiempo;
            if (!contada && escuchado >= umbralEscucha(duracion)) {
                contada = true;
                alContar?.(cancion, escuchado);
            }
        },
        /** Se ha movido la barra: la posición nueva no es escucha. */
        saltar(tiempo) { ultimo = tiempo; },
        /** Pausa: al reanudar, el primer avance no debe sumar el tiempo parado. */
        pausar() { ultimo = null; },
        cerrar,
        /** Segundos escuchados de la reproducción actual (para volcar al ocultar la app). */
        escuchado: () => escuchado,
        cancion: () => cancion,
    };
}

/** Actualiza el contador de una canción. Función pura: devuelve el mapa nuevo. */
export function sumarEscucha(contadores, clave, segundos, ahora) {
    const previo = contadores?.[clave] ?? { n: 0, segundos: 0 };
    return {
        ...contadores,
        [clave]: { n: previo.n + 1, ultima: ahora, segundos: Math.round((previo.segundos ?? 0) + segundos) },
    };
}

/**
 * Engancha el contador a un elemento de audio y lo guarda en el almacenamiento.
 * Devuelve el contador para que el reproductor le avise de cada canción nueva.
 */
export function crearRegistroEscuchas(audio) {
    let filaActual = null; // id de la fila del registro de la reproducción en curso
    let contadasEnCurso = 0;

    const contador = crearContador({
        async alContar(song, segundos) {
            const clave = claveEscucha(song);
            if (!clave) return;
            contadasEnCurso++;
            try {
                const contadores = await StorageModule.get(CLAVE_CONTADORES) || {};
                await StorageModule.set(CLAVE_CONTADORES, sumarEscucha(contadores, clave, segundos, new Date().toISOString()));
                const nombre = nombreDe(song);
                filaActual = await StorageModule.anotarEscucha({
                    clave, videoId: song.videoId || '', artista: nombre.artista, cancion: nombre.titulo,
                    t: Date.now(), segundos: Math.round(segundos),
                });
            } catch (e) {
                console.debug('[Escuchas] No se pudo anotar la escucha:', e);
            } finally {
                contadasEnCurso--;
            }
        },
        async alCerrar(song, segundos) {
            const fila = filaActual;
            filaActual = null;
            if (fila == null) return;
            try {
                await StorageModule.actualizarEscucha(fila, { segundos: Math.round(segundos) });
            } catch (e) {
                console.debug('[Escuchas] No se pudieron actualizar los segundos:', e);
            }
        },
    });

    audio.addEventListener('timeupdate', () => contador.avance(audio.currentTime, audio.duration));
    audio.addEventListener('seeked', () => contador.saltar(audio.currentTime));
    audio.addEventListener('pause', () => contador.pausar());
    // Al acabar se cierra la reproducción y se deja preparada otra de la misma
    // canción: con «Repetir una» el reproductor vuelve a empezar sin pasar por
    // play(), y cada vuelta debe contar. Si pasa a otra, play() la sustituye.
    audio.addEventListener('ended', () => contador.nueva(contador.cancion()));
    // Al ocultar la app (o cerrarla en el móvil) se guardan los segundos hasta aquí
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden' && filaActual != null && !contadasEnCurso) {
            StorageModule.actualizarEscucha(filaActual, { segundos: Math.round(contador.escuchado()) }).catch(() => {});
        }
    });
    return contador;
}
