/**
 * Textos de escuchar desde la nube (plan 29, T1-T3), en los seis idiomas.
 *
 * Viven aquí y no en las traducciones porque el castellano de estas va en el
 * código de arranque, que no tiene sitio; este fichero solo lo carga
 * features/nube/escuchar.js, que se carga aparte. En la interfaz no se dice
 * «el servidor» sino «la nube» (decisión del usuario, 2026-10-25). Un test
 * comprueba que ningún idioma se deja un texto.
 */

export const TEXTOS_ESCUCHAR = {
    es: {
        preparando: 'Preparando desde la nube…',
        primera: 'Preparando la primera canción…',
        soloWifi: 'Con datos móviles no se escucha desde la nube: puedes cambiarlo en Ajustes',
        desdeLaNube: 'Desde la nube',
        guardar: 'Guardar',
        enLaNube: { one: '1 canción suena desde la nube', other: '{n} canciones suenan desde la nube' },
    },
    en: {
        preparando: 'Getting it ready from the cloud…',
        primera: 'Getting the first song ready…',
        soloWifi: "On mobile data, songs don't play from the cloud: you can change this in Settings",
        desdeLaNube: 'From the cloud',
        guardar: 'Save',
        enLaNube: { one: '1 song plays from the cloud', other: '{n} songs play from the cloud' },
    },
    fr: {
        preparando: 'Préparation depuis le cloud…',
        primera: 'Préparation du premier titre…',
        soloWifi: 'Avec les données mobiles, rien ne se lit depuis le cloud : tu peux le changer dans Réglages',
        desdeLaNube: 'Depuis le cloud',
        guardar: 'Enregistrer',
        enLaNube: { one: '1 titre se lit depuis le cloud', other: '{n} titres se lisent depuis le cloud' },
    },
    de: {
        preparando: 'Wird aus der Cloud vorbereitet …',
        primera: 'Der erste Titel wird vorbereitet …',
        soloWifi: 'Mit mobilen Daten wird nichts aus der Cloud abgespielt: Du kannst das in den Einstellungen ändern',
        desdeLaNube: 'Aus der Cloud',
        guardar: 'Speichern',
        enLaNube: { one: '1 Titel wird aus der Cloud abgespielt', other: '{n} Titel werden aus der Cloud abgespielt' },
    },
    pt: {
        preparando: 'A preparar a partir da nuvem…',
        primera: 'A preparar a primeira música…',
        soloWifi: 'Com dados móveis não se ouve a partir da nuvem: podes mudar isto nas Definições',
        desdeLaNube: 'Da nuvem',
        guardar: 'Guardar',
        enLaNube: { one: '1 música toca a partir da nuvem', other: '{n} músicas tocam a partir da nuvem' },
    },
    zh: {
        preparando: '正在从云端准备…',
        primera: '正在准备第一首歌…',
        soloWifi: '使用移动数据时不会从云端播放：可在“设置”中更改',
        desdeLaNube: '来自云端',
        guardar: '保存',
        enLaNube: { one: '1 首歌曲从云端播放', other: '{n} 首歌曲从云端播放' },
    },
};

/** Un texto en el idioma de la interfaz; si falta, en castellano. Con `n`, su plural. */
export function textoEscuchar(clave, idioma, n) {
    const textos = TEXTOS_ESCUCHAR[idioma] ?? TEXTOS_ESCUCHAR.es;
    const t = textos[clave] ?? TEXTOS_ESCUCHAR.es[clave];
    if (typeof t === 'string') return t;
    return (n === 1 ? t.one : t.other).replace('{n}', String(n));
}
