/**
 * Configuración de los recorridos críticos (plan 06, T7).
 *
 * Levanta el backend real con `yt_dlp` simulado (test/e2e/fake_ytdlp) para que
 * las descargas sean instantáneas, deterministas y sin red.
 *
 * Estos siete recorridos no saben nada de cómo está organizado app.js, así que
 * siguen valiendo después de la modularización del plan 08: son la definición
 * ejecutable de "la aplicación hace lo mismo que antes".
 */

import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

const PUERTO = 5099;
const BASE = `http://127.0.0.1:${PUERTO}`;
const FAKE_YTDLP = path.resolve('test/e2e/fake_ytdlp');

export default defineConfig({
    testDir: './test/e2e',
    testMatch: '**/*.spec.js',

    // Las descargas escriben en disco y el servidor guarda estado en memoria:
    // en serie es más lento pero evita cruces entre recorridos.
    fullyParallel: false,
    workers: 1,

    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    timeout: 45_000,
    expect: { timeout: 10_000 },

    reporter: process.env.CI ? [['html'], ['list']] : 'list',

    use: {
        baseURL: BASE,
        // El locale por defecto de Playwright es en-US, y desde el plan 05 la
        // aplicación detecta el idioma del navegador: sin esto arrancaría en
        // inglés y los recorridos compararían contra el idioma equivocado.
        locale: 'es-ES',
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],

    webServer: {
        // El servidor sirve también el frontend, así que no hace falta Vite.
        // Siempre contra un bundle recién hecho (plan 09, T1): sin dist/, el
        // servidor sirve app.js sin empaquetar, que ya no carga porque importa
        // de src/; y un dist/ viejo haría pasar los recorridos con código antiguo.
        command: `npm run build && python3 server.py`,
        url: `${BASE}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
        env: {
            // Anteponer el yt_dlp simulado: server.py invoca `-m yt_dlp`
            PYTHONPATH: FAKE_YTDLP,
            JWT_SECRET: 'secreto-solo-para-e2e',
            YTDL_DATA_DIR: path.resolve('test/e2e/.tmp-data'),
            PORT: String(PUERTO),
            FLASK_RUN_PORT: String(PUERTO),
            // Los 17 recorridos descargan más de 10 canciones por minuto: con
            // el límite de /api/download, los últimos fallaban (plan 09, T23)
            YTDL_DISABLE_RATELIMIT: '1',
        },
    },
});
