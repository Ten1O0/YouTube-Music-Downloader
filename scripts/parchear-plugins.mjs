#!/usr/bin/env node
/**
 * Arreglos a plugins de Capacitor que viven en mobile/node_modules. Se aplican
 * antes de cada compilación de la APK (scripts/sync-apk.sh); aplicarlos dos
 * veces no cambia nada.
 *
 *     node scripts/parchear-plugins.mjs
 *
 * @jofr/capacitor-media-session 3.0.3: el botón de reproducir y pausar de la
 * notificación no hacía nada. El plugin le daba
 * `buildMediaButtonPendingIntent(ACTION_PLAY_PAUSE | ACTION_PLAY)`, y AndroidX
 * solo traduce a una tecla multimedia una acción suelta: con dos devuelve null,
 * y el botón se queda sin acción (en el Vivo, `"Play" -> null` en
 * `dumpsys notification`). Anterior, siguiente y ±30 s pasan una sola y van
 * bien. Con ACTION_PLAY y ACTION_PAUSE, cada botón manda su tecla.
 *
 * Si el plugin cambia y el texto no aparece, se para: mejor un error al
 * compilar que una APK con el botón roto otra vez.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const PARCHES = [
    {
        nombre: 'media-session: reproducir y pausar en la notificación',
        fichero: 'mobile/node_modules/@jofr/capacitor-media-session/android/src/main/java/io/github/jofr/capacitor/mediasessionplugin/MediaSessionService.java',
        cambios: [
            [
                '"Play", MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PLAY))',
                '"Play", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PLAY)',
            ],
            [
                '"Pause", MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_PAUSE))',
                '"Pause", MediaButtonReceiver.buildMediaButtonPendingIntent(this, PlaybackStateCompat.ACTION_PAUSE)',
            ],
        ],
    },
];

/** Aplica los cambios a un texto: el texto nuevo, o un error si no encaja. */
export function parchear(texto, cambios) {
    let resultado = texto;
    for (const [antes, despues] of cambios) {
        if (resultado.includes(despues)) continue;
        if (!resultado.includes(antes)) throw new Error(`no aparece: ${antes}`);
        resultado = resultado.replace(antes, despues);
    }
    return resultado;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    for (const { nombre, fichero, cambios } of PARCHES) {
        const ruta = path.join(RAIZ, fichero);
        const texto = fs.readFileSync(ruta, 'utf8');
        let nuevo;
        try {
            nuevo = parchear(texto, cambios);
        } catch (e) {
            console.error(`  ERROR (${nombre}): ${e.message}`);
            console.error('         el plugin ha cambiado: revisa scripts/parchear-plugins.mjs');
            process.exit(1);
        }
        if (nuevo === texto) {
            console.log(`  ya aplicado: ${nombre}`);
        } else {
            fs.writeFileSync(ruta, nuevo);
            console.log(`  aplicado: ${nombre}`);
        }
    }
}
