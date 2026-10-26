/**
 * Textos de «que lo tuyo sea tuyo» (plan 29, T4-T7): importar sin descargar,
 * la ventana «Tu música, de verdad tuya», los recordatorios para guardar y el
 * recuento de Ajustes.
 *
 * Viven aquí y no en las traducciones porque el castellano de estas va en el
 * código de arranque, que no tiene sitio; este fichero solo lo cargan módulos
 * que se cargan aparte. En la interfaz nunca se dice «el servidor»: se dice
 * «la nube». Un test comprueba que ningún idioma se deja un texto.
 */

import { i18n } from '../../i18n/language-manager.js';

export const TEXTOS_TUYO = {
    es: {
        soloLista: 'Crear solo la lista, sin descargar',
        soloListaHecha: 'Lista «{nombre}» creada. Escúchala desde la nube o descárgala cuando quieras.',
        tuyaTitulo: 'Tu música, de verdad tuya',
        tuyaTexto: 'Lo que descargas se queda en tu móvil: suena sin conexión y no depende de nadie. La radio y las canciones en la nube suenan desde la nube: son para descubrir música, y si un día la nube deja de estar, no se podrán escuchar. Si algo te gusta, guárdalo.',
        entendido: 'Entendido',
        porQue: 'Por qué descargar',
        tresVeces: 'La has escuchado 3 veces. ¿La guardas? Así será tuya y sonará sin conexión',
        favorito: '¿La guardas? Así será tuya y sonará sin conexión',
        guardar: 'Guardar',
        guardada: 'Guardada: ya es tuya y suena sin conexión',
        noSePuede: 'Esta canción no está descargada y ahora no se puede escuchar desde la nube. Las que tienes descargadas siguen sonando',
        tuMusica: 'Tu música',
        tuyas: '{n} canciones tuyas',
        tuyasUna: '1 canción tuya',
        desdeNube: '{n} desde la nube',
        tuyasAyuda: 'Las tuyas suenan sin conexión, en el metro o en el avión, sin gastar datos y al instante.',
    },
    en: {
        soloLista: 'Just create the playlist, don’t download',
        soloListaHecha: 'Playlist “{nombre}” created. Listen from the cloud or download it whenever you like.',
        tuyaTitulo: 'Your music, truly yours',
        tuyaTexto: 'What you download stays on your phone: it plays offline and depends on no one. The radio and songs in the cloud play from the cloud: they’re for discovering music, and if one day the cloud is gone, they won’t play. If you like something, save it.',
        entendido: 'Got it',
        porQue: 'Why download',
        tresVeces: 'You’ve listened to it 3 times. Save it? It’ll be yours and play offline',
        favorito: 'Save it? It’ll be yours and play offline',
        guardar: 'Save',
        guardada: 'Saved: it’s yours now and plays offline',
        noSePuede: 'This song isn’t downloaded and can’t play from the cloud right now. Your downloaded songs keep playing',
        tuMusica: 'Your music',
        tuyas: '{n} songs of yours',
        tuyasUna: '1 song of yours',
        desdeNube: '{n} from the cloud',
        tuyasAyuda: 'Yours play offline, on the subway or on a plane, without using data, instantly.',
    },
    fr: {
        soloLista: 'Créer seulement la playlist, sans télécharger',
        soloListaHecha: 'Playlist « {nombre} » créée. Écoute-la depuis le cloud ou télécharge-la quand tu veux.',
        tuyaTitulo: 'Ta musique, vraiment à toi',
        tuyaTexto: 'Ce que tu télécharges reste sur ton téléphone : ça marche hors connexion et ne dépend de personne. La radio et les titres dans le cloud sont lus depuis le cloud : ils servent à découvrir de la musique, et si un jour le cloud disparaît, tu ne pourras plus les écouter. Si quelque chose te plaît, garde-le.',
        entendido: 'Compris',
        porQue: 'Pourquoi télécharger',
        tresVeces: 'Tu l’as écoutée 3 fois. Tu la gardes ? Elle sera à toi et marchera hors connexion',
        favorito: 'Tu la gardes ? Elle sera à toi et marchera hors connexion',
        guardar: 'Garder',
        guardada: 'Gardé : il est à toi et marche hors connexion',
        noSePuede: 'Ce titre n’est pas téléchargé et ne peut pas être lu depuis le cloud pour l’instant. Tes titres téléchargés continuent de jouer',
        tuMusica: 'Ta musique',
        tuyas: '{n} titres à toi',
        tuyasUna: '1 titre à toi',
        desdeNube: '{n} depuis le cloud',
        tuyasAyuda: 'Les tiens marchent hors connexion, dans le métro ou en avion, sans consommer de données, tout de suite.',
    },
    de: {
        soloLista: 'Nur die Playlist erstellen, nicht herunterladen',
        soloListaHecha: 'Playlist „{nombre}“ erstellt. Hör sie aus der Cloud oder lade sie herunter, wann du willst.',
        tuyaTitulo: 'Deine Musik, wirklich deine',
        tuyaTexto: 'Was du herunterlädst, bleibt auf deinem Handy: Es läuft offline und hängt von niemandem ab. Das Radio und die Titel in der Cloud laufen aus der Cloud: Sie sind zum Entdecken da, und wenn es die Cloud eines Tages nicht mehr gibt, kannst du sie nicht mehr hören. Wenn dir etwas gefällt, speichere es.',
        entendido: 'Verstanden',
        porQue: 'Warum herunterladen',
        tresVeces: 'Du hast ihn 3-mal gehört. Speichern? Dann gehört er dir und läuft offline',
        favorito: 'Speichern? Dann gehört er dir und läuft offline',
        guardar: 'Speichern',
        guardada: 'Gespeichert: Jetzt gehört er dir und läuft offline',
        noSePuede: 'Dieser Titel ist nicht heruntergeladen und kann gerade nicht aus der Cloud abgespielt werden. Deine heruntergeladenen Titel laufen weiter',
        tuMusica: 'Deine Musik',
        tuyas: '{n} eigene Titel',
        tuyasUna: '1 eigener Titel',
        desdeNube: '{n} aus der Cloud',
        tuyasAyuda: 'Deine laufen offline, in der U-Bahn oder im Flugzeug, ohne Datenverbrauch und sofort.',
    },
    pt: {
        soloLista: 'Criar só a playlist, sem descarregar',
        soloListaHecha: 'Playlist «{nombre}» criada. Ouve-a a partir da nuvem ou descarrega-a quando quiseres.',
        tuyaTitulo: 'A tua música, mesmo tua',
        tuyaTexto: 'O que descarregas fica no teu telemóvel: toca sem ligação e não depende de ninguém. A rádio e as músicas na nuvem tocam a partir da nuvem: são para descobrir música, e se um dia a nuvem deixar de existir, não as vais poder ouvir. Se gostares de alguma coisa, guarda-a.',
        entendido: 'Percebi',
        porQue: 'Porquê descarregar',
        tresVeces: 'Já a ouviste 3 vezes. Guardas? Assim fica tua e toca sem ligação',
        favorito: 'Guardas? Assim fica tua e toca sem ligação',
        guardar: 'Guardar',
        guardada: 'Guardada: já é tua e toca sem ligação',
        noSePuede: 'Esta música não está descarregada e agora não pode tocar a partir da nuvem. As que tens descarregadas continuam a tocar',
        tuMusica: 'A tua música',
        tuyas: '{n} músicas tuas',
        tuyasUna: '1 música tua',
        desdeNube: '{n} a partir da nuvem',
        tuyasAyuda: 'As tuas tocam sem ligação, no metro ou no avião, sem gastar dados e de imediato.',
    },
    zh: {
        soloLista: '只创建歌单，不下载',
        soloListaHecha: '歌单“{nombre}”已创建。可以从云端收听，也可以随时下载。',
        tuyaTitulo: '你的音乐，真正属于你',
        tuyaTexto: '你下载的歌曲会留在手机里：离线也能播放，不依赖任何人。电台和云端歌曲是从云端播放的：它们用来发现音乐，如果有一天云端不在了，就无法收听。喜欢的歌，就保存下来吧。',
        entendido: '知道了',
        porQue: '为什么要下载',
        tresVeces: '你已经听了 3 遍。要保存吗？这样它就属于你，离线也能播放',
        favorito: '要保存吗？这样它就属于你，离线也能播放',
        guardar: '保存',
        guardada: '已保存：它现在属于你，离线也能播放',
        noSePuede: '这首歌没有下载，现在无法从云端播放。已下载的歌曲照常播放',
        tuMusica: '你的音乐',
        tuyas: '{n} 首属于你',
        tuyasUna: '1 首属于你',
        desdeNube: '{n} 首来自云端',
        tuyasAyuda: '属于你的歌曲离线也能播放，在地铁或飞机上都行，不耗流量，即点即播。',
    },
};

/** Un texto en el idioma de la interfaz (si no está, en castellano), con sus huecos rellenos. */
export function textoTuyo(clave, valores = {}, idioma = i18n.currentLang) {
    const texto = (TEXTOS_TUYO[idioma] ?? TEXTOS_TUYO.es)[clave] ?? TEXTOS_TUYO.es[clave] ?? clave;
    return texto.replace(/\{(\w+)\}/g, (_, k) => String(valores[k] ?? ''));
}
