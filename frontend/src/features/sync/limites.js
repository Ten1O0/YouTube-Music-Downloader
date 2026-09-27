/**
 * Límites de la sincronización y de la copia de seguridad (plan 13). Los mismos
 * que valida el servidor (SYNC_* en backend/server.py y MAX_* en database.py):
 * si se cambia uno, se cambia en los dos sitios.
 */

export const LIMITES = Object.freeze({
    cancionesCuenta: 10_000,
    listasCuenta: 200,
    cancionesLista: 1_000,
    cambiosPorPeticion: 500,
    bytesCopia: 20 * 1024 * 1024,
    escuchasCopia: 200_000,
    titulo: 300,
    canal: 120,
    artista: 120,
    cancion: 120,
    extra: 120,
    nombreLista: 40,
    descripcionLista: 200,
    duracion: 86_400,
});

export const IDIOMAS = Object.freeze(['es', 'en', 'fr', 'de', 'pt', 'zh']);
export const FUNDIDOS_VALIDOS = Object.freeze([0, 2, 4, 6, 8, 12]);

export const RE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
export const RE_LISTA_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Cuántas canciones puede borrar una sincronización sin preguntar (§2.5). */
export const BORRADOS_SIN_PREGUNTAR = 10;
