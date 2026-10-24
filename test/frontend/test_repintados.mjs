/**
 * Menos repintados con la misma imagen (plan 28, T5 y T6): lo que el CSS y el
 * fondo tienen que seguir haciendo para que la página no se repinte en cada
 * fotograma. Las cifras de la medición están en el plan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { leer } from './fuentes.mjs';

const css = leer('frontend/src/styles.css');

/** El cuerpo de la primera regla con exactamente ese selector (o null). */
function regla(selector) {
    const i = css.indexOf(`${selector} {`);
    if (i < 0) return null;
    return css.slice(i, css.indexOf('}', i));
}

describe('el grano del cristal no repite las esquinas en lo que se mueve', () => {
    test('los modales y el menú de formato, que ya recortan con sus esquinas: grano sin radio', () => {
        const r = regla(':is(.auth-modal-content, .custom-options):is(.glass-thin, .glass-regular, .glass-thick)::after');
        assert.ok(r, 'la regla existe');
        assert.match(r, /border-radius: 0;/);
    });

    test('esos paneles siguen recortando su contenido (si no, el grano asomaría por las esquinas)', () => {
        assert.match(regla('.auth-modal-content'), /overflow: hidden;/);
        assert.match(regla('.custom-options') ?? css.slice(css.indexOf('.custom-options {')), /overflow: hidden;/);
    });

    test('la hoja de la cola, que no recorta: grano sin radio y recortado con un clip-path de las mismas esquinas', () => {
        const r = regla('.pq-panel.glass-thick::after');
        assert.match(r, /border-radius: 0;/);
        assert.match(r, /clip-path: inset\(0 round 16px 16px 0 0\);/);
        assert.match(css, /@media \(min-width: 768px\) \{\s*\.pq-panel\.glass-thick::after \{\s*clip-path: inset\(0 round var\(--radius-lg\)\);/);
        assert.match(regla('.pq-panel'), /border-top-left-radius: 16px;/, 'si cambian las esquinas del panel, también las del recorte');
    });
});

describe('el brillo de los esqueletos lo mueve el compositor', () => {
    const fotogramas = css.slice(css.indexOf('@keyframes esqueleto-brillo'), css.indexOf('}', css.indexOf('to {', css.indexOf('@keyframes esqueleto-brillo'))) + 1);

    test('con transform, no con background-position', () => {
        assert.match(fotogramas, /from \{ transform: translateX\(-25%\); \}/);
        assert.match(fotogramas, /to \{ transform: translateX\(25%\); \}/);
        assert.doesNotMatch(fotogramas, /background-position/);
    });

    test('el degradado, en un pseudoelemento cuatro veces más ancho que se desliza dentro del esqueleto', () => {
        const pieza = css.slice(css.indexOf('.esq-arte::before,'));
        assert.match(pieza, /left: -200%;\s*width: 400%;/);
        assert.match(pieza, /\) 0 0 \/ 50% 100%;\s*animation: esqueleto-brillo/);
        assert.match(regla('.esq-arte,\n.esq-portada,\n.esq-linea'), /overflow: hidden;/);
    });

    test('con «Reducir movimiento», quieto', () => {
        assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.esq-arte::before,\s*\.esq-portada::before,\s*\.esq-linea::before \{\s*animation: none;/);
    });
});

describe('el fondo con la carátula no se mueve cuando no se ve (T6)', () => {
    const fuente = leer('frontend/src/ui/ambiente.js');

    test('sigue al reproductor completo por su clase y su data-presence, sin tocarlo', () => {
        assert.match(fuente, /attributeFilter: \['class', 'data-presence'\]/);
        assert.match(fuente, /!fp\.classList\.contains\('fp-hidden'\) && !fp\.dataset\.presence/);
        assert.doesNotMatch(fuente, /from '\.\.\/features\/player/);
    });

    test('se para tapado, en segundo plano o ya frenado; la velocidad sigue siendo la de siempre', () => {
        assert.match(fuente, /tapado \|\| document\.hidden \|\| velocidad === 0/);
        assert.match(fuente, /addEventListener\('visibilitychange'/);
        assert.match(fuente, /a\.playbackRate = velocidad;/);
    });
});
