/**
 * La política de privacidad (plan 21, T6), en castellano e inglés.
 *
 * Cada apartado es una lista de párrafos; un párrafo es texto o, si lleva
 * enlaces, una lista de trozos `{ texto, href }`. Se pinta con textContent:
 * nada de aquí se interpreta como HTML.
 *
 * Lo que dice tiene que ser verdad en el código: los plazos salen de las
 * mismas constantes que usa el servidor (test_privacidad.mjs lo comprueba).
 */

export const RESPONSABLE = 'Dan Narita';
export const CORREO = 'remusdannarita@gmail.com';
export const ACTUALIZADA = '2026-10-08';

/** Plazos de conservación, en días. */
export const PLAZOS = { eventos: 90, registros: 30, lapidas: 90, papelera: 30 };

export const IDIOMAS = ['es', 'en'];
export const NOMBRES_IDIOMA = { es: 'Español', en: 'English' };

const correo = { texto: CORREO, href: `mailto:${CORREO}` };

export const TEXTOS = {
    es: {
        titulo_pagina: 'Privacidad — Music Downloader',
        titulo: 'Política de privacidad',
        actualizada: 'Actualizada el 8 de octubre de 2026',
        volver: 'Volver a la app',
        idioma: 'Idioma',
        resumen: 'En corto: la app funciona sin cuenta y entonces tus cosas se quedan en tu dispositivo. Si inicias sesión con Google, guardamos lo justo para sincronizar tus dispositivos. Sin publicidad, sin analítica y sin vender ni ceder nada a nadie. Puedes borrarlo todo desde la app cuando quieras.',
        apartados: [
            ['Quién es el responsable', [
                [`Music Downloader es un proyecto personal de ${RESPONSABLE}, que es el responsable de los datos. Para cualquier duda o petición sobre tus datos: `, correo, '.'],
            ]],
            ['Si usas la app sin cuenta', [
                'Tu biblioteca, tus listas, tus favoritos, tu historial y tus ajustes se guardan solo en tu dispositivo (en el almacenamiento del navegador o de la app) y no salen de él.',
                'Para buscar y descargar canciones, el servidor recibe lo que pides (el enlace o el texto de la búsqueda) y baja el audio de YouTube. Guarda un registro de cada descarga (el título y el id del vídeo, la fecha y si terminó bien) para ver el uso y los fallos, sin relacionarlo contigo.',
                'Como cualquier web, el servidor anota en sus registros técnicos la dirección IP de cada petición, para su funcionamiento y su seguridad.',
            ]],
            ['Si inicias sesión con Google', [
                'De tu cuenta de Google recibimos y guardamos solo tu correo, tu nombre y tu foto de perfil. Nunca vemos tu contraseña.',
                'Para que tus dispositivos estén sincronizados guardamos también tu biblioteca (títulos, artistas e ids de YouTube, no el audio), tus listas, tus favoritos, tu historial de descargas, tus ajustes y las listas de YouTube que sigues.',
                'Y tus escuchas (qué canción y cuándo), para «Tu año en música». El registro de descargas de quien tiene sesión queda asociado a su cuenta.',
            ]],
            ['Para qué se usan', [
                'Solo para que la app funcione: descargar, sincronizar tus dispositivos y preparar tu resumen del año. No hay publicidad ni herramientas de analítica, no se hacen perfiles y no se venden ni se ceden datos a nadie.',
                'La base legal es el servicio que pides al usar la app y, con la cuenta, tu consentimiento al iniciar sesión.',
            ]],
            ['Dónde se guardan', [
                'En un servidor propio situado en la Unión Europea.',
            ]],
            ['Cuánto tiempo', [
                'Los datos de tu cuenta, hasta que la borres.',
                `El registro de descargas, ${PLAZOS.eventos} días; después se borra solo.`,
                `Los registros técnicos del servidor (con la IP), ${PLAZOS.registros} días.`,
                `Lo que quitas de tu biblioteca o de tus listas se puede recuperar durante ${PLAZOS.papelera} días desde «Tus datos», y a los ${PLAZOS.lapidas} días desaparece del todo del servidor.`,
            ]],
            ['Servicios de otros', [
                'Google, para iniciar sesión, si decides hacerlo.',
                'YouTube: las canciones salen de YouTube a través de nuestro servidor. Las miniaturas se cargan desde los servidores de YouTube, y la vista previa de una canción usa su reproductor, así que YouTube recibe tu IP y puede usar sus propias cookies. Se aplica su política de privacidad.',
                'LRCLIB, para las letras: al abrirlas, tu dispositivo le pregunta por el artista y el título de la canción.',
                'Si pulsas el enlace para invitarme a un café, sales a Buy Me a Coffee, con su propia política.',
            ]],
            ['Tus derechos', [
                'Puedes ver y exportar tus datos desde «Tus datos» (la copia de seguridad) y corregirlos desde la propia app.',
                'Puedes borrar tu cuenta y todo lo que el servidor guarda de ella desde Ajustes → «Borrar mi cuenta», en el acto. Lo que hay en tu dispositivo lo borras tú, desinstalando la app o borrando los datos del navegador.',
                ['Para cualquier otra petición (acceso, rectificación, oposición, limitación o portabilidad), escribe a ', correo, '. Y si crees que no se han respetado tus derechos, puedes reclamar ante la autoridad de protección de datos de tu país (en España, la ', { texto: 'AEPD', href: 'https://www.aepd.es' }, ').'],
            ]],
            ['Cambios', [
                'Si esta política cambia, la fecha de arriba lo dirá. Si el cambio es importante, también lo avisará la app.',
            ]],
        ],
    },
    en: {
        titulo_pagina: 'Privacy — Music Downloader',
        titulo: 'Privacy policy',
        actualizada: 'Updated on 8 October 2026',
        volver: 'Back to the app',
        idioma: 'Language',
        resumen: 'In short: the app works without an account, and then your things stay on your device. If you sign in with Google, we keep just what is needed to sync your devices. No ads, no analytics, and nothing is sold or handed over to anyone. You can delete it all from the app whenever you want.',
        apartados: [
            ['Who is responsible', [
                [`Music Downloader is a personal project by ${RESPONSABLE}, who is the data controller. For any question or request about your data: `, correo, '.'],
            ]],
            ['If you use the app without an account', [
                'Your library, playlists, favourites, history and settings are stored only on your device (in the browser or app storage) and never leave it.',
                'To search for and download songs, the server receives what you ask for (the link or the search text) and gets the audio from YouTube. It keeps a log of each download (the video title and id, the date and whether it finished) to see usage and errors, without linking it to you.',
                'Like any website, the server writes the IP address of each request to its technical logs, to keep it running and secure.',
            ]],
            ['If you sign in with Google', [
                'From your Google account we receive and keep only your email address, your name and your profile picture. We never see your password.',
                'To keep your devices in sync we also store your library (titles, artists and YouTube ids, not the audio), your playlists, favourites, download history, settings and the YouTube playlists you follow.',
                'And your listens (which song and when), for «Your year in music». The download log of a signed-in user is linked to their account.',
            ]],
            ['What it is used for', [
                'Only to make the app work: downloading, syncing your devices and preparing your year in review. There are no ads or analytics tools, no profiling, and no data is sold or handed over to anyone.',
                'The legal basis is the service you ask for by using the app and, for the account, your consent when you sign in.',
            ]],
            ['Where it is stored', [
                'On our own server located in the European Union.',
            ]],
            ['For how long', [
                'Your account data, until you delete it.',
                `The download log, ${PLAZOS.eventos} days; after that it is deleted automatically.`,
                `The server technical logs (with the IP address), ${PLAZOS.registros} days.`,
                `What you remove from your library or playlists can be recovered for ${PLAZOS.papelera} days from «Your data», and after ${PLAZOS.lapidas} days it is gone from the server for good.`,
            ]],
            ['Other services', [
                'Google, to sign in, if you choose to.',
                'YouTube: songs come from YouTube through our server. Thumbnails load from YouTube servers, and a song preview uses its player, so YouTube receives your IP address and may use its own cookies. Its privacy policy applies.',
                'LRCLIB, for lyrics: when you open them, your device asks it for the song artist and title.',
                'If you tap the link to buy me a coffee, you go to Buy Me a Coffee, which has its own policy.',
            ]],
            ['Your rights', [
                'You can see and export your data from «Your data» (the backup) and correct it from the app itself.',
                'You can delete your account and everything the server keeps about it from Settings → «Delete my account», straight away. What is on your device you delete yourself, by uninstalling the app or clearing the browser data.',
                ['For any other request (access, rectification, objection, restriction or portability), write to ', correo, '. And if you think your rights have not been respected, you can complain to the data protection authority of your country (in Spain, the ', { texto: 'AEPD', href: 'https://www.aepd.es' }, ').'],
            ]],
            ['Changes', [
                'If this policy changes, the date above will say so. If the change is important, the app will tell you too.',
            ]],
        ],
    },
};

/** Castellano si el navegador lo prefiere (o lo pide ?lang=es); si no, inglés. */
export function elegirIdioma({ parametro, guardado, navegador = [] } = {}) {
    for (const candidato of [parametro, guardado]) if (IDIOMAS.includes(candidato)) return candidato;
    for (const etiqueta of navegador) {
        const base = String(etiqueta ?? '').toLowerCase().split('-')[0];
        if (IDIOMAS.includes(base)) return base;
    }
    return 'en';
}
