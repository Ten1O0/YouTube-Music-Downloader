import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

/**
 * Sustituye __SW_VERSION__ en dist/sw.js por el commit actual (plan 07, T6).
 *
 * Se ejecuta en closeBundle porque Vite copia public/ al final del build. El
 * try/catch cubre compilar fuera de un repositorio git, donde se cae a una
 * marca temporal.
 */
function swVersion() {
    return {
        name: 'sw-version',
        closeBundle() {
            const destino = resolve(__dirname, 'dist/sw.js');
            if (!existsSync(destino)) return;

            let version;
            try {
                const git = orden => execSync(orden, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
                version = git('git rev-parse --short HEAD');
                // Con cambios sin commit, el commit no identifica lo que se
                // despliega: repetiría la versión del último despliegue y la
                // caché de los bundles anteriores no se purgaría nunca
                if (git('git status --porcelain')) version += `-${Date.now().toString(36)}`;
            } catch {
                version = Date.now().toString(36);
            }

            const contenido = readFileSync(destino, 'utf8');
            writeFileSync(destino, contenido.replaceAll('__SW_VERSION__', version));
            console.log(`[sw-version] CACHE_NAME = ytdl-${version}`);
        },
    };
}

export default defineConfig({
    plugins: [swVersion()],
    server: {
        port: 5173,
        proxy: {
            '/api': {
                target: 'http://127.0.0.1:5000',
                changeOrigin: true,
                secure: false,
            }
        }
    },
    build: {
        rollupOptions: {
            input: {
                main: resolve(__dirname, 'index.html'),
                download: resolve(__dirname, 'download.html'),
            }
        }
    }
});
