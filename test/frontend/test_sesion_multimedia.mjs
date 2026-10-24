/**
 * Lo que suena, tal y como lo ve el sistema: pantalla de bloqueo,
 * notificación, centro de control y las islas (Now Bar de Samsung,
 * HyperIsland de Xiaomi, la isla dinámica del iPhone desde Safari).
 *
 * Todas leen la misma sesión multimedia. Si miente —progreso que vuelve al
 * principio al pausar, «sonando» con la música parada, una carátula 16:9
 * pixelada— la isla se ve mal aunque aparezca.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bandasNegras, recorteCuadrado, candidatas, LADO_SISTEMA } from '../../frontend/src/ui/artwork.js';
import { codigoCliente, leer, RAIZ } from './fuentes.mjs';
import { PARCHES, parchear } from '../../scripts/parchear-plugins.mjs';

const APP = codigoCliente();

/** Imagen RGBA sintética: bandas negras de `banda` filas arriba y abajo. */
function conBandas(ancho, alto, banda, gris = 120) {
    const px = new Uint8ClampedArray(ancho * alto * 4);
    for (let y = 0; y < alto; y++) {
        const v = y < banda || y >= alto - banda ? 0 : gris;
        for (let x = 0; x < ancho; x++) px.set([v, v, v, 255], (y * ancho + x) * 4);
    }
    return px;
}

describe('carátula cuadrada', () => {
    test('quita las bandas negras de las miniaturas 4:3 de YouTube', () => {
        assert.deepEqual(bandasNegras(conBandas(480, 360, 45), 480, 360), { arriba: 45, abajo: 45 });
    });

    test('una portada oscura no es una banda: como mucho el 20 % por lado', () => {
        const negra = conBandas(100, 100, 50, 0);
        assert.deepEqual(bandasNegras(negra, 100, 100), { arriba: 20, abajo: 20 });
    });

    test('recorta el cuadrado central de la zona con contenido', () => {
        assert.deepEqual(recorteCuadrado(480, 360, { arriba: 45, abajo: 45 }), { x: 105, y: 45, lado: 270 });
        assert.deepEqual(recorteCuadrado(1280, 720), { x: 280, y: 0, lado: 720 });
        assert.deepEqual(recorteCuadrado(300, 500), { x: 0, y: 100, lado: 300 });
    });

    test('de un vídeo de YouTube prueba la de máxima resolución, y sin conexión la original', () => {
        const mq = 'https://i.ytimg.com/vi/kJQP7kiw5Fk/mqdefault.jpg';
        assert.deepEqual(candidatas(mq), [
            'https://i.ytimg.com/vi/kJQP7kiw5Fk/maxresdefault.jpg',
            'https://i.ytimg.com/vi/kJQP7kiw5Fk/hqdefault.jpg',
            mq,
        ]);
        assert.deepEqual(candidatas('data:image/jpeg;base64,xx'), ['data:image/jpeg;base64,xx']);
    });

    test('a la APK le llega pequeña: Binder no admite más de 1 MB por transacción', () => {
        assert.ok(LADO_SISTEMA * LADO_SISTEMA * 4 < 1024 * 1024 / 2, 'el mapa de bits no deja margen');
        assert.match(APP, /\{ artworkNativa: \{ src: cuadrada\.sistema/);
        assert.match(APP, /if \(artworkNativa\) \{\s*nativeMetadata\.artwork = \[artworkNativa\];/);
    });
});

describe('estado y progreso', () => {
    test('los anuncian los eventos del audio, también cuando pausa el sistema', () => {
        assert.match(APP, /addOptionalEventListener\(audio, 'play', \(\) => \{\s*anunciarEstado\('playing'\);/);
        assert.match(APP, /addOptionalEventListener\(audio, 'pause', \(\) => \{\s*anunciarEstado\('paused'\);/);
    });

    test('primero la posición: si no, el progreso volvía al principio al pausar', () => {
        assert.match(APP, /function anunciarEstado\(estado\) \{\s*updatePositionState\(\);\s*NativeMediaSession\.setPlaybackState\(estado\);/);
        assert.match(APP, /addOptionalEventListener\(audio, 'seeked', \(\) => updatePositionState\(\)\);/);
    });

    test('pausar y reanudar desde la app no se adelantan al audio', () => {
        for (const nombre of ['pause', 'resume']) {
            const i = APP.indexOf(`    function ${nombre}() {`);
            assert.ok(!APP.slice(i, APP.indexOf('\n    }\n', i)).includes('setPlaybackState'), `${nombre}() anuncia un estado que el audio aún no tiene`);
        }
    });
});

describe('reproducir y pausar desde la notificación', () => {
    // Con dos acciones juntas, AndroidX no da tecla multimedia y el botón se
    // quedaba sin acción ("Play" -> null en el Vivo): el resto iba bien
    const [parche] = PARCHES;
    const original = (accion) => `"${accion === 'PLAY' ? 'Play' : 'Pause'}", MediaButtonReceiver.buildMediaButtonPendingIntent(this, (PlaybackStateCompat.ACTION_PLAY_PAUSE | PlaybackStateCompat.ACTION_${accion}))`;

    test('cada botón pasa a mandar una sola acción, y aplicarlo dos veces no cambia nada', () => {
        const texto = `a\n${original('PLAY')}\nb\n${original('PAUSE')}\n`;
        const una = parchear(texto, parche.cambios);
        assert.match(una, /"Play", MediaButtonReceiver\.buildMediaButtonPendingIntent\(this, PlaybackStateCompat\.ACTION_PLAY\)/);
        assert.match(una, /"Pause", MediaButtonReceiver\.buildMediaButtonPendingIntent\(this, PlaybackStateCompat\.ACTION_PAUSE\)/);
        assert.doesNotMatch(una, /ACTION_PLAY_PAUSE \|/);
        assert.equal(parchear(una, parche.cambios), una);
    });

    test('si el plugin cambia, se para en vez de compilar con el botón roto', () => {
        assert.throws(() => parchear('otro código', parche.cambios), /no aparece/);
    });

    test('las dos compilaciones de la APK lo aplican antes de sincronizar Capacitor', () => {
        const sh = leer('scripts/sync-apk.sh');
        assert.ok(sh.indexOf('node scripts/parchear-plugins.mjs') > 0 && sh.indexOf('node scripts/parchear-plugins.mjs') < sh.indexOf('npx cap sync android'));
        const bat = leer('scripts/sync-apk.bat');
        assert.ok(bat.indexOf('parchear-plugins.mjs') > 0 && bat.indexOf('parchear-plugins.mjs') < bat.indexOf('npx cap sync android'));
    });

    test('el plugin instalado encaja con el parche', { skip: !fs.existsSync(path.join(RAIZ, 'mobile/node_modules/@jofr')) }, () => {
        assert.doesNotThrow(() => parchear(leer(parche.fichero), parche.cambios));
    });
});

describe('icono de la notificación', () => {
    const ICONO = 'mobile/android/app/src/main/res/drawable/ic_baseline_volume_up_24.xml';

    test('la app define el suyo con el nombre que usa el plugin', () => {
        const xml = leer(ICONO);
        assert.match(xml, /<vector /);
        assert.ok((xml.match(/android:fillColor="#FFFFFFFF"/g) || []).length >= 3, 'los iconos pequeños van en blanco');
    });

    test('el plugin sigue usando ese recurso', { skip: !fs.existsSync(path.join(RAIZ, 'mobile/node_modules/@jofr')) }, () => {
        const servicio = leer('mobile/node_modules/@jofr/capacitor-media-session/android/src/main/java/io/github/jofr/capacitor/mediasessionplugin/MediaSessionService.java');
        assert.match(servicio, /setSmallIcon\(R\.drawable\.ic_baseline_volume_up_24\)/, 'el plugin cambió el nombre del icono: hay que renombrar el nuestro');
    });
});
