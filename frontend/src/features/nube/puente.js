/**
 * El puente de escuchar desde la nube (plan 29): lo que el reproductor y las
 * filas necesitan, sin cargar nube/escuchar.js hasta que hace falta (una cola
 * con canciones de la nube, o «Guardar»). Como el de la radio (radio/puente.js).
 */

let carga = null;
const escuchar = () => (carga ??= import('./escuchar.js'));

/** La que va a sonar está en la nube: lista para sonar, o null si no se pudo (ya se avisa y se salta). */
export const desdeLaNube = async (song) => (await escuchar()).sonar(song);

/** Con cada canción: si hay canciones de la nube en la cola, se preparan las siguientes. */
export function revisarNube(cola, indice, repetir) {
    if (cola.some((s) => s?.nube || s?.desdeNube)) escuchar().then((m) => m.revisar(cola, indice, repetir)).catch(() => {});
}

/** «Guardar» una que suena desde la nube (de la radio, preparada o aún en la nube). */
export const guardarDesdeLaNube = async (song) => (await escuchar()).guardar(song);
