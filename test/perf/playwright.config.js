/**
 * El presupuesto de rendimiento (plan 19, T16): `npm run test:perf`.
 *
 * Aparte de los recorridos E2E: compila en su propia carpeta y la sirve en su
 * propio puerto, así que no pisa dist/ ni el servidor de los recorridos. Mide
 * tiempos: se pasa con la máquina en reposo, no a la vez que la E2E.
 */

import { defineConfig } from '@playwright/test';
import path from 'node:path';

const PUERTO = 5097;
// Se lanza desde la raíz (npm run test:perf). Ignorada por git y fuera de
// test-results/, que la E2E vacía al empezar
const RAIZ = path.resolve('.');
const SALIDA = path.join(RAIZ, 'node_modules/.cache/presupuesto');

export default defineConfig({
    testDir: '.',
    testMatch: 'presupuesto.spec.js',
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 180_000,
    reporter: 'list',
    // Fuera de test-results/: Playwright la vacía al empezar y es la de la E2E
    outputDir: path.join(RAIZ, 'node_modules/.cache/presupuesto-resultados'),
    use: { baseURL: `http://127.0.0.1:${PUERTO}` },
    webServer: {
        command: `npx vite build --outDir "${SALIDA}" --emptyOutDir && npx vite preview --outDir "${SALIDA}" --port ${PUERTO} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${PUERTO}`,
        cwd: RAIZ,
        reuseExistingServer: false,
        timeout: 120_000,
    },
});
