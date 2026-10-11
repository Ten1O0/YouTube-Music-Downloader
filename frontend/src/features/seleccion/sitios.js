/**
 * Quitar cosas de una lista y volver a ponerlas en su sitio (plan 24, P9).
 * Puras: las usa el deshacer de acciones.js y se prueban sin navegador.
 */

/** Vuelve a meter cada `{ item, indice }` en su sitio, si no está ya. Cambia `lista`. Pura. */
export function reinsertar(lista, quitados, clave = (x) => x?.src) {
    const presentes = new Set(lista.map(clave));
    for (const { item, indice } of [...quitados].sort((a, b) => a.indice - b.indice)) {
        if (presentes.has(clave(item))) continue;
        lista.splice(Math.min(indice, lista.length), 0, item);
        presentes.add(clave(item));
    }
    return lista;
}

/** Separa de `lista` lo que tiene alguno de los `srcs`: lo que queda y lo quitado con su índice. Pura. */
export function separar(lista, srcs) {
    const fuera = new Set(srcs);
    const quedan = [];
    const quitados = [];
    lista.forEach((item, indice) => {
        if (fuera.has(item?.src)) quitados.push({ item, indice });
        else quedan.push(item);
    });
    return { quedan, quitados };
}
