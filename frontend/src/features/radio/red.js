/**
 * ¿Datos móviles o Wi-Fi? Para «Radio solo con Wi-Fi» y la ventana más pequeña
 * con datos (plan 16, §2.3 y §2.6).
 *
 * En la APK lo dice el plugin oficial @capacitor/network. En la web solo lo
 * sabe Chrome en Android (`navigator.connection.type`); si no se sabe, se da
 * por Wi-Fi: mejor sonar que callarse por una duda.
 */

const pluginDeRed = (capacitor) => capacitor?.Plugins?.Network ?? null;

/** true solo si se sabe que va por datos móviles. */
const esMovil = (tipo) => tipo === 'cellular';

/**
 * true si la conexión es de datos móviles (ni Wi-Fi ni cable).
 * Sin conexión o sin saberlo, false.
 */
export async function redMovil({ capacitor = globalThis.Capacitor, navegador = globalThis.navigator } = {}) {
    const plugin = pluginDeRed(capacitor);
    if (plugin?.getStatus) {
        try {
            return esMovil((await plugin.getStatus())?.connectionType);
        } catch {
            return false;
        }
    }
    return esMovil(navegador?.connection?.type);
}

/**
 * Llama a `fn(movil)` cada vez que cambia la conexión. Devuelve la función
 * para dejar de escuchar.
 */
export function alCambiarRed(fn, { capacitor = globalThis.Capacitor, navegador = globalThis.navigator } = {}) {
    const plugin = pluginDeRed(capacitor);
    if (plugin?.addListener) {
        const oyente = plugin.addListener('networkStatusChange', (estado) => fn(esMovil(estado?.connectionType)));
        return () => { Promise.resolve(oyente).then((h) => h?.remove?.()).catch(() => {}); };
    }
    const conexion = navegador?.connection;
    if (!conexion?.addEventListener) return () => {};
    const alCambiar = () => fn(esMovil(conexion.type));
    conexion.addEventListener('change', alCambiar);
    return () => conexion.removeEventListener('change', alCambiar);
}
