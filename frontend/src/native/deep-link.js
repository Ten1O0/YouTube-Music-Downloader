/**
 * Inicio de sesión en la APK: Google devuelve a la app con un enlace
 * (ytdlauth://…) que trae el token y el usuario.
 */

import { i18n } from '../i18n/language-manager.js';
import { showStatus } from '../ui/status.js';

export function initDeepLinks() {
    try {
        if (globalThis.Capacitor?.Plugins?.App) {
            const handleDeepLinkData = async (urlStr) => {
                try {
                    console.log('[NativeAuth] Processing URL:', urlStr);
                    // Robust check: matches protocol OR contains our specific auth params
                    if (urlStr.includes('ytdlauth') || (urlStr.includes('token=') && urlStr.includes('user='))) {
                        // Normalize URL for parsing (some platforms struggle with custom schemes in URL constructor)
                        const normalizedUrl = urlStr.replace('ytdlauth://', 'https://proxy/').replace('ytdlauth:', 'https://proxy/').replace('es.dannarita.music://', 'https://proxy/');
                        const url = new URL(normalizedUrl);

                        const token = url.searchParams.get('token');
                        const userEncoded = url.searchParams.get('user');

                        if (token && userEncoded) {
                            const user = JSON.parse(decodeURIComponent(userEncoded));
                            localStorage.setItem('auth_token', token);
                            localStorage.setItem('auth_user', JSON.stringify(user));

                            console.log('[NativeAuth] Session success. Reloading...');

                            showStatus(i18n.t('auth_linked'), 'success');

                            // Delay reload to let the user see the success message
                            setTimeout(() => globalThis.location.reload(), 1200);
                            return true;
                        }
                    }
                } catch (e) {
                    console.error('[NativeAuth] Error parsing deep link:', e);
                }
                return false;
            };

            // 1. Listen for background -> foreground transitions
            globalThis.Capacitor.Plugins.App.addListener('appUrlOpen', (event) => {
                handleDeepLinkData(event.url);
            });

            // 2. Handle Cold Start (App was closed when link was clicked)
            document.addEventListener('DOMContentLoaded', () => {
                setTimeout(async () => {
                    const { App } = globalThis.Capacitor.Plugins;
                    const ret = await App.getLaunchUrl();
                    if (ret?.url) {
                        console.log('[NativeAuth] Launched via URL:', ret.url);
                        handleDeepLinkData(ret.url);
                    }
                }, 1500); // Wait for app to be ready
            });
        }
    } catch (e) {
        console.warn('[DeepLink] Capacitor not available, skipping deep link setup:', e);
    }
}
