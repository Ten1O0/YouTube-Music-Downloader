/**
 * Textos de la segunda ventana del aviso de versión nueva (apk.js): al decir
 * que no, se recuerda que actualizar no borra canciones, listas ni ajustes.
 *
 * Viven aquí y no en las traducciones porque el castellano de estas va en el
 * código de arranque, que no tiene sitio; este fichero solo lo carga apk.js,
 * que se carga aparte. Un test comprueba que ningún idioma se deja un texto.
 */
export const TEXTOS_TRANQUILO = {
    es: {
        titulo: 'No perderás nada al actualizar',
        mensaje: 'Tus canciones, tus listas y toda tu configuración se quedan tal cual. Solo ganas: la app irá más fluida y tendrás las novedades de esta versión.',
        si: 'Sí, actualizar',
        no: 'No quiero actualizar',
    },
    en: {
        titulo: "You won't lose anything by updating",
        mensaje: 'Your songs, playlists and all your settings stay exactly as they are. You only gain: the app runs smoother and you get everything new in this version.',
        si: 'Yes, update',
        no: "I don't want to update",
    },
    fr: {
        titulo: 'Tu ne perdras rien en mettant à jour',
        mensaje: 'Tes titres, tes playlists et tous tes réglages restent tels quels. Tu n’as qu’à y gagner : l’app sera plus fluide et tu auras les nouveautés de cette version.',
        si: 'Oui, mettre à jour',
        no: 'Je ne veux pas mettre à jour',
    },
    de: {
        titulo: 'Beim Update geht nichts verloren',
        mensaje: 'Deine Titel, Playlists und alle Einstellungen bleiben genau so, wie sie sind. Du gewinnst nur: Die App läuft flüssiger und du bekommst alle Neuerungen dieser Version.',
        si: 'Ja, aktualisieren',
        no: 'Ich möchte nicht aktualisieren',
    },
    pt: {
        titulo: 'Não vais perder nada ao atualizar',
        mensaje: 'As tuas músicas, playlists e todas as definições ficam exatamente como estão. Só ganhas: a app fica mais fluida e tens as novidades desta versão.',
        si: 'Sim, atualizar',
        no: 'Não quero atualizar',
    },
    zh: {
        titulo: '更新不会丢失任何内容',
        mensaje: '你的歌曲、歌单和所有设置都会原样保留。更新只有好处：应用运行更流畅，还能获得此版本的全部新功能。',
        si: '好的，更新',
        no: '我不想更新',
    },
};

/** Los textos de esa ventana en el idioma de la interfaz; si no está, en castellano. */
export const textosTranquilo = (idioma) => TEXTOS_TRANQUILO[idioma] ?? TEXTOS_TRANQUILO.es;
