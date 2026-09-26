/**
 * Aviso de nueva versión de la APK.
 *
 * La APK lleva la web dentro, así que no se actualiza sola al desplegar: quien
 * solo usa la app no se enteraría nunca de que hay una versión nueva. Al
 * arrancar, si hay conexión, la app pregunta al servidor cuál es la última
 * (/api/app/version, que lee public/app-version.json) y, si es más nueva que
 * la instalada, la anuncia con sus novedades. Actualizar es decisión del
 * usuario: «Ahora no» la aparca unos días.
 */

export const ESPERA_TRAS_DESCARTAR_MS = 3 * 24 * 60 * 60 * 1000;
export const CLAVE_DESCARTE = 'actualizacion-descartada';

/**
 * ¿Hay que avisar? Solo si la del servidor es más nueva que la instalada y el
 * usuario no ha dicho «Ahora no» a esa misma versión hace menos de 3 días.
 */
export function hayActualizacion({ instalada, remota, descartada = null, ahora = Date.now() }) {
    const nueva = Number(remota?.versionCode);
    const actual = Number(instalada);
    if (!Number.isFinite(nueva) || !Number.isFinite(actual) || nueva <= actual) return false;
    if (descartada?.versionCode === nueva && ahora - Number(descartada.fecha) < ESPERA_TRAS_DESCARTAR_MS) return false;
    return true;
}

/** Las novedades en el idioma de la interfaz; si no están, en castellano. */
export function novedadesEn(remota, idioma) {
    const todas = remota?.novedades ?? {};
    const lista = todas[idioma] ?? todas.es ?? [];
    return Array.isArray(lista) ? lista.filter(n => typeof n === 'string' && n.trim()) : [];
}
