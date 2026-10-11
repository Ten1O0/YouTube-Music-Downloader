/**
 * Utilidades puras de app.js: nombres de fichero, duraciones, detección de
 * entrada y conversiones base64.
 *
 * sanitizeFilename es la más delicada: su salida se convierte en una ruta real
 * del sistema de ficheros del móvil.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { app } from './harness.mjs';

const { api } = app();

// ========================================
// sanitizeFilename
// ========================================

describe('sanitizeFilename', () => {
    test('deja intacto un nombre limpio', () => {
        assert.equal(api.sanitizeFilename('Mi Cancion'), 'Mi Cancion');
    });

    test('sustituye los caracteres prohibidos del sistema de ficheros', () => {
        for (const c of ['<', '>', ':', '"', '/', '\\', '|', '?', '*']) {
            const salida = api.sanitizeFilename(`a${c}b`);
            assert.ok(!salida.includes(c), `no se eliminó ${c}`);
        }
    });

    test('elimina los caracteres de control', () => {
        const salida = api.sanitizeFilename('a\x00b\x1Fc\x7Fd');
        assert.ok(!/[\x00-\x1F\x7F]/.test(salida));
    });

    test('colapsa espacios consecutivos', () => {
        assert.equal(api.sanitizeFilename('a    b'), 'a b');
    });

    test('recorta espacios de los extremos', () => {
        assert.equal(api.sanitizeFilename('   hola   '), 'hola');
    });

    test('limita la longitud a 200 caracteres', () => {
        assert.ok(api.sanitizeFilename('x'.repeat(500)).length <= 200);
    });

    test('devuelve un nombre por defecto si la entrada es vacía', () => {
        assert.equal(api.sanitizeFilename(''), 'audio_unknown');
        assert.equal(api.sanitizeFilename(null), 'audio_unknown');
        assert.equal(api.sanitizeFilename(undefined), 'audio_unknown');
    });

    test('conserva acentos y caracteres no latinos', () => {
        assert.equal(api.sanitizeFilename('Cançó Ñandú'), 'Cançó Ñandú');
        assert.equal(api.sanitizeFilename('日本語の歌'), '日本語の歌');
    });

    test('neutraliza intentos de path traversal', () => {
        const salida = api.sanitizeFilename('../../etc/passwd');
        assert.ok(!salida.includes('/'));
        assert.ok(!salida.includes('\\'));
    });

    test('nunca devuelve una cadena con separadores de ruta', () => {
        const entradas = ['a/b', 'a\\b', '..\\..\\x', 'C:\\Windows'];
        for (const e of entradas) {
            const s = api.sanitizeFilename(e);
            assert.ok(!s.includes('/') && !s.includes('\\'), `falló con ${e}`);
        }
    });
});

// ========================================
// formatDuration
// ========================================

describe('formatDuration', () => {
    test('formatea minutos y segundos', () => {
        assert.equal(api.formatDuration(125), '2:05');
        assert.equal(api.formatDuration(59), '0:59');
        assert.equal(api.formatDuration(60), '1:00');
        assert.equal(api.formatDuration(3599), '59:59');
    });

    test('rellena los segundos con cero', () => {
        assert.equal(api.formatDuration(61), '1:01');
        assert.equal(api.formatDuration(605), '10:05');
    });

    test('duraciones de más de una hora se expresan en minutos', () => {
        assert.equal(api.formatDuration(3600), '60:00');
        assert.equal(api.formatDuration(7325), '122:05');
    });

    test('valores vacíos devuelven cadena vacía', () => {
        assert.equal(api.formatDuration(0), '');
        assert.equal(api.formatDuration(null), '');
        assert.equal(api.formatDuration(undefined), '');
    });
});

// ========================================
// extractVideoId
// ========================================

describe('extractVideoId', () => {
    test('extrae de una URL estándar', () => {
        assert.equal(
            api.extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'),
            'dQw4w9WgXcQ'
        );
    });

    test('extrae de youtu.be', () => {
        assert.equal(api.extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
    });

    test('extrae de una ruta de streaming propia', () => {
        assert.equal(api.extractVideoId('/api/stream/abc12345'), 'abc12345');
        assert.equal(
            api.extractVideoId('https://music.dannarita.es/api/stream/xyz98765'),
            'xyz98765'
        );
    });

    test('extrae del formato local ytmusic_', () => {
        assert.equal(api.extractVideoId('ytmusic_dQw4w9WgXcQ.m4a'), 'dQw4w9WgXcQ');
    });

    test('devuelve null para blob URLs', () => {
        assert.equal(api.extractVideoId('blob:http://localhost/abc-123'), null);
    });

    test('devuelve null para entradas no válidas', () => {
        assert.equal(api.extractVideoId(null), null);
        assert.equal(api.extractVideoId(undefined), null);
        assert.equal(api.extractVideoId(''), null);
        assert.equal(api.extractVideoId(12345), null);
    });

    test('devuelve null cuando no hay nada parecido a un id', () => {
        assert.equal(api.extractVideoId('https://example.com/'), null);
    });
});

// ========================================
// isUrl / isValidInput / isPlaylistUrl
// ========================================

describe('detección de entrada', () => {
    test('reconoce URLs de YouTube', () => {
        const validas = [
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ',
            'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
            'http://youtube.com/watch?v=dQw4w9WgXcQ',
        ];
        for (const u of validas) assert.ok(api.isUrl(u), `no reconoció ${u}`);
    });

    test('no reconoce dominios ajenos como URL de YouTube', () => {
        const invalidas = [
            'https://vimeo.com/123',
            'bad bunny',
            'https://example.com',
            '',
        ];
        for (const u of invalidas) assert.ok(!api.isUrl(u), `aceptó ${u}`);
    });

    test('ignora espacios alrededor', () => {
        assert.ok(api.isUrl('  https://youtu.be/dQw4w9WgXcQ  '));
    });

    test('isValidInput acepta búsquedas de 2 caracteres o más', () => {
        assert.ok(api.isValidInput('ab'));
        assert.ok(api.isValidInput('bad bunny'));
        assert.ok(!api.isValidInput('a'));
        assert.ok(!api.isValidInput(''));
        assert.ok(!api.isValidInput('   '));
    });

    test('isPlaylistUrl detecta el parámetro list', () => {
        assert.ok(api.isPlaylistUrl('https://www.youtube.com/playlist?list=PLabc'));
        assert.ok(api.isPlaylistUrl('https://www.youtube.com/watch?v=x&list=PLabc'));
        assert.ok(api.isPlaylistUrl('https://www.youtube.com/watch?v=x&list=RDabc'));
    });

    test('isPlaylistUrl es falso sin parámetro list', () => {
        assert.ok(!api.isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
        assert.ok(!api.isPlaylistUrl('bad bunny'));
    });
});

// ========================================
// base64
// ========================================

describe('conversiones base64', () => {
    test('arrayBufferToBase64 ida y vuelta', () => {
        const datos = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        assert.equal(api.arrayBufferToBase64(datos.buffer), 'SGVsbG8=');
    });

    test('arrayBufferToBase64 con trozos de más de 32 KB, como los de 2 MB al importar (plan 24)', () => {
        const grande = new Uint8Array(2 * 1024 * 1024 + 123).map((_, i) => (i * 31) % 256);
        assert.equal(api.arrayBufferToBase64(grande.buffer), Buffer.from(grande).toString('base64'));
    });

    test('arrayBufferToBase64 con buffer vacío', () => {
        assert.equal(api.arrayBufferToBase64(new Uint8Array([]).buffer), '');
    });

    test('arrayBufferToBase64 soporta todos los valores de byte', () => {
        const todos = new Uint8Array(256).map((_, i) => i);
        const b64 = api.arrayBufferToBase64(todos.buffer);
        assert.equal(Buffer.from(b64, 'base64').length, 256);
    });

    test('base64ToBlob devuelve null si la entrada es vacía', () => {
        assert.equal(api.base64ToBlob('', 'audio/mp4'), null);
        assert.equal(api.base64ToBlob(null, 'audio/mp4'), null);
    });

    test('base64ToBlob devuelve null si el base64 es inválido', () => {
        assert.equal(api.base64ToBlob('!!!no-es-base64!!!', 'audio/mp4'), null);
    });

    test('base64ToBlob construye un Blob del tamaño correcto', () => {
        const blob = api.base64ToBlob('SGVsbG8=', 'audio/mp4');
        assert.ok(blob);
        assert.equal(blob.size, 5);
        assert.equal(blob.type, 'audio/mp4');
    });
});

// ========================================
// Volver a descargar favoritos e historial
// ========================================

import { esIdYoutube, origenDescarga, urlYoutubeDe } from '../../frontend/src/core/utils.js';

describe('urlYoutubeDe y origenDescarga', () => {
    test('una URL de YouTube se queda tal cual', () => {
        assert.equal(origenDescarga({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        assert.equal(origenDescarga({ url: 'https://youtu.be/dQw4w9WgXcQ' }), 'https://youtu.be/dQw4w9WgXcQ');
    });

    test('un favorito marcado desde la biblioteca: la ruta interna no, el id sí', () => {
        const desdeBiblioteca = { id: 'dQw4w9WgXcQ', videoId: 'dQw4w9WgXcQ', url: 'idb://0b0c7ef297c045cf84d812a61b5a1ab8', src: 'idb://0b0c7ef297c045cf84d812a61b5a1ab8', title: 'Rick' };
        assert.equal(origenDescarga(desdeBiblioteca), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
        assert.equal(urlYoutubeDe({ src: 'https://localhost/_capacitor_file_/x.m4a', videoId: 'dQw4w9WgXcQ' }), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    test('sin identidad de YouTube (importada, ruta del servidor): se busca por el título', () => {
        assert.equal(origenDescarga({ id: 'lib_b8ixpu7a', url: 'https://localhost/_capacitor_file_/data/Paulo_Londra.m4a', title: 'Paulo Londra - Adan y Eva (Official Video)' }),
            'Paulo Londra - Adan y Eva (Official Video)');
        assert.equal(origenDescarga({ id: 'a6c0a9e3', url: '/api/stream/a6c0a9e3', title: 'Una canción' }), 'Una canción');
        assert.equal(urlYoutubeDe({ id: 'a6c0a9e3', url: '/api/stream/a6c0a9e3' }), '', 'un id de descarga de 8 caracteres no es de YouTube');
    });

    test('sin nada con qué buscar: null', () => {
        assert.equal(origenDescarga({ id: 'lib_1', url: '', title: '' }), null);
        assert.equal(origenDescarga({ title: 'Sin título' }), null);
        assert.equal(origenDescarga(null), null);
    });

    test('esIdYoutube: 11 caracteres de [A-Za-z0-9_-]', () => {
        assert.ok(esIdYoutube('dQw4w9WgXcQ'));
        for (const id of ['lib_b8ixpu7a', 'a6c0a9e3', '', null, 'dQw4w9WgXc!', 12345678901]) assert.equal(esIdYoutube(id), false, String(id));
    });
});
