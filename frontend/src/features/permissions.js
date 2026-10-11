/**
 * Aviso de permisos de la APK la primera vez que se abre.
 */

import { isNative } from '../config/env.js';
import { i18n } from '../i18n/language-manager.js';
import { permisoDeAudio } from '../native/filesystem.js';
import { NavigationModule } from '../ui/navigation.js';
import { showStatus } from '../ui/status.js';

/** El escaneo de las carpetas se carga al usarlo (plan 25: fuera del arranque). */
const scanPublicFolder = (silent) => import('./library/recovery.js').then((m) => m.scanPublicFolder(silent));

/** «Ahora no» al permiso de leer el audio: no se vuelve a preguntar al abrir. */
const CLAVE_OMITIDO = 'ytdl_permiso_audio_omitido';

// ========================================
// Android Permission Onboarding
// ========================================
export const OnboardingModule = (() => {
    const onboardingModal = document.getElementById('permissionOnboardingModal');
    const grantBtn = document.getElementById('grantPermissionBtn');
    const skipBtn = document.getElementById('skipPermissionBtn');

    async function requestNotificationPermission() {
        if (!isNative()) return;
        try {
            const ln = globalThis.Capacitor?.Plugins?.LocalNotifications;
            if (ln) {
                console.log('[Onboarding] Checking notification permissions...');
                let perm = await ln.checkPermissions();
                if (perm.display === 'prompt') {
                    console.log('[Onboarding] Requesting notification permissions...');
                    perm = await ln.requestPermissions();
                }
                console.log('[Onboarding] Notification permission status:', perm.display);
            } else {
                console.warn('[Onboarding] LocalNotifications plugin not found on globalThis.Capacitor.Plugins');
            }
        } catch (e) {
            console.error('[Onboarding] Error requesting notification permissions:', e);
        }
    }

    async function checkPermissions() {
        // Retry logic: Wait for Capacitor to be injected (common for remote URLs)
        let retries = 0;
        const maxRetries = 25; // 5 seconds total (25 * 200ms)

        while (!isNative() && retries < maxRetries) {
            console.log(`[Onboarding] Waiting for Capacitor... (Attempt ${retries + 1})`);
            await new Promise(resolve => setTimeout(resolve, 200));
            retries++;
        }

        // Sync global state once detected

        if (!isNative()) {
            console.warn('[Onboarding] Capacitor not detected or not native. Skipping check.');
            return;
        }

        try {
            const fs = globalThis.Capacitor.Plugins.Filesystem;

            // Check storage permissions (the only ones we can check from JS in Capacitor)
            const storageStatus = await fs.checkPermissions();
            // Desde Android 11, Filesystem lo da por concedido sin pedir nada:
            // el que cuenta es el de leer el audio (PermisoAudioPlugin, plan 24)
            const conAudio = await permisoDeAudio();
            const omitido = localStorage.getItem(CLAVE_OMITIDO) === '1';

            // If storage is granted, skip onboarding and auto-scan
            if (storageStatus.publicStorage === 'granted' && (conAudio || omitido)) {
                console.log('[Onboarding] Storage permission OK. Starting auto-scan...');
                scanPublicFolder(true); // Silent scan
                await requestNotificationPermission();
                return;
            }

            // Show modal if storage is missing
            showOnboarding();
        } catch (e) {
            console.error('[Onboarding] Error checking permissions:', e);
        }
    }

    function showOnboarding() {
        onboardingModal.classList.remove('hidden');
        NavigationModule.pushOverlayState('permissionOnboardingModal');
    }

    function hideOnboarding() {
        NavigationModule.closeOverlay();
    }

    async function requestPermissions() {
        try {
            const fs = globalThis.Capacitor.Plugins.Filesystem;

            // Request Storage Permissions (the only native permission we can request from JS)
            console.log('[Onboarding] Requesting storage permissions...');
            const storageResult = await fs.requestPermissions();
            const conAudio = await permisoDeAudio({ pedir: true });

            if (storageResult.publicStorage === 'granted' && conAudio) {
                showStatus(i18n.t('perms_ok'), 'success');
                scanPublicFolder(true);
                await requestNotificationPermission();
            }

            hideOnboarding();
        } catch (e) {
            console.error('[Onboarding] Error requesting permissions:', e);
            hideOnboarding();
        }
    }

    // Initialize events
    console.info('[Onboarding] Initializing Module...');
    if (onboardingModal) {
        grantBtn.addEventListener('click', requestPermissions);
        // «Ahora no» no vuelve a preguntar al abrir; «Sincronizar» lo pide otra vez
        skipBtn.addEventListener('click', () => {
            try { localStorage.setItem(CLAVE_OMITIDO, '1'); } catch { /* sin almacenamiento */ }
            hideOnboarding();
        });

        // Auto-check on load (IMMEDIATE for Point 7)
        const runAuthCheck = () => {
            console.info('[Onboarding] Triggering immediate permission check');
            checkPermissions();
        };

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', runAuthCheck);
        } else {
            runAuthCheck();
        }
    } else {
        console.warn('[Onboarding] Modal element not found in DOM');
    }

    return { checkPermissions };
})();
