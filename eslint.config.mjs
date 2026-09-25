/**
 * ESLint: solo reglas que detectan fallos, no estilo.
 *
 * - no-undef: una llamada a algo que no existe en ese ámbito. Así se rompieron
 *   las playlists durante meses (nueve llamadas a funciones de PlaylistModule
 *   sin su prefijo) sin que node --check ni los tests lo vieran.
 * - no-dupe-keys: la misma clave dos veces en un objeto; la segunda pisa a la
 *   primera en silencio (pasó con una traducción).
 * - no-unreachable: código que nunca se ejecuta.
 */
import globals from 'globals';

const reglas = {
    'no-undef': 'error',
    'no-dupe-keys': 'error',
    'no-unreachable': 'error',
};

export default [
    // Generado o de terceros
    { ignores: ['dist/**', 'mobile/**', 'node_modules/**', 'test-results/**', 'playwright-report/**', 'public/Sortable.min.js', 'Sortable.min.js'] },
    {
        files: ['app.js', 'src/**/*.js'],
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'module',
            // Sortable, jsmediatags y google llegan por <script> en index.html
            globals: { ...globals.browser, Sortable: 'readonly', jsmediatags: 'readonly', google: 'readonly' },
        },
        rules: reglas,
    },
    {
        files: ['public/sw.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: globals.serviceworker },
        rules: reglas,
    },
    {
        files: ['scripts/**/*.mjs', 'vite.config.js', 'playwright.config.js', 'eslint.config.mjs', 'test/**/*.mjs', 'test/**/*.js'],
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
        rules: reglas,
    },
];
