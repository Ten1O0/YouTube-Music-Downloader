/**
 * Cargar cada cosa al usarla (plan 19, T11).
 *
 * Importar listas, «Tus datos», el editor o el aviso de actualización no se
 * usan al arrancar: su código se descarga y se analiza aparte, con `import()`.
 * Para que el primer toque no espere, se precargan cuando la app queda en
 * reposo; si el toque llega antes, se carga en ese momento y el toque se
 * repite en cuanto el módulo está listo, así que para el usuario es lo mismo.
 */

/**
 * Envuelve la carga (y el arranque) de un módulo para que ocurra una sola vez.
 * Devuelve una función que la dispara y promete lo que prometa `cargar`.
 * Si falla (sin conexión en la web, por ejemplo), el siguiente intento lo
 * vuelve a probar.
 */
export function diferido(cargar) {
    let promesa = null;
    const obtener = () => {
        promesa ??= cargar().then((valor) => {
            obtener.listo = true;
            return valor;
        }, (e) => {
            promesa = null;
            throw e;
        });
        return promesa;
    };
    obtener.listo = false;
    return obtener;
}

/**
 * Mientras el módulo no está cargado, un toque en `selector` lo carga y se
 * repite al terminar; a partir de ahí, el módulo atiende sus propios toques.
 */
export function alPrimerToque(selector, obtener) {
    document.addEventListener('click', (e) => {
        if (obtener.listo) return;
        const el = e.target?.closest?.(selector);
        if (!el) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        obtener().then(() => el.click(), (err) => console.warn('[Carga] No se pudo cargar:', selector, err));
    }, { capture: true });
}
