#!/usr/bin/env node
/**
 * Escribe en styles.css las curvas CSS de los muelles (plan 09, T2).
 *
 *     npm run springs
 *
 * Las curvas salen de la misma física que el motor de JavaScript
 * (src/ui/motion/spring.js), así que una transición CSS y un gesto se sienten
 * igual. Solo reescribe el bloque entre los marcadores `springs:begin` y
 * `springs:end`: no se edita a mano, y un test comprueba que coincide.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPRINGS, springToLinear } from '../src/ui/motion/spring.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS = path.join(RAIZ, 'styles.css');
const INICIO = '/* springs:begin';
const FIN = '/* springs:end */';

/** El bloque de tokens tal como debe quedar en styles.css. */
export function springsBlock() {
    const lineas = [
        '/* springs:begin — generado por scripts/generate-springs.mjs; no editar a mano */',
    ];
    for (const [nombre, preset] of Object.entries(SPRINGS)) {
        const { easing, durationMs } = springToLinear(preset);
        lineas.push(`    --spring-${nombre}: ${easing};`);
        lineas.push(`    --spring-${nombre}-duration: ${durationMs}ms;`);
    }
    lineas.push(`    ${FIN}`);
    return lineas.join('\n');
}

function escribir() {
    const css = fs.readFileSync(CSS, 'utf8');
    const i = css.indexOf(INICIO);
    const j = css.indexOf(FIN);
    if (i < 0 || j < 0) throw new Error('styles.css no tiene los marcadores springs:begin / springs:end');
    const nuevo = css.slice(0, i) + springsBlock() + css.slice(j + FIN.length);
    fs.writeFileSync(CSS, nuevo);
    console.log('Curvas de los muelles actualizadas en styles.css');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    escribir();
}
