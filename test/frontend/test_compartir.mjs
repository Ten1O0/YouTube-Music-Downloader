/**
 * La tarjeta al compartir el enlace (plan 21): LinkedIn, WhatsApp o X la arman
 * con las etiquetas Open Graph. Sin ellas, el enlace sale sin imagen.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { leer } from './fuentes.mjs';

const meta = (html, clave) => html.match(new RegExp(`<meta (?:property|name)="${clave}" content="([^"]*)"`))?.[1];

/** Ancho y alto de un JPEG, del primer marcador SOF. */
function medidasJpeg(ruta) {
    const b = fs.readFileSync(ruta);
    for (let i = 2; i < b.length;) {
        const marcador = b[i + 1];
        const largo = b.readUInt16BE(i + 2);
        if (marcador >= 0xc0 && marcador <= 0xc3) return { alto: b.readUInt16BE(i + 5), ancho: b.readUInt16BE(i + 7) };
        i += 2 + largo;
    }
    return null;
}

for (const [pagina, url] of [['frontend/index.html', 'https://music.dannarita.es/'], ['frontend/download.html', 'https://music.dannarita.es/download']]) {
    describe(pagina, () => {
        const html = leer(pagina);

        test('tiene título, descripción, enlace e imagen para la tarjeta', () => {
            for (const clave of ['og:title', 'og:description', 'og:image', 'og:image:alt']) {
                assert.ok(meta(html, clave)?.trim(), `falta ${clave}`);
            }
            assert.equal(meta(html, 'og:url'), url);
            assert.equal(meta(html, 'twitter:card'), 'summary_large_image');
        });

        test('la imagen va con dirección completa: las redes no resuelven rutas relativas', () => {
            assert.match(meta(html, 'og:image'), /^https:\/\/music\.dannarita\.es\/og\.jpg$/);
        });
    });
}

test('la imagen existe, mide lo que dicen las etiquetas y pesa poco', () => {
    const ruta = 'frontend/public/og.jpg';
    assert.deepEqual(medidasJpeg(ruta), { ancho: 1200, alto: 630 });
    assert.equal(meta(leer('frontend/index.html'), 'og:image:width'), '1200');
    assert.equal(meta(leer('frontend/index.html'), 'og:image:height'), '630');
    assert.ok(fs.statSync(ruta).size < 300_000, 'og.jpg pasa de 300 KB');
});
