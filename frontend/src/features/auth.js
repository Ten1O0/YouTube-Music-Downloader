/**
 * Inicio de sesión con Google, la sesión y la sincronización con la cuenta.
 */

import { apiBase, isNative, SERVIDOR } from '../config/env.js';
import { StorageModule } from '../core/storage.js';
import { i18n } from '../i18n/language-manager.js';
import { NavigationModule } from '../ui/navigation.js';
import { showStatus } from '../ui/status.js';
import { renderFavorites } from './favorites/panel.js';
import { FavoritesModule } from './favorites/store.js';
import { HISTORY_STORAGE_KEY, renderHistory } from './history.js';

// ========================================
// Auth Manager (Google Sign-In)
// ========================================
const GOOGLE_CLIENT_ID = '938078752300-e59ed4ln5bjeqeb8rfomfjtdtebqcckt.apps.googleusercontent.com';

const AUTH_TOKEN_KEY = 'auth_token';

const AUTH_USER_KEY = 'auth_user';

// v2: el flag v1 se marcaba aunque el sync no llegase a ocurrir (leía de
// localStorage tras la migración a IndexedDB, y siempre encontraba vacío).
const SYNC_FLAG_KEY = 'data_synced_v2';

// Auth DOM elements (Desktop Sidebar & Mobile Bottom-Nav)
const authLoginBtn = document.getElementById('sidebarAuthLoginBtn');

const authLogoutBtn = document.getElementById('sidebarAuthLogoutBtn');

const userProfile = document.getElementById('sidebarUserProfile');

const userAvatar = document.getElementById('sidebarUserAvatar');

const userName = document.getElementById('sidebarUserName');

const navProfileIcon = document.getElementById('navProfileIcon');

const navProfileAvatar = document.getElementById('navProfileAvatar');

const authModal = document.getElementById('authModal');

const authModalClose = document.getElementById('authModalClose');

const authModalBackdrop = authModal ? authModal.querySelector('.auth-modal-backdrop') : null;

const logoutConfirmModal = document.getElementById('logoutConfirmModal');

const logoutConfirmYesBtn = document.getElementById('logoutConfirmYesBtn');

const logoutConfirmNoBtn = document.getElementById('logoutConfirmNoBtn');

const logoutConfirmBackdrop = logoutConfirmModal ? logoutConfirmModal.querySelector('.auth-modal-backdrop') : null;

class AuthManager {
    token = localStorage.getItem(AUTH_TOKEN_KEY) || null;
    user = null;
    _serverHistoryCache = null;

    constructor() {
        try {
            const savedUser = localStorage.getItem(AUTH_USER_KEY);
            if (savedUser) this.user = JSON.parse(savedUser);
        } catch (e) { console.debug('[AuthManager] Failed parsing saved user:', e); }

        this.initEventListeners();
    }

    initEventListeners() {
        if (authLoginBtn) authLoginBtn.addEventListener('click', () => this.showModal());
        if (authLogoutBtn) authLogoutBtn.addEventListener('click', () => this.showLogoutConfirm());

        // «Ajustes» de la barra inferior abre la hoja de ajustes (features/ajustes.js),
        // desde donde se inicia y se cierra la sesión

        if (authModalClose) authModalClose.addEventListener('click', () => this.hideModal());
        if (authModalBackdrop) authModalBackdrop.addEventListener('click', () => this.hideModal());

        if (logoutConfirmYesBtn) {
            logoutConfirmYesBtn.addEventListener('click', () => {
                this.hideLogoutConfirm();
                this.logout();
            });
        }
        if (logoutConfirmNoBtn) {
            logoutConfirmNoBtn.addEventListener('click', () => this.hideLogoutConfirm());
        }
        if (logoutConfirmBackdrop) {
            logoutConfirmBackdrop.addEventListener('click', () => this.hideLogoutConfirm());
        }
    }

    /**
     * Arranca la sesión una sola vez. Se llamaba desde dos sitios del arranque y
     * Google avisaba de «initialize() is called multiple times»; ahora una
     * segunda llamada devuelve la misma promesa (plan 10, T2).
     */
    init() {
        this.iniciando ??= this.#iniciar();
        return this.iniciando;
    }

    async #iniciar() {
        // Initialize Google Identity Services
        this.initGoogleSignIn();

        if (this.token) {
            const valid = await this.checkSession();
            if (valid) {
                this.updateUI(true);
                await this.loadServerData();
                // También cubre el inicio de sesión desde la APK, que guarda el
                // token y recarga la app en vez de pasar por handleGoogleCallback.
                await FavoritesModule.syncWithServer();
            } else {
                this.clearSession();
            }
        }
    }

    showModal() {
        if (authModal) authModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        // Re-render Google button in case modal was just created
        this.renderGoogleButton();
        NavigationModule.pushOverlayState('authModal');
    }

    hideModal() {
        NavigationModule.closeOverlay();
    }

    showLogoutConfirm() {
        if (logoutConfirmModal) logoutConfirmModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        NavigationModule.pushOverlayState('logoutConfirmModal');
    }

    hideLogoutConfirm() {
        NavigationModule.closeOverlay();
    }

    initGoogleSignIn() {
        if (typeof google === 'undefined' || !google.accounts) {
            setTimeout(() => this.initGoogleSignIn(), 500);
            return;
        }

        const config = {
            client_id: GOOGLE_CLIENT_ID
        };

        if (isNative()) {
            // For native Android (WebView), Redirect UX is much more reliable than Popups
            config.ux_mode = 'redirect';
            // Google will POST the credential to this URL
            config.login_uri = `${apiBase()}/api/auth/google/native`;
        } else {
            config.callback = (response) => this.handleGoogleCallback(response);
        }

        google.accounts.id.initialize(config);

        this.renderGoogleButton();
    }

    renderGoogleButton() {
        const container = document.getElementById('googleSignInBtn');
        if (!container) return;

        if (isNative()) {
            // Render a custom, compliant button for native APK
            // Google blocks the official button (iframe) in WebViews
            container.innerHTML = `
                <button id="customGoogleBtn" style="
                    background: #1a73e8; color: #ffffff; border: 1px solid transparent;
                    border-radius: var(--radius-sm); padding: 0 24px; height: 44px; font-weight: 700;
                    display: flex; align-items: center; justify-content: center;
                    gap: 12px; cursor: pointer; transition: var(--transition-ui); width: 100%;
                    max-width: 300px; font-size: 14.5px; box-shadow: 0 4px 12px rgba(26, 115, 232, 0.25);
                    font-family: inherit; margin: 0 auto; outline: none;
                ">
                    <svg width="18" height="18" viewBox="0 0 18 18" style="background: white; border-radius: var(--radius-xs); padding: 3px; flex-shrink:0;">
                        <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/><path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/><path d="M3.964 10.712c-.18-.54-.282-1.117-.282-1.712s.102-1.172.282-1.712V4.956H.957C.347 6.173 0 7.548 0 9s.347 2.827.957 4.044l3.007-2.332z" fill="#FBBC05"/><path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.582C13.463.891 11.426 0 9 0 5.483 0 2.443 2.017.957 4.956L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                    </svg>
                    <span>Continuar con Google</span>
                </button>
            `;

            const btn = document.getElementById('customGoogleBtn');
            if (btn) {
                btn.addEventListener('click', async () => {
                    // Use Capacitor Browser plugin to open in the REAL system browser (Chrome)
                    // window.open('...', '_system') opens a Chrome Custom Tab which does NOT
                    // share cookies/sessions with Chrome, causing Google Auth to fail.
                    try {
                        if (globalThis.Capacitor?.Plugins?.Browser) {
                            await globalThis.Capacitor.Plugins.Browser.open({
                                url: `${SERVIDOR}/auth/native`,
                                presentationStyle: 'fullscreen'
                            });
                        } else {
                            // Fallback if Browser plugin not available
                            globalThis.open(`${SERVIDOR}/auth/native`, '_blank', 'noopener');
                        }
                    } catch (e) {
                        console.error('[NativeAuth] Error opening browser:', e);
                        globalThis.open(`${SERVIDOR}/auth/native`, '_blank', 'noopener');
                    }
                });

                // Al pasar el ratón cambia el color; no se eleva (plan 09, T4)
                btn.addEventListener('mouseenter', () => {
                    btn.style.boxShadow = '0 6px 20px rgba(26, 115, 232, 0.45)';
                    btn.style.background = '#155cb4';
                });
                btn.addEventListener('mouseleave', () => {
                    btn.style.boxShadow = '0 4px 12px rgba(26, 115, 232, 0.25)';
                    btn.style.background = '#1a73e8';
                });
            }
        } else {
            if (typeof google === 'undefined' || !google.accounts) {
                // FALLBACK: If google GSI script is blocked/offline, show a helpful message and retry option
                container.innerHTML = `
                    <div class="google-fallback-container" style="
                        text-align: center; color: var(--text-muted); font-size: 0.85rem; 
                        padding: 20px 15px; border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm); 
                        background: rgba(255,255,255,0.02); display: flex; flex-direction: column; align-items: center; gap: 10px;
                    ">
                        <span class="material-symbols-outlined" style="font-size: 28px; color: var(--text-muted);">cloud_off</span>
                        <span>Google Sign-In no pudo cargarse (bloqueado o sin conexión).</span>
                        <button id="webGoogleFallbackBtn" style="
                            background: var(--accent); color: var(--bg); border: none;
                            border-radius: var(--radius-xs); padding: 8px 16px; font-size: 0.8rem;
                            cursor: pointer; width: 100%; font-weight: 700; transition: var(--transition-ui);
                        ">Reintentar Cargar Google</button>
                    </div>
                `;
                const retryBtn = document.getElementById('webGoogleFallbackBtn');
                if (retryBtn) {
                    retryBtn.addEventListener('click', (e) => {
                        e.preventDefault();
                        retryBtn.textContent = 'Intentando recargar...';
                        const existingScript = document.querySelector('script[src*="gsi/client"]');
                        if (existingScript) existingScript.remove();
                        const script = document.createElement('script');
                        script.src = 'https://accounts.google.com/gsi/client';
                        script.async = true;
                        script.defer = true;
                        script.onload = () => {
                            this.initGoogleSignIn();
                        };
                        script.onerror = () => {
                            retryBtn.textContent = 'Reintentar Cargar Google';
                            showStatus(i18n.t('auth_script_error'), 'error');
                        };
                        document.head.appendChild(script);
                    });
                }
                return;
            }
            // Clear old content and render official Google button
            container.innerHTML = '';
            google.accounts.id.renderButton(container, {
                theme: 'filled_black',
                size: 'large',
                width: 300,
                text: 'continue_with',
                shape: 'pill'
            });
        }
    }

    async handleGoogleCallback(response) {
        if (!response.credential) {
            console.error('No credential in Google response');
            return;
        }

        try {
            showStatus(i18n.t('syncing_data'), 'info');

            const res = await fetch(`${apiBase()}/api/auth/google`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ credential: response.credential })
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.error || 'Authentication failed');
            }

            const data = await res.json();
            this.token = data.token;
            this.user = data.user;

            localStorage.setItem(AUTH_TOKEN_KEY, this.token);
            localStorage.setItem(AUTH_USER_KEY, JSON.stringify(this.user));

            this.hideModal();
            this.updateUI(true);

            // Sync localStorage data to server
            await this.syncLocalData();
            await FavoritesModule.syncWithServer();
            // La biblioteca y las listas (plan 13)
            document.dispatchEvent(new CustomEvent('sesion-iniciada'));

            showStatus(`${i18n.t('logged_in_as')} ${this.user.name}`, 'success');
        } catch (error) {
            console.error('Login error:', error);
            showStatus(error.message || 'Login failed', 'error');
        }
    }

    async checkSession() {
        try {
            const res = await fetch(`${apiBase()}/api/auth/me`, {
                headers: this.getAuthHeaders()
            });
            if (res.ok) {
                const data = await res.json();
                this.user = data.user;
                localStorage.setItem(AUTH_USER_KEY, JSON.stringify(this.user));
                return true;
            }
            return false;
        } catch (e) {
            console.warn('Session check failed:', e);
            return false;
        }
    }

    async syncLocalData() {
        // Solo el historial: los favoritos los sincroniza FavoritesModule, que
        // lleva la cuenta de a quién pertenece la lista local.
        //
        // Only sync once ever — if already synced before, just load server data.
        // Flag versionado (v2): el v1 se marcaba aunque el sync nunca ocurriese,
        // así que todo el mundo reintenta una vez con el código ya corregido.
        if (localStorage.getItem(SYNC_FLAG_KEY)) {
            await this.loadServerData();
            return;
        }

        // Los datos viven en IndexedDB desde migrateStorage(), no en localStorage
        let localHistory = [];

        try {
            localHistory = await StorageModule.get(HISTORY_STORAGE_KEY) || [];
        } catch (e) { console.debug('[AuthManager] No se pudo leer el historial local:', e); }

        if (localHistory.length === 0) {
            // Nada que subir: se marca como sincronizado y se cargan los datos del servidor
            localStorage.setItem(SYNC_FLAG_KEY, 'true');
            await this.loadServerData();
            return;
        }

        try {
            const res = await fetch(`${apiBase()}/api/user/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({
                    history: localHistory,
                    favorites: []
                })
            });

            if (res.ok) {
                const data = await res.json();
                this._serverHistoryCache = data.history;
                // Solo se marca como sincronizado si el servidor ha confirmado.
                // Si falla la red, el próximo login reintenta en vez de darlo por hecho.
                localStorage.setItem(SYNC_FLAG_KEY, 'true');
                renderHistory();
            } else {
                console.warn(`[AuthManager] Sync rechazado por el servidor (${res.status}); se reintentará.`);
            }
        } catch (e) {
            console.error('Sync error:', e);
        }
    }

    async loadServerData() {
        try {
            const historyRes = await fetch(`${apiBase()}/api/user/history`, { headers: this.getAuthHeaders() });
            if (historyRes.ok) {
                const hData = await historyRes.json();
                this._serverHistoryCache = hData.history;
            }
            renderHistory();
        } catch (e) {
            console.error('Failed to load server data:', e);
        }
    }

    logout() {
        this.clearSession();
        this.updateUI(false);
        this._serverHistoryCache = null;
        renderHistory();
        renderFavorites();
        showStatus(i18n.t('sign_out'), 'info');
    }

    clearSession() {
        this.token = null;
        this.user = null;
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
    }

    updateLoggedInUI() {
        // Update Desktop Sidebar
        if (authLoginBtn) authLoginBtn.classList.add('hidden');
        if (userProfile) userProfile.classList.remove('hidden');
        if (userAvatar) {
            userAvatar.src = this.user.picture || '';
            userAvatar.style.display = '';
            userAvatar.onerror = () => { userAvatar.style.display = 'none'; };
        }
        if (userName) userName.textContent = this.user.name || this.user.email;

        // Update Mobile Bottom-Nav
        if (navProfileIcon) navProfileIcon.classList.add('hidden');
        if (navProfileAvatar) {
            navProfileAvatar.src = this.user.picture || '';
            navProfileAvatar.classList.remove('hidden');
            navProfileAvatar.onerror = () => {
                navProfileAvatar.classList.add('hidden');
                if (navProfileIcon) navProfileIcon.classList.remove('hidden');
            };
        }
    }

    updateLoggedOutUI() {
        // Update Desktop Sidebar
        if (authLoginBtn) authLoginBtn.classList.remove('hidden');
        if (userProfile) userProfile.classList.add('hidden');

        // Update Mobile Bottom-Nav
        if (navProfileIcon) navProfileIcon.classList.remove('hidden');
        if (navProfileAvatar) {
            navProfileAvatar.classList.add('hidden');
            navProfileAvatar.src = '';
        }
    }

    updateUI(loggedIn) {
        if (loggedIn && this.user) {
            this.updateLoggedInUI();
        } else {
            this.updateLoggedOutUI();
        }
        // Los ajustes, si están abiertos, cambian con la sesión
        document.dispatchEvent(new CustomEvent('sesion-cambiada'));
    }

    isLoggedIn() {
        return !!this.token && !!this.user;
    }

    getAuthHeaders() {
        if (this.token) {
            return { 'Authorization': `Bearer ${this.token}` };
        }
        return {};
    }
}

export const auth = new AuthManager();
