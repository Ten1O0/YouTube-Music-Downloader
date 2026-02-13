/**
 * YouTube Downloader - Frontend JavaScript
 * Handles form validation, API communication, progress tracking via polling
 */

// ========================================
// DOM Elements
// ========================================
const urlInput = document.getElementById('youtubeUrl');
const downloadBtn = document.getElementById('downloadBtn');
const clearBtn = document.getElementById('clearBtn');
const statusMessage = document.getElementById('statusMessage');
const progressSection = document.getElementById('progressSection');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const searchResults = document.getElementById('searchResults');
const resultsList = document.getElementById('resultsList');
const themeToggle = document.getElementById('themeToggle');
const qualitySelect = document.getElementById('qualitySelect');

// Playlist Selector Elements
const playlistSelector = document.getElementById('playlistSelector');
const playlistList = document.getElementById('playlistList');
const playlistCount = document.getElementById('playlistCount');
const selectedCount = document.getElementById('selectedCount');
const selectAllBtn = document.getElementById('selectAllBtn');
const deselectAllBtn = document.getElementById('deselectAllBtn');
const downloadSelectedBtn = document.getElementById('downloadSelectedBtn');

// History Elements
const historyToggle = document.getElementById('historyToggle');
const historyContent = document.getElementById('historyContent');
const historyList = document.getElementById('historyList');
const historyCount = document.getElementById('historyCount');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// Favorites Elements
const favoritesToggle = document.getElementById('favoritesToggle');
const favoritesContent = document.getElementById('favoritesContent');
const favoritesList = document.getElementById('favoritesList');
const favoritesCount = document.getElementById('favoritesCount');
const favSelectAllBtn = document.getElementById('favSelectAllBtn');
const favDeselectAllBtn = document.getElementById('favDeselectAllBtn');
const downloadFavoritesBtn = document.getElementById('downloadFavoritesBtn');
const favSelectedCount = document.getElementById('favSelectedCount');

// Store playlist videos for selection
// Store playlist videos for selection
let currentPlaylistVideos = [];

// Search Pagination
let currentSearchResults = [];
let currentSearchPage = 0;
const RESULTS_PER_PAGE = 5;

// ========================================
// Configuration
// ========================================
const API_URL = ''; // Relative path for auto-detection (works with ngrok/localhost) // Relative path for production/ngrok support
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
const HISTORY_MAX_ITEMS = 1000;
const HISTORY_STORAGE_KEY = 'downloadHistory';
const FAVORITES_STORAGE_KEY = 'favorites';

// ========================================
// Language / i18n
// ========================================

const TRANSLATIONS = {
    es: {
        subtitle: 'Descarga tu música favorita en MP3',
        search_placeholder: 'Busca una canción o pega un enlace...',
        hint: 'Compatible con videos, playlists, YouTube Music o busca por nombre',
        download_btn: 'Descargar MP3',
        search_results_title: 'Selecciona una canción:',
        playlist_content: 'Contenido de la Playlist',
        songs: 'canciones',
        select_all: 'Seleccionar todo',
        deselect_all: 'Deseleccionar todo',
        selected: 'seleccionadas',
        download_selected: 'Descargar Seleccionadas',
        playlist_title_prefix: 'Canciones en la playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Descargar seleccionadas (',
        download_selected_suffix: ')',
        loading: 'Cargando...',
        connecting: 'Conectando con YouTube...',
        searching: 'Buscando en YouTube...',
        downloading_zip: 'Preparando archivo ZIP...',
        download_complete: '¡Descarga completada!',
        zip_complete: '¡{n} canciones descargadas en ZIP!',
        error_search: 'Error al buscar. Inténtalo de nuevo',
        error_download: 'Error al descargar. Inténtalo de nuevo',
        input_error: 'Introduce al menos 2 caracteres para buscar',
        url_error: 'Por favor, introduce un enlace de YouTube o busca una canción',
        initializing: 'Iniciando descarga...',
        downloading: 'Descargando...',
        my_favorites: 'Mis Favoritos',
        download_history: 'Historial de descargas',
        clear_history: 'Borrar historial',
        mix_error: '⚠️ Los "Mix" de YouTube no se pueden descargar. Esto es una limitación de YouTube, no de la aplicación. Los Mix son playlists dinámicas generadas automáticamente.',
        powered_by: 'Powered by',
        personal_use: 'Solo para uso personal',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Alta)',
        quality_max: '320kbps (Máxima)',
        preview_error_restricted: 'El propietario ha bloqueado la reproducción en sitios externos. Descárgala para escucharla.',
        preview_error_not_found: 'El video no ha sido encontrado.',
        preview_error_generic: 'Error al reproducir la previsualización.',
        download_complete_title: '¡Descarga completada!',
        cancel_download: 'Cancelar descarga',
        cancelling: 'Cancelando...',
        sign_in: 'Iniciar sesión',
        sign_out: 'Cerrar sesión',
        sign_in_with_google: 'Continuar con Google',
        sign_in_prompt: 'Inicia sesión',
        sign_in_subtitle: 'Guarda tu historial y favoritos en la nube',
        sign_in_footer: 'Solo usamos tu cuenta para guardar tus datos. No publicamos nada.',
        syncing_data: 'Sincronizando datos...',
        data_synced: '¡Datos sincronizados!',
        logged_in_as: 'Conectado como'
    },
    en: {
        subtitle: 'Download your favorite music in MP3',
        search_placeholder: 'Search for a song or paste a link...',
        hint: 'Supports single videos, playlists, YouTube Music or search by name',
        download_btn: 'Download MP3',
        search_results_title: 'Select a song:',
        playlist_content: 'Playlist Content',
        songs: 'songs',
        select_all: 'Select All',
        deselect_all: 'Deselect All',
        selected: 'selected',
        download_selected: 'Download Selected',
        playlist_title_prefix: 'Songs in playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Download selected (',
        download_selected_suffix: ')',
        loading: 'Loading...',
        connecting: 'Connecting to YouTube...',
        searching: 'Searching on YouTube...',
        downloading_zip: 'Preparing ZIP file...',
        download_complete: 'Download completed!',
        zip_complete: '¡{n} songs downloaded in ZIP!',
        error_search: 'Search error. Please try again',
        error_download: 'Download error. Please try again',
        input_error: 'Please enter at least 2 characters to search',
        url_error: 'Please enter a YouTube link or search for a song',
        initializing: 'Initializing download...',
        downloading: 'Downloading...',
        my_favorites: 'My Favorites',
        download_history: 'Download History',
        clear_history: 'Clear History',
        mix_error: '⚠️ YouTube "Mixes" cannot be downloaded. This is a YouTube limitation. Mixes are dynamic playlists.',
        powered_by: 'Powered by',
        personal_use: 'For personal use only',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (High)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'The owner has blocked playback on external sites. Download it to listen.',
        preview_error_not_found: 'Video not found.',
        preview_error_generic: 'Error playing preview.',
        download_complete_title: 'Download completed!',
        cancel_download: 'Cancel download',
        cancelling: 'Cancelling...',
        sign_in: 'Sign in',
        sign_out: 'Sign out',
        sign_in_with_google: 'Continue with Google',
        sign_in_prompt: 'Sign in',
        sign_in_subtitle: 'Save your history and favorites to the cloud',
        sign_in_footer: 'We only use your account to save your data. We never post anything.',
        syncing_data: 'Syncing data...',
        data_synced: 'Data synced!',
        logged_in_as: 'Logged in as'
    },
    fr: {
        subtitle: 'Téléchargez votre musique préférée en MP3',
        search_placeholder: 'Cherchez une chanson ou collez un lien...',
        hint: 'Prend en charge les vidéos uniques, les playlists, YouTube Music ou la recherche par nom',
        download_btn: 'Télécharger MP3',
        search_results_title: 'Sélectionnez une chanson :',
        playlist_content: 'Contenu de la Playlist',
        songs: 'chansons',
        select_all: 'Tout sélectionner',
        deselect_all: 'Tout désélectionner',
        selected: 'sélectionnés',
        download_selected: 'Télécharger la sélection',
        playlist_title_prefix: 'Chansons dans la playlist (',
        playlist_title_suffix: ') :',
        download_selected_prefix: 'Télécharger la sélection (',
        download_selected_suffix: ')',
        loading: 'Chargement...',
        connecting: 'Connexion à YouTube...',
        searching: 'Recherche sur YouTube...',
        downloading_zip: 'Préparation du fichier ZIP...',
        download_complete: 'Téléchargement terminé !',
        zip_complete: '¡{n} chansons téléchargées en ZIP !',
        error_search: 'Erreur de recherche. Veuillez réessayer',
        error_download: 'Erreur de téléchargement. Veuillez réessayer',
        input_error: 'Veuillez saisir au moins 2 caractères pour rechercher',
        url_error: 'Veuillez saisir un lien YouTube ou rechercher une chanson',
        initializing: 'Initialisation du téléchargement...',
        downloading: 'Téléchargement...',
        my_favorites: 'Mes Favoris',
        download_history: 'Historique des téléchargements',
        clear_history: 'Effacer l\'historique',
        mix_error: '⚠️ Les "Mix" YouTube ne peuvent pas être téléchargés. C\'est une limitation de YouTube. Les Mix sont des playlists dynamiques.',
        powered_by: 'Propulsé par',
        personal_use: 'Pour usage personnel seulement',
        quality_normal: '128kbps (Normale)',
        quality_high: '192kbps (Haute)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'Le propriétaire a bloqué la lecture sur des sites externes. Téléchargez-le pour écouter.',
        preview_error_not_found: 'Vidéo non trouvée.',
        preview_error_generic: 'Erreur lors de la lecture de l\'aperçu.',
        download_complete_title: 'Téléchargement terminé !',
        cancel_download: 'Annuler le téléchargement',
        cancelling: 'Annulation...',
        sign_in: 'Se connecter',
        sign_out: 'Se déconnecter',
        sign_in_with_google: 'Continuer avec Google',
        sign_in_prompt: 'Connectez-vous',
        sign_in_subtitle: 'Sauvegardez votre historique et vos favoris dans le cloud',
        sign_in_footer: 'Nous utilisons votre compte uniquement pour sauvegarder vos données. Nous ne publions rien.',
        syncing_data: 'Synchronisation des données...',
        data_synced: 'Données synchronisées !',
        logged_in_as: 'Connecté en tant que'
    },
    de: {
        subtitle: 'Laden Sie Ihre Lieblingsmusik als MP3 herunter',
        search_placeholder: 'Suchen Sie ein Lied oder fügen Sie einen Link ein...',
        hint: 'Unterstützt einzelne Videos, Playlists, YouTube Music oder Namenssuche',
        download_btn: 'MP3 herunterladen',
        search_results_title: 'Wählen Sie ein Lied:',
        playlist_content: 'Playlist-Inhalt',
        songs: 'Lieder',
        select_all: 'Alles auswählen',
        deselect_all: 'Alles abwählen',
        selected: 'ausgewählt',
        download_selected: 'Ausgewählte herunterladen',
        playlist_title_prefix: 'Lieder in der Playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Ausgewählte herunterladen (',
        download_selected_suffix: ')',
        loading: 'Laden...',
        connecting: 'Verbindung zu YouTube...',
        searching: 'Suche auf YouTube...',
        downloading_zip: 'ZIP-Datei wird vorbereitet...',
        download_complete: 'Download abgeschlossen!',
        zip_complete: '¡{n} Lieder als ZIP heruntergeladen!',
        error_search: 'Suchfehler. Bitte versuchen Sie es erneut',
        error_download: 'Downloadfehler. Bitte versuchen Sie es erneut',
        input_error: 'Geben Sie mindestens 2 Zeichen für die Suche ein',
        url_error: 'Bitte geben Sie einen YouTube-Link ein oder suchen Sie nach einem Lied',
        initializing: 'Download wird gestartet...',
        downloading: 'Herunterladen...',
        my_favorites: 'Meine Favoriten',
        download_history: 'Download-Verlauf',
        clear_history: 'Verlauf löschen',
        mix_error: '⚠️ YouTube "Mixe" können nicht heruntergeladen werden. Dies ist eine Einschränkung von YouTube. Mixe sind dynamische Playlists.',
        powered_by: 'Angetrieben von',
        personal_use: 'Nur für den persönlichen Gebrauch',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Hoch)',
        quality_max: '320kbps (Max)',
        preview_error_restricted: 'Der Eigentümer hat die Wiedergabe auf externen Websites blockiert. Laden Sie es herunter, um es anzuhören.',
        preview_error_not_found: 'Video nicht gefunden.',
        preview_error_generic: 'Fehler bei der Vorschauwiedergabe.',
        download_complete_title: 'Download abgeschlossen!',
        cancel_download: 'Download abbrechen',
        cancelling: 'Abbrechen...',
        sign_in: 'Anmelden',
        sign_out: 'Abmelden',
        sign_in_with_google: 'Mit Google fortfahren',
        sign_in_prompt: 'Anmelden',
        sign_in_subtitle: 'Speichern Sie Ihren Verlauf und Ihre Favoriten in der Cloud',
        sign_in_footer: 'Wir verwenden Ihr Konto nur zum Speichern Ihrer Daten. Wir veröffentlichen nichts.',
        syncing_data: 'Daten werden synchronisiert...',
        data_synced: 'Daten synchronisiert!',
        logged_in_as: 'Angemeldet als'
    },
    pt: {
        subtitle: 'Baixe suas músicas favoritas em MP3',
        search_placeholder: 'Pesquise uma música ou cole um link...',
        hint: 'Suporta vídeos únicos, playlists, YouTube Music ou pesquisa por nome',
        download_btn: 'Baixar MP3',
        search_results_title: 'Selecione uma música:',
        playlist_content: 'Conteúdo da Playlist',
        songs: 'músicas',
        select_all: 'Selecionar tudo',
        deselect_all: 'Desmarcar tudo',
        selected: 'selecionados',
        download_selected: 'Baixar Selecionados',
        playlist_title_prefix: 'Músicas na playlist (',
        playlist_title_suffix: '):',
        download_selected_prefix: 'Baixar selecionados (',
        download_selected_suffix: ')',
        loading: 'Carregando...',
        connecting: 'Conectando ao YouTube...',
        searching: 'Pesquisando no YouTube...',
        downloading_zip: 'Preparando arquivo ZIP...',
        download_complete: 'Download concluído!',
        zip_complete: '¡{n} músicas baixadas em ZIP!',
        error_search: 'Erro na pesquisa. Tente novamente',
        error_download: 'Erro no download. Tente novamente',
        input_error: 'Digite pelo menos 2 caracteres para pesquisar',
        url_error: 'Por favor, insira um link do YouTube ou pesquise uma música',
        initializing: 'Iniciando download...',
        downloading: 'Baixando...',
        my_favorites: 'Meus Favoritos',
        download_history: 'Histórico de downloads',
        clear_history: 'Limpar histórico',
        mix_error: '⚠️ Os "Mix" do YouTube não podem ser baixados. Esta é uma limitação do YouTube. Mixes são playlists dinâmicas.',
        powered_by: 'Distribuído por',
        personal_use: 'Apenas para uso pessoal',
        quality_normal: '128kbps (Normal)',
        quality_high: '192kbps (Alta)',
        quality_max: '320kbps (Máxima)',
        preview_error_restricted: 'O proprietário bloqueou a reprodução em sites externos. Baixe para ouvir.',
        preview_error_not_found: 'Vídeo não encontrado.',
        preview_error_generic: 'Erro ao reproduzir prévia.',
        download_complete_title: 'Download concluído!',
        cancel_download: 'Cancelar download',
        cancelling: 'Cancelando...',
        sign_in: 'Entrar',
        sign_out: 'Sair',
        sign_in_with_google: 'Continuar com o Google',
        sign_in_prompt: 'Faça login',
        sign_in_subtitle: 'Salve seu histórico e favoritos na nuvem',
        sign_in_footer: 'Usamos sua conta apenas para salvar seus dados. Não publicamos nada.',
        syncing_data: 'Sincronizando dados...',
        data_synced: 'Dados sincronizados!',
        logged_in_as: 'Conectado como'
    },
    zh: {
        subtitle: '以 MP3 格式下载您喜爱的音乐',
        search_placeholder: '搜索歌曲或粘贴链接...',
        hint: '支持单个视频、播放列表、YouTube Music 或按名称搜索',
        download_btn: '下载 MP3',
        search_results_title: '选择一首歌曲：',
        playlist_content: '播放列表内容',
        songs: '首歌曲',
        select_all: '全选',
        deselect_all: '取消全选',
        selected: '已选择',
        download_selected: '下载所选',
        playlist_title_prefix: '播放列表中的歌曲 (',
        playlist_title_suffix: '):',
        download_selected_prefix: '下载所选 (',
        download_selected_suffix: ')',
        loading: '加载中...',
        connecting: '正在连接到 YouTube...',
        searching: '正在 YouTube 上搜索...',
        downloading_zip: '正在准备 ZIP 文件...',
        download_complete: '下载完成！',
        zip_complete: '已下载 {n} 首歌曲到 ZIP！',
        error_search: '搜索错误。请重试',
        error_download: '下载错误。请重试',
        input_error: '请输入至少 2 个字符进行搜索',
        url_error: '请输入 YouTube 链接或搜索歌曲',
        initializing: '正在开始下载...',
        downloading: '正在下载...',
        my_favorites: '我的收藏',
        download_history: '下载历史',
        clear_history: '清除历史',
        mix_error: '⚠️ YouTube "合辑" 无法下载。这是 YouTube 的限制。合辑是自动生成的动态播放列表。',
        powered_by: '技术支持',
        personal_use: '仅供个人使用',
        quality_normal: '128kbps (正常)',
        quality_high: '192kbps (高)',
        quality_max: '320kbps (最大)',
        preview_error_restricted: '所有者已阻止在外部网站上播放。下载以收听。',
        preview_error_not_found: '未找到视频。',
        preview_error_generic: '预览播放错误。',
        download_complete_title: '下载完成！',
        cancel_download: '取消下载',
        cancelling: '正在取消...',
        sign_in: '登录',
        sign_out: '退出',
        sign_in_with_google: '使用 Google 继续',
        sign_in_prompt: '登录',
        sign_in_subtitle: '将您的历史记录和收藏保存到云端',
        sign_in_footer: '我们仅使用您的帐户来保存您的数据。我们不会发布任何内容。',
        syncing_data: '正在同步数据...',
        data_synced: '数据已同步！',
        logged_in_as: '已登录为'
    }
};

const langToggle = document.getElementById('langToggle');
const langMenu = document.getElementById('langMenu');
const currentLangDisplay = document.querySelector('.current-lang');

class LanguageManager {
    constructor() {
        this.currentLang = localStorage.getItem('language') || 'es';
        this.init();
    }

    init() {
        this.setLanguage(this.currentLang);

        // Event Listeners
        if (langToggle) {
            langToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                langMenu.classList.toggle('hidden');
                langToggle.parentElement.classList.toggle('open');
            });
        }

        document.addEventListener('click', () => {
            if (langMenu) langMenu.classList.add('hidden');
            if (langToggle && langToggle.parentElement) langToggle.parentElement.classList.remove('open');
        });

        document.querySelectorAll('.lang-option').forEach(btn => {
            btn.addEventListener('click', () => {
                this.setLanguage(btn.dataset.lang);
            });
        });
    }

    setLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('language', lang);

        // Update UI Flag
        const startFlags = {
            'es': '<img src="https://flagcdn.com/24x18/es.png" class="lang-flag-current" alt="ES">',
            'en': '<img src="https://flagcdn.com/24x18/gb.png" class="lang-flag-current" alt="EN">',
            'fr': '<img src="https://flagcdn.com/24x18/fr.png" class="lang-flag-current" alt="FR">',
            'de': '<img src="https://flagcdn.com/24x18/de.png" class="lang-flag-current" alt="DE">',
            'pt': '<img src="https://flagcdn.com/24x18/pt.png" class="lang-flag-current" alt="PT">',
            'zh': '<img src="https://flagcdn.com/24x18/cn.png" class="lang-flag-current" alt="ZH">'
        };

        if (currentLangDisplay) currentLangDisplay.innerHTML = startFlags[lang] || lang.toUpperCase();

        // Update Static Text
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            if (TRANSLATIONS[lang][key]) {
                el.textContent = TRANSLATIONS[lang][key];
            }
        });

        // Update Placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.dataset.i18nPlaceholder;
            if (TRANSLATIONS[lang][key]) {
                el.placeholder = TRANSLATIONS[lang][key];
            }
        });

        // Update active state in menu
        document.querySelectorAll('.lang-option').forEach(btn => {
            if (btn.dataset.lang === lang) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    }

    t(key, params = {}) {
        let text = (TRANSLATIONS[this.currentLang] && TRANSLATIONS[this.currentLang][key]) || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    }
}

const i18n = new LanguageManager();

// ========================================
// Auth Manager (Google Sign-In)
// ========================================

const GOOGLE_CLIENT_ID = '938078752300-e59ed4ln5bjeqeb8rfomfjtdtebqcckt.apps.googleusercontent.com';
const AUTH_TOKEN_KEY = 'auth_token';
const AUTH_USER_KEY = 'auth_user';

// Auth DOM elements
const authLoginBtn = document.getElementById('authLoginBtn');
const authLogoutBtn = document.getElementById('authLogoutBtn');
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const authModal = document.getElementById('authModal');
const authModalClose = document.getElementById('authModalClose');
const authModalBackdrop = authModal ? authModal.querySelector('.auth-modal-backdrop') : null;
const googleSignInBtn = document.getElementById('googleSignInBtn');

class AuthManager {
    constructor() {
        this.token = localStorage.getItem(AUTH_TOKEN_KEY) || null;
        this.user = null;
        this._serverHistoryCache = null;
        this._serverFavoritesCache = null;

        try {
            const savedUser = localStorage.getItem(AUTH_USER_KEY);
            if (savedUser) this.user = JSON.parse(savedUser);
        } catch (e) { /* ignore */ }

        this.initEventListeners();
    }

    initEventListeners() {
        if (authLoginBtn) authLoginBtn.addEventListener('click', () => this.showGoogleOneTap());
        if (authLogoutBtn) authLogoutBtn.addEventListener('click', () => this.logout());
        if (authModalClose) authModalClose.addEventListener('click', () => this.hideModal());
        if (authModalBackdrop) authModalBackdrop.addEventListener('click', () => this.hideModal());
        if (googleSignInBtn) googleSignInBtn.addEventListener('click', () => this.showGoogleOneTap());
    }

    async init() {
        if (this.token) {
            const valid = await this.checkSession();
            if (valid) {
                this.updateUI(true);
                await this.loadServerData();
            } else {
                this.clearSession();
                this.showGoogleOneTap();
            }
        } else {
            // Not logged in — show Google One Tap automatically
            this.showGoogleOneTap();
        }
    }

    showModal() {
        if (authModal) authModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    hideModal() {
        if (authModal) authModal.classList.add('hidden');
        document.body.style.overflow = '';
    }

    showGoogleOneTap() {
        if (typeof google === 'undefined' || !google.accounts) {
            console.warn('Google Identity Services not loaded yet, retrying...');
            setTimeout(() => this.showGoogleOneTap(), 1000);
            return;
        }

        google.accounts.id.initialize({
            client_id: GOOGLE_CLIENT_ID,
            callback: (response) => this.handleGoogleCallback(response),
            auto_select: false
        });

        // Show the native Google One Tap popup (top-right corner)
        google.accounts.id.prompt();
    }

    async handleGoogleCallback(response) {
        if (!response.credential) {
            console.error('No credential in Google response');
            return;
        }

        try {
            showStatus(i18n.t('syncing_data'), 'info');

            const res = await fetch(`${API_URL}/api/auth/google`, {
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

            showStatus(`${i18n.t('logged_in_as')} ${this.user.name}`, 'success');
        } catch (error) {
            console.error('Login error:', error);
            showStatus(error.message || 'Login failed', 'error');
        }
    }

    async checkSession() {
        try {
            const res = await fetch(`${API_URL}/api/auth/me`, {
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
        // Only sync once ever — if already synced before, just load server data
        if (localStorage.getItem('data_synced')) {
            await this.loadServerData();
            return;
        }

        // Get current localStorage data
        let localHistory = [];
        let localFavorites = [];

        try {
            const h = localStorage.getItem(HISTORY_STORAGE_KEY);
            if (h) localHistory = JSON.parse(h);
        } catch (e) { /* ignore */ }

        try {
            const f = localStorage.getItem(FAVORITES_STORAGE_KEY);
            if (f) localFavorites = JSON.parse(f);
        } catch (e) { /* ignore */ }

        if (localHistory.length === 0 && localFavorites.length === 0) {
            // Nothing to sync, just load server data
            localStorage.setItem('data_synced', 'true');
            await this.loadServerData();
            return;
        }

        try {
            const res = await fetch(`${API_URL}/api/user/sync`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...this.getAuthHeaders()
                },
                body: JSON.stringify({
                    history: localHistory,
                    favorites: localFavorites
                })
            });

            if (res.ok) {
                const data = await res.json();
                this._serverHistoryCache = data.history;
                this._serverFavoritesCache = data.favorites;
                localStorage.setItem('data_synced', 'true');
                renderHistory();
                renderFavorites();
            }
        } catch (e) {
            console.error('Sync error:', e);
        }
    }

    async loadServerData() {
        try {
            const [historyRes, favoritesRes] = await Promise.all([
                fetch(`${API_URL}/api/user/history`, { headers: this.getAuthHeaders() }),
                fetch(`${API_URL}/api/user/favorites`, { headers: this.getAuthHeaders() })
            ]);

            if (historyRes.ok) {
                const hData = await historyRes.json();
                this._serverHistoryCache = hData.history;
            }
            if (favoritesRes.ok) {
                const fData = await favoritesRes.json();
                this._serverFavoritesCache = fData.favorites;
            }

            renderHistory();
            renderFavorites();
        } catch (e) {
            console.error('Failed to load server data:', e);
        }
    }

    logout() {
        this.clearSession();
        this.updateUI(false);
        this._serverHistoryCache = null;
        this._serverFavoritesCache = null;
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

    updateUI(loggedIn) {
        if (loggedIn && this.user) {
            if (authLoginBtn) authLoginBtn.classList.add('hidden');
            if (userProfile) userProfile.classList.remove('hidden');
            if (userAvatar) {
                userAvatar.src = this.user.picture || '';
                userAvatar.onerror = () => { userAvatar.style.display = 'none'; };
            }
            if (userName) userName.textContent = this.user.name || this.user.email;
        } else {
            if (authLoginBtn) authLoginBtn.classList.remove('hidden');
            if (userProfile) userProfile.classList.add('hidden');
        }
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

const auth = new AuthManager();

// ========================================
// Utility Functions
// ========================================

function isValidInput(input) {
    const trimmed = input.trim();
    return YOUTUBE_URL_PATTERN.test(trimmed) || trimmed.length >= 2;
}

function isUrl(input) {
    return YOUTUBE_URL_PATTERN.test(input.trim());
}

function isPlaylistUrl(input) {
    const url = input.trim();
    // Check for playlist URL (list=PL...) but not Radio/Mix (list=RD...)
    const hasPlaylistParam = /[?&]list=([a-zA-Z0-9_-]+)/.test(url);
    const isRadioMix = /[?&]list=RD/.test(url);
    return hasPlaylistParam && !isRadioMix;
}

function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type} visible`;
}

function hideStatus() {
    statusMessage.className = 'status-message';
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

function showProgress() {
    progressSection.classList.remove('hidden');
    updateProgress(0, i18n.t('initializing'));
}

function hideProgress() {
    progressSection.classList.add('hidden');
}

function showSearchResults() {
    searchResults.classList.remove('hidden');
}

function hideSearchResults() {
    searchResults.classList.add('hidden');
    resultsList.innerHTML = '';
}

function showPlaylistSelector() {
    playlistSelector.classList.remove('hidden');
}

function hidePlaylistSelector() {
    playlistSelector.classList.add('hidden');
    playlistList.innerHTML = '';
    currentPlaylistVideos = [];
}

function formatDuration(seconds) {
    if (!seconds) return '';
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function setLoading(loading) {
    if (loading) {
        downloadBtn.classList.add('loading');
        downloadBtn.disabled = true;
    } else {
        downloadBtn.classList.remove('loading');
        downloadBtn.disabled = false;
    }
}

function downloadBlob(blob, filename) {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
}

// ========================================
// Progress Polling
// ========================================

async function pollProgress(downloadId, total) {
    return new Promise((resolve, reject) => {
        const pollInterval = setInterval(async () => {
            try {
                const response = await fetch(`${API_URL}/api/progress/${downloadId}`);
                const data = await response.json();

                // Update Visual Queue Manager
                if (typeof queueManager !== 'undefined') {
                    let qPercent = 0;
                    if (data.status === 'complete') qPercent = 100;
                    else if (total > 0) qPercent = (data.current / total) * 100;

                    if (data.status === 'downloading') {
                        // For single file, simulate indefinite progress or step
                        if (total === 1 && data.current === 0) qPercent = 50; // Fake 50% while converting
                        queueManager.update(downloadId, qPercent, data.message || i18n.t('downloading'), data);
                    } else if (data.status === 'complete') {
                        queueManager.complete(downloadId);
                    }
                }

                if (data.status === 'downloading') {
                    const percent = total > 0
                        ? Math.min(10 + (data.current / total) * 80, 90)
                        : 50;
                    updateProgress(percent, data.message);
                } else if (data.status === 'complete') {
                    clearInterval(pollInterval);
                    updateProgress(95, data.message);

                    // Update history with final metadata
                    // Use data.video_id (from server) to match the history item, 
                    // NOT downloadId (which is just a session UUID)
                    if (data.video_id && (data.title || data.thumbnail)) {
                        updateHistoryItem(data.video_id, {
                            title: data.title,
                            thumbnail: data.thumbnail
                        });
                        // Also update favorites if present
                        updateFavoriteItem(data.video_id, {
                            title: data.title,
                            thumbnail: data.thumbnail
                        });
                    }

                    resolve(data);
                } else if (data.status === 'error') {
                    clearInterval(pollInterval);
                    if (typeof queueManager !== 'undefined') queueManager.remove(downloadId); // Remove if error
                    reject(new Error(data.message));
                } else if (data.status === 'cancelled') {
                    clearInterval(pollInterval);
                    // Cancelled downloads are already handled by queueManager.cancel()
                    // Just resolve silently without triggering download or error
                    resolve({ cancelled: true });
                } else if (data.status === 'starting') {
                    updateProgress(5, data.message);
                }
            } catch (err) {
                // Continue polling on network errors
                console.warn('Poll error:', err);
            }
        }, 1000);

        // Timeout after 30 minutes
        setTimeout(() => {
            clearInterval(pollInterval);
            reject(new Error('La descarga tardó demasiado'));
        }, 30 * 60 * 1000);
    });
}

// ========================================
// Main Download Function
// ========================================

async function handleDownload() {
    const input = urlInput.value.trim();

    if (!input) {
        showStatus(i18n.t('url_error'), 'error');
        urlInput.focus();
        return;
    }

    if (!isValidInput(input)) {
        showStatus(i18n.t('input_error'), 'error');
        urlInput.focus();
        return;
    }

    hideStatus();
    hideSearchResults();
    hidePlaylistSelector();

    // Check if it's a playlist URL first
    if (isPlaylistUrl(input)) {
        await fetchAndShowPlaylist(input);
    } else if (isUrl(input)) {
        await downloadFromUrl(input);
    } else {
        await searchAndShowResults(input);
    }
}

async function searchAndShowResults(query) {
    setLoading(true);
    showProgress();
    updateProgress(30, i18n.t('searching'));

    try {
        const response = await fetch(`${API_URL}/api/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al buscar');
        }

        const { results } = await response.json();
        hideProgress();
        renderSearchResults(results);

    } catch (error) {
        console.error('Search error:', error);
        hideProgress();
        const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al buscar. Inténtalo de nuevo');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderSearchResults(results) {
    // Initialize new search
    currentSearchResults = results;
    currentSearchPage = 0;
    resultsList.innerHTML = '';

    showNextPage();
    showSearchResults();
}

function showNextPage() {
    // Remove existing "Load More" button if present
    const existingBtn = document.getElementById('loadMoreContainer');
    if (existingBtn) existingBtn.remove();

    const start = currentSearchPage * RESULTS_PER_PAGE;
    const end = start + RESULTS_PER_PAGE;
    const pageItems = currentSearchResults.slice(start, end);

    pageItems.forEach(video => {
        const item = document.createElement('div');
        item.className = 'result-item';

        // Extract video ID from URL
        const videoId = extractVideoId(video.url);

        const isFav = isFavorite(videoId);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = `
            <button class="preview-btn" data-video-id="${videoId}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${videoId}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="result-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="result-info">
                <div class="result-title">${video.title}</div>
                <div class="result-meta">
                    <span class="result-channel">${video.channel}</span>
                    ${video.duration ? `<span class="result-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(videoId, previewBtn);
        });

        // Favorite click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(video, favBtn);
        });

        // Download click handler (on rest of the item)
        const thumbnail = item.querySelector('.result-thumbnail');
        const infoArea = item.querySelector('.result-info');

        const startDownload = () => {
            stopPreview();
            // Do NOT hide search results to allow multiple downloads
            // hideSearchResults();

            // Pass the item element for visual feedback (background mode)
            downloadFromUrl(video.url, video, { item });
        };

        thumbnail.style.cursor = 'pointer';
        thumbnail.addEventListener('click', startDownload);
        infoArea.style.cursor = 'pointer';
        infoArea.addEventListener('click', startDownload);

        resultsList.appendChild(item);
    });

    currentSearchPage++;

    // Add Load More button if there are more results
    if (end < currentSearchResults.length) {
        const btnContainer = document.createElement('div');
        btnContainer.id = 'loadMoreContainer';
        btnContainer.className = 'load-more-container';
        btnContainer.innerHTML = `<button class="load-more-btn">Cargar más resultados (${currentSearchResults.length - end} restantes)...</button>`;

        btnContainer.querySelector('button').addEventListener('click', showNextPage);
        resultsList.appendChild(btnContainer);
    }
}

// Extract video ID from YouTube URL
function extractVideoId(url) {
    const match = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
    return match ? match[1] : null;
}

async function downloadFromUrl(url, videoInfo = null, uiElements = null) {
    const isBackground = !!uiElements;

    setLoading(true);

    if (!isBackground) {
        showProgress();
        updateProgress(5, i18n.t('connecting'));
    } else {
        showStatus(`${i18n.t('initializing')}: ${videoInfo?.title || 'Download'}`, 'info');
        if (uiElements?.item) {
            uiElements.item.style.opacity = '0.7';
            uiElements.item.style.pointerEvents = 'none';
        }
    }

    try {
        // Step 1: Start the download
        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, quality }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id, total, title, thumbnail } = await startResponse.json();

        // Ensure videoInfo exists for QueueManager (even for direct URL downloads)
        // Use metadata from server response if available
        if (!videoInfo || videoInfo.title === 'YouTube Video') {
            videoInfo = {
                id: download_id,
                title: title || 'YouTube Video',
                thumbnail: thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
                channel: 'YouTube'
            };
        }

        // Add to visual queue manager
        if (typeof queueManager !== 'undefined') {
            queueManager.add(download_id, videoInfo);
        }

        if (!isBackground) {
            updateProgress(10, total > 1
                ? `Preparando descarga de ${total} canciones...`
                : 'Descargando...');
        }

        // Step 2: Poll for progress
        // We poll even in background, though UI updates might be invisible
        const finalProgressData = await pollProgress(download_id, total);

        // Check if download was cancelled - skip everything if so
        if (finalProgressData.cancelled) {
            if (!isBackground) hideProgress();
            if (uiElements?.item) {
                uiElements.item.style.opacity = '1';
                uiElements.item.style.pointerEvents = 'auto';
            }
            setLoading(false);
            return; // Exit early, don't download or save to history
        }

        // Step 3: Trigger Download
        // We use window.location.href instead of fetch+blob for robust mobile support
        if (!isBackground) updateProgress(100, '¡Descarga completada!');

        // Use a small timeout to allow UI update before navigation
        setTimeout(() => {
            window.location.href = `${API_URL}/api/download/${download_id}`;
        }, 500);

        // Add to history
        const videoId = extractVideoId(url) || finalProgressData.video_id;

        // Construct history entry
        const historyEntry = {
            id: videoId || videoInfo?.id,
            // Fallback to "Descarga" if no title found (since we don't have filename from headers anymore)
            title: finalProgressData.title || (videoInfo && videoInfo.title !== 'YouTube Video' ? videoInfo.title : null) || 'Descarga',
            url: url,
            thumbnail: finalProgressData.thumbnail || videoInfo?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
            channel: videoInfo?.channel || 'YouTube',
            downloadedAt: new Date().toISOString()
        };
        if (total === 1) {  // Only add single downloads to history
            addToHistory(historyEntry);
        }

        // Trigger manual blob download (as backup) is NOT needed if we navigate
        // downloadBlob(blob, filename); <-- Removed

        if (!isBackground) {
            showSuccessAnimation();
            setTimeout(() => {
                showStatus(i18n.t('download_complete'), 'success');
                hideProgress();
            }, 1000);
        } else {
            showStatus(`¡Descargado! ${videoInfo?.title || 'Video'}`, 'success');
            if (uiElements?.item) {
                uiElements.item.style.opacity = '1';
                uiElements.item.style.pointerEvents = 'auto';
                uiElements.item.style.borderColor = 'var(--success-color)';
            }
        }
    } catch (error) {
        console.error('Download error:', error);

        if (!isBackground) hideProgress();

        if (uiElements?.item) {
            uiElements.item.style.opacity = '1';
            uiElements.item.style.pointerEvents = 'auto';
            uiElements.item.style.borderColor = 'var(--error-color)';
        }

        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            showStatus('No se puede conectar al servidor. Asegúrate de que está ejecutándose', 'error');
        } else {
            const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al descargar. Inténtalo de nuevo');
            showStatus(msg, 'error');
        }
    } finally {
        setLoading(false);
    }
}

// ========================================
// Event Listeners
// ========================================

downloadBtn.addEventListener('click', handleDownload);

urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleDownload();
    }
});

urlInput.addEventListener('input', () => {
    if (statusMessage.classList.contains('visible')) {
        hideStatus();
    }
});

// Clear button functionality
clearBtn.addEventListener('click', () => {
    urlInput.value = '';
    hideStatus();
    hidePlaylistSelector();
    urlInput.focus();
});

// ========================================
// Playlist Selector Functions
// ========================================

async function fetchAndShowPlaylist(url) {
    setLoading(true);
    showProgress();
    updateProgress(30, 'Obteniendo canciones de la playlist...');

    try {
        const response = await fetch(`${API_URL}/api/playlist-info`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al obtener la playlist');
        }

        const { videos, total } = await response.json();
        hideProgress();
        renderPlaylistSelector(videos);

    } catch (error) {
        console.error('Playlist fetch error:', error);
        hideProgress();
        const msg = error.message === 'MIX_PLAYLIST_ERROR' ? i18n.t('mix_error') : (error.message || 'Error al obtener la playlist');
        showStatus(msg, 'error');
    } finally {
        setLoading(false);
    }
}

function renderPlaylistSelector(videos) {
    currentPlaylistVideos = videos;
    playlistList.innerHTML = '';
    playlistCount.textContent = videos.length;

    videos.forEach((video, index) => {
        const item = document.createElement('div');
        item.className = 'playlist-item selected';
        item.dataset.index = index;

        const isFav = isFavorite(video.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        item.innerHTML = `
            <input type="checkbox" class="playlist-checkbox" data-index="${index}" checked>
            <button class="preview-btn" data-video-id="${video.id}" title="Escuchar preview">
                <svg class="music-icon" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
                </svg>
                <svg class="pause-icon" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16"/>
                    <rect x="14" y="4" width="4" height="16"/>
                </svg>
            </button>
            <button class="favorite-btn ${heartClass}" data-id="${video.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="playlist-thumbnail" src="${video.thumbnail}" alt="${video.title}" loading="lazy">
            <div class="playlist-info">
                <div class="playlist-item-title">${video.title}</div>
                <div class="playlist-meta">
                    <span class="playlist-channel">${video.channel}</span>
                    ${video.duration ? `<span class="playlist-duration">${formatDuration(video.duration)}</span>` : ''}
                </div>
            </div>
        `;

        // Preview button click handler
        const previewBtn = item.querySelector('.preview-btn');
        previewBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            togglePreview(video.id, previewBtn);
        });

        // Favorite button click handler
        const favBtn = item.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(video, favBtn);
        });

        // Toggle selection on click (but not on checkbox or preview button)
        item.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.preview-btn')) {
                const checkbox = item.querySelector('.playlist-checkbox');
                checkbox.checked = !checkbox.checked;
            }
            item.classList.toggle('selected', item.querySelector('.playlist-checkbox').checked);
            updateSelectedCount();
        });

        playlistList.appendChild(item);
    });

    updateSelectedCount();
    showPlaylistSelector();
}

function updateSelectedCount() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const count = checkboxes.length;
    selectedCount.textContent = count;
    downloadSelectedBtn.disabled = count === 0;
}

function selectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.add('selected');
        item.querySelector('.playlist-checkbox').checked = true;
    });
    updateSelectedCount();
}

function deselectAllPlaylistItems() {
    const items = playlistList.querySelectorAll('.playlist-item');
    items.forEach(item => {
        item.classList.remove('selected');
        item.querySelector('.playlist-checkbox').checked = false;
    });
    updateSelectedCount();
}

async function downloadSelectedPlaylistVideos() {
    const checkboxes = playlistList.querySelectorAll('.playlist-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = parseInt(cb.dataset.index);
        return currentPlaylistVideos[index];
    });

    if (selectedVideos.length === 0) {
        showStatus('Selecciona al menos una canción', 'error');
        return;
    }

    hidePlaylistSelector();
    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    // If only one song, use regular single download
    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Check for Mobile/Tablet
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    // Mobile specific: If > 2 songs, download individually to avoid huge ZIPs
    if (isMobile && total > 2) {
        try {
            // Processing Queue with Concurrency Limit
            const CONCURRENCY_LIMIT = 5;
            let activeCount = 0;
            let completedCount = 0;
            let queueIndex = 0;
            const errors = [];

            updateProgress(5, `Iniciando descarga paralela (${selectedVideos.length} canciones)...`);

            // Helper to process one video
            const processVideo = async (video, index) => {
                try {
                    const cleanTitle = video.title.replace(/[^\w\s-]/g, '').substring(0, 20);

                    // 1. Start individual download
                    const quality = qualitySelect.value;
                    const startResponse = await fetch(`${API_URL}/api/start-download`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: video.url, quality }),
                    });

                    if (!startResponse.ok) throw new Error('Start failed');
                    const { download_id } = await startResponse.json();

                    // 2. Poll progress 
                    // (We use a simplified poll that doesn't block global UI progress)
                    const finalData = await pollProgress(download_id, 100);

                    // 3. Trigger download via iframe
                    const iframe = document.createElement('iframe');
                    iframe.style.display = 'none';
                    iframe.src = `${API_URL}/api/download/${download_id}`;
                    document.body.appendChild(iframe);
                    setTimeout(() => document.body.removeChild(iframe), 60000);

                    // 4. Add to history
                    addToHistory({
                        id: video.id,
                        title: finalData.title || video.title,
                        thumbnail: finalData.thumbnail || video.thumbnail,
                        channel: video.channel,
                        url: video.url,
                        downloadedAt: new Date().toISOString()
                    });

                } catch (err) {
                    console.error(`Error downloading ${video.title}:`, err);
                    errors.push(video.title);
                } finally {
                    completedCount++;
                    const percent = Math.round((completedCount / total) * 100);
                    updateProgress(percent, `Descargando: ${completedCount}/${total} completadas`);
                }
            };

            // Queue runner
            const runQueue = async () => {
                const promises = [];

                while (queueIndex < total) {
                    if (activeCount < CONCURRENCY_LIMIT) {
                        // Start new task
                        const video = selectedVideos[queueIndex];
                        const index = queueIndex;
                        queueIndex++;
                        activeCount++;

                        const p = processVideo(video, index).then(() => {
                            activeCount--;
                        });
                        promises.push(p);
                    } else {
                        // Wait for a slot
                        await Promise.race(promises.filter(p => p.status !== 'fulfilled')); // Simplified wait
                        // Actually regular Promise.race works on the active promises
                        // For simplicity in vanilla JS without external queue lib:
                        await new Promise(r => setTimeout(r, 500));
                    }
                }

                // Wait for remaining
                await Promise.all(promises);
            };

            await runQueue();

            hideProgress();

            if (errors.length > 0) {
                showStatus(`Completado con ${errors.length} errores.`, 'warning');
            } else {
                showStatus(i18n.t('download_complete'), 'success');
                showSuccessAnimation();
            }

        } catch (error) {
            console.error('Mobile parallel batch error:', error);
            showStatus('Error en la descarga paralela.', 'error');
            hideProgress();
        } finally {
            setLoading(false);
        }
        return; // Stop here, don't do ZIP logic
    }

    // Multiple songs: use batch download (will be packaged as ZIP)
    try {
        updateProgress(5, i18n.t('initializing'));

        const quality = qualitySelect.value;
        const startResponse = await fetch(`${API_URL}/api/start-batch-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ videos: selectedVideos, quality }),
        });

        if (!startResponse.ok) {
            const errorData = await startResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al iniciar la descarga');
        }

        const { download_id } = await startResponse.json();

        // Add to visual queue manager for batch download
        if (typeof queueManager !== 'undefined') {
            const batchInfo = {
                id: download_id,
                title: `Descargando ${total} canciones...`,
                thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
                channel: 'Playlist'
            };
            queueManager.add(download_id, batchInfo);
        }

        // Poll for progress
        const finalProgressData = await pollProgress(download_id, total);

        // Check if download was cancelled - skip everything if so
        if (finalProgressData.cancelled) {
            hideProgress();
            setLoading(false);
            showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
            return; // Exit early, don't download or save to history
        }

        // Download the ZIP file
        updateProgress(100, '¡Descarga completada!');

        setTimeout(() => {
            window.location.href = `${API_URL}/api/download/${download_id}`;

            showSuccessAnimation();
            setTimeout(() => {
                hideProgress();
                showStatus(i18n.t('zip_complete', { n: total }), 'success');
            }, 1000);
        }, 300);

        // Add all downloaded videos to history
        selectedVideos.forEach(video => {
            addToHistory({
                id: video.id,
                title: video.title,
                thumbnail: video.thumbnail,
                channel: video.channel,
                url: video.url,
                duration: video.duration
            });
        });

    } catch (error) {
        console.error('Batch download error:', error);
        hideProgress();
        showStatus(error.message || 'Error al descargar. Inténtalo de nuevo', 'error');
    } finally {
        setLoading(false);
    }
}

// Playlist selector button event listeners
if (selectAllBtn) selectAllBtn.addEventListener('click', selectAllPlaylistItems);
if (deselectAllBtn) deselectAllBtn.addEventListener('click', deselectAllPlaylistItems);
if (downloadSelectedBtn) downloadSelectedBtn.addEventListener('click', downloadSelectedPlaylistVideos);

// Favorites selection button event listeners
if (favSelectAllBtn) favSelectAllBtn.addEventListener('click', selectAllFavorites);
if (favDeselectAllBtn) favDeselectAllBtn.addEventListener('click', deselectAllFavorites);
if (downloadFavoritesBtn) downloadFavoritesBtn.addEventListener('click', downloadSelectedFavorites);

// ========================================
// Download History
// ========================================

function getDownloadHistory() {
    // If logged in, use server cache
    if (auth.isLoggedIn() && auth._serverHistoryCache) {
        return auth._serverHistoryCache;
    }
    // Fallback to localStorage
    try {
        const history = localStorage.getItem(HISTORY_STORAGE_KEY);
        return history ? JSON.parse(history) : [];
    } catch (e) {
        console.error('Error reading history:', e);
        return [];
    }
}

function saveDownloadHistory(history) {
    // Always save to localStorage as backup
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Error saving history:', e);
    }
}

function addToHistory(video) {
    const entry = {
        id: video.id || extractVideoId(video.url),
        title: video.title,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id || extractVideoId(video.url)}/mqdefault.jpg`,
        channel: video.channel || 'Desconocido',
        url: video.url,
        downloadedAt: new Date().toISOString()
    };

    // If logged in, save to server
    if (auth.isLoggedIn()) {
        fetch(`${API_URL}/api/user/history`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...auth.getAuthHeaders()
            },
            body: JSON.stringify(entry)
        }).then(res => {
            if (res.ok) {
                // Refresh server cache
                return fetch(`${API_URL}/api/user/history`, { headers: auth.getAuthHeaders() });
            }
        }).then(res => res && res.ok ? res.json() : null).then(data => {
            if (data) {
                auth._serverHistoryCache = data.history;
                renderHistory();
            }
        }).catch(e => console.error('Server history save error:', e));
    }

    // Always also save to localStorage
    const history = getDownloadHistory();
    const filteredHistory = history.filter(item => item.id !== entry.id);
    filteredHistory.unshift(entry);
    const trimmedHistory = filteredHistory.slice(0, HISTORY_MAX_ITEMS);
    saveDownloadHistory(trimmedHistory);
    renderHistory();
}

function updateHistoryItem(videoId, newData) {
    const history = getDownloadHistory();
    const index = history.findIndex(item => item.id === videoId);

    if (index !== -1) {
        // Update fields if provided
        if (newData.title) history[index].title = newData.title;
        if (newData.thumbnail) history[index].thumbnail = newData.thumbnail;

        saveDownloadHistory(history);
        renderHistory();
    }
}

function clearHistory() {
    if (confirm('¿Estás seguro de que quieres limpiar el historial?')) {
        localStorage.removeItem(HISTORY_STORAGE_KEY);

        // If logged in, also clear on server
        if (auth.isLoggedIn()) {
            fetch(`${API_URL}/api/user/history`, {
                method: 'DELETE',
                headers: auth.getAuthHeaders()
            }).then(() => {
                auth._serverHistoryCache = [];
                renderHistory();
            }).catch(e => console.error('Server history clear error:', e));
        }

        renderHistory();
    }
}

function renderHistory() {
    const history = getDownloadHistory();
    historyCount.textContent = history.length;

    if (history.length === 0) {
        historyList.innerHTML = '<p class="history-empty">No hay descargas recientes</p>';
        return;
    }

    historyList.innerHTML = '';

    history.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        const date = new Date(item.downloadedAt);
        const dateStr = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });

        const isFav = isFavorite(item.id);
        const heartClass = isFav ? 'active' : '';
        const heartFill = isFav ? 'currentColor' : 'none';

        div.innerHTML = `
            <button class="favorite-btn ${heartClass}" data-id="${item.id}" title="${isFav ? 'Quitar de favoritos' : 'Añadir a favoritos'}">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="${heartFill}">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                    <span class="history-date">${dateStr}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar de nuevo">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Favorite button click handler
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(item, favBtn);
        });

        // Re-download button click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            urlInput.value = item.url;
            downloadFromUrl(item.url);
        });

        // Click on item to fill URL
        div.addEventListener('click', () => {
            urlInput.value = item.url;
            urlInput.focus();
        });

        historyList.appendChild(div);
    });
}

function toggleHistory() {
    historyToggle.classList.toggle('open');
    historyContent.classList.toggle('hidden');
}

// History event listeners
if (historyToggle) historyToggle.addEventListener('click', toggleHistory);
if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', clearHistory);

// ========================================
// Favorites Management
// ========================================

function getFavorites() {
    // If logged in, use server cache
    if (auth.isLoggedIn() && auth._serverFavoritesCache) {
        return auth._serverFavoritesCache;
    }
    // Fallback to localStorage
    try {
        const favorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
        return favorites ? JSON.parse(favorites) : [];
    } catch (e) {
        console.error('Error reading favorites:', e);
        return [];
    }
}

function saveFavorites(favorites) {
    // Always save to localStorage as backup
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch (e) {
        console.error('Error saving favorites:', e);
    }
}

function updateFavoriteItem(videoId, newData) {
    const favorites = getFavorites();
    const index = favorites.findIndex(item => item.id === videoId);

    if (index !== -1) {
        // Update fields if provided
        if (newData.title) favorites[index].title = newData.title;
        if (newData.thumbnail) favorites[index].thumbnail = newData.thumbnail;

        saveFavorites(favorites);
        renderFavorites();
    }
}

function isFavorite(videoId) {
    const favorites = getFavorites();
    // Use loose comparison for ID vs string
    return favorites.some(item => item.id == videoId);
}

function toggleFavorite(video, btnElement) {
    const favorites = getFavorites();
    const videoId = video.id || extractVideoId(video.url);
    const existingIndex = favorites.findIndex(item => item.id == videoId);

    if (existingIndex >= 0) {
        // Remove
        favorites.splice(existingIndex, 1);
        if (btnElement) {
            btnElement.classList.remove('active');
            btnElement.title = "Añadir a favoritos";
            btnElement.querySelector('svg').style.fill = 'none';
        }
        showStatus('Eliminado de favoritos', 'info');

        // If logged in, remove on server
        if (auth.isLoggedIn()) {
            fetch(`${API_URL}/api/user/favorites/${videoId}`, {
                method: 'DELETE',
                headers: auth.getAuthHeaders()
            }).then(res => {
                if (res.ok) return fetch(`${API_URL}/api/user/favorites`, { headers: auth.getAuthHeaders() });
            }).then(res => res && res.ok ? res.json() : null).then(data => {
                if (data) {
                    auth._serverFavoritesCache = data.favorites;
                    renderFavorites();
                }
            }).catch(e => console.error('Server favorite remove error:', e));
        }
    } else {
        // Add
        const entry = {
            id: videoId,
            title: video.title,
            thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
            channel: video.channel || 'Desconocido',
            url: video.url || `https://www.youtube.com/watch?v=${videoId}`,
            addedAt: new Date().toISOString(),
            duration: video.duration
        };
        favorites.unshift(entry);
        if (btnElement) {
            btnElement.classList.add('active');
            btnElement.title = "Quitar de favoritos";
            btnElement.querySelector('svg').style.fill = 'currentColor';
        }
        showStatus('Añadido a favoritos', 'success');

        // If logged in, add on server
        if (auth.isLoggedIn()) {
            fetch(`${API_URL}/api/user/favorites`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...auth.getAuthHeaders()
                },
                body: JSON.stringify(entry)
            }).then(res => {
                if (res.ok) return fetch(`${API_URL}/api/user/favorites`, { headers: auth.getAuthHeaders() });
            }).then(res => res && res.ok ? res.json() : null).then(data => {
                if (data) {
                    auth._serverFavoritesCache = data.favorites;
                    renderFavorites();
                }
            }).catch(e => console.error('Server favorite add error:', e));
        }
    }

    saveFavorites(favorites);
    renderFavorites();

    // Also update any other instances of this video's button on the page
    document.querySelectorAll(`.favorite-btn[data-id="${videoId}"]`).forEach(btn => {
        if (btn !== btnElement) {
            const isFav = existingIndex < 0;
            btn.classList.toggle('active', isFav);
            btn.title = isFav ? "Quitar de favoritos" : "Añadir a favoritos";
            btn.querySelector('svg').style.fill = isFav ? 'currentColor' : 'none';
        }
    });
}

function renderFavorites() {
    const favorites = getFavorites();
    favoritesCount.textContent = favorites.length;

    if (favorites.length === 0) {
        favoritesList.innerHTML = '<p class="history-empty">No tienes favoritos aún</p>';
        if (downloadFavoritesBtn) downloadFavoritesBtn.disabled = true;
        if (favSelectedCount) favSelectedCount.textContent = '0';
        return;
    }

    favoritesList.innerHTML = '';

    favorites.forEach((item, index) => {
        const div = document.createElement('div');
        div.className = 'history-item';

        div.innerHTML = `
            <input type="checkbox" class="fav-checkbox playlist-checkbox" data-index="${index}" checked>
            <button class="favorite-btn active" data-id="${item.id}" title="Quitar de favoritos">
                <svg viewBox="0 0 24 24" stroke="currentColor" fill="currentColor">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
                </svg>
            </button>
            <img class="history-thumbnail" src="${item.thumbnail}" alt="${item.title}" loading="lazy">
            <div class="history-info">
                <div class="history-title">${item.title}</div>
                <div class="history-meta">
                    <span class="history-channel">${item.channel}</span>
                </div>
            </div>
            <button class="history-download-btn" title="Descargar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7,10 12,15 17,10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
            </button>
        `;

        // Checkbox change
        const checkbox = div.querySelector('.fav-checkbox');
        checkbox.addEventListener('change', () => {
            div.classList.toggle('selected', checkbox.checked);
            updateFavSelectedCount();
        });
        div.classList.add('selected');

        // Unfavorite click
        const favBtn = div.querySelector('.favorite-btn');
        favBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(item, favBtn);
        });

        // Download click
        const downloadBtn = div.querySelector('.history-download-btn');
        downloadBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            urlInput.value = item.url;
            downloadFromUrl(item.url);
        });

        // Item click (load URL)
        div.addEventListener('click', (e) => {
            if (!e.target.closest('button') && !e.target.closest('input')) {
                urlInput.value = item.url;
                urlInput.focus();
            }
        });

        favoritesList.appendChild(div);
    });

    updateFavSelectedCount();
}

function updateFavSelectedCount() {
    const checked = favoritesList.querySelectorAll('.fav-checkbox:checked').length;
    if (favSelectedCount) favSelectedCount.textContent = checked;
    if (downloadFavoritesBtn) downloadFavoritesBtn.disabled = checked === 0;
}

function selectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.add('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = true;
    });
    updateFavSelectedCount();
}

function deselectAllFavorites() {
    const items = favoritesList.querySelectorAll('.history-item');
    items.forEach(item => {
        item.classList.remove('selected');
        const cb = item.querySelector('.fav-checkbox');
        if (cb) cb.checked = false;
    });
    updateFavSelectedCount();
}

async function downloadSelectedFavorites() {
    const favorites = getFavorites();
    const checkboxes = favoritesList.querySelectorAll('.fav-checkbox:checked');
    const selectedVideos = Array.from(checkboxes).map(cb => {
        const index = parseInt(cb.dataset.index);
        return favorites[index];
    }).filter(Boolean);

    if (selectedVideos.length === 0) {
        showStatus(i18n.t('select_at_least_one') || 'Selecciona al menos una canción', 'error');
        return;
    }

    setLoading(true);
    showProgress();

    const total = selectedVideos.length;

    // Single song: use regular download
    if (total === 1) {
        const video = selectedVideos[0];
        urlInput.value = video.url;
        await downloadFromUrl(video.url, video);
        return;
    }

    // Multiple songs: batch download
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    if (isMobile && total > 2) {
        // Mobile: download individually
        try {
            const CONCURRENCY_LIMIT = 5;
            let activeCount = 0;
            let completedCount = 0;
            let queueIndex = 0;
            const errors = [];

            updateProgress(5, `Iniciando descarga (${total} canciones)...`);

            await new Promise((resolve) => {
                function processNext() {
                    while (activeCount < CONCURRENCY_LIMIT && queueIndex < total) {
                        const video = selectedVideos[queueIndex++];
                        activeCount++;
                        downloadFromUrl(video.url, video)
                            .catch(err => errors.push(video.title))
                            .finally(() => {
                                activeCount--;
                                completedCount++;
                                const percent = Math.round((completedCount / total) * 100);
                                updateProgress(percent, `Descargando: ${completedCount}/${total} (${percent}%)`);
                                if (completedCount === total) resolve();
                                else processNext();
                            });
                    }
                }
                processNext();
            });

            setLoading(false);
            hideProgress();
            if (errors.length > 0) {
                showStatus(`Completado con ${errors.length} error(es)`, 'error');
            } else {
                showStatus(`¡${total} canciones descargadas!`, 'success');
            }
        } catch (error) {
            setLoading(false);
            hideProgress();
            showStatus('Error en la descarga', 'error');
        }
    } else {
        // Desktop: batch download (ZIP)
        try {
            updateProgress(5, i18n.t('initializing') || 'Iniciando descarga...');

            const quality = qualitySelect.value;
            const startResponse = await fetch(`${API_URL}/api/start-batch-download`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ videos: selectedVideos, quality })
            });

            if (!startResponse.ok) {
                const errorData = await startResponse.json().catch(() => ({}));
                throw new Error(errorData.error || 'Error al iniciar la descarga');
            }

            const { download_id } = await startResponse.json();

            // Add to visual queue manager
            if (typeof queueManager !== 'undefined') {
                const batchInfo = {
                    id: download_id,
                    title: `Descargando ${total} canciones...`,
                    thumbnail: selectedVideos[0]?.thumbnail || 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png',
                    channel: 'Favoritos'
                };
                queueManager.add(download_id, batchInfo);
            }

            // Poll for progress
            const finalProgressData = await pollProgress(download_id, total);

            if (finalProgressData.cancelled) {
                hideProgress();
                setLoading(false);
                showStatus(i18n.t('cancelling') || 'Descarga cancelada', 'info');
                return;
            }

            updateProgress(100, '¡Descarga completada!');

            setTimeout(() => {
                window.location.href = `${API_URL}/api/download/${download_id}`;
                showSuccessAnimation();
                setTimeout(() => {
                    hideProgress();
                    showStatus(i18n.t('zip_complete', { n: total }) || `¡${total} canciones descargadas!`, 'success');
                }, 1000);
            }, 300);

            // Add all to history
            selectedVideos.forEach(video => {
                addToHistory({
                    id: video.id,
                    title: video.title,
                    thumbnail: video.thumbnail,
                    channel: video.channel,
                    url: video.url,
                    duration: video.duration
                });
            });

        } catch (error) {
            console.error('Favorites batch download error:', error);
            hideProgress();
            setLoading(false);
            showStatus(error.message || 'Error en la descarga', 'error');
        }
    }
}

function toggleFavorites() {
    favoritesToggle.classList.toggle('open');
    favoritesContent.classList.toggle('hidden');
}

// Favorites event listeners
if (favoritesToggle) favoritesToggle.addEventListener('click', toggleFavorites);

// ========================================
// Theme Toggle
// ========================================

function getPreferredTheme() {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) return savedTheme;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function initTheme() {
    const theme = getPreferredTheme();
    setTheme(theme);
}

// Theme toggle click handler
themeToggle.addEventListener('click', toggleTheme);

// ========================================
// Audio Preview (YouTube IFrame API)
// ========================================

let ytPlayer = null;
let ytPlayerReady = false;
let currentPreviewId = null;
let currentThumbnailWrapper = null;

// Called automatically by YouTube IFrame API when ready
function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API loaded, creating player...');
    ytPlayer = new YT.Player('youtubePlayer', {
        height: '1',
        width: '1',
        playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            origin: window.location.origin // standard practice for API security
        },
        events: {
            onReady: onPlayerReady,
            onStateChange: onPlayerStateChange,
            onError: onPlayerError
        }
    });
}

function onPlayerReady(event) {
    console.log('YouTube Player is ready!');
    ytPlayerReady = true;
}

function onPlayerError(event) {
    console.error('YouTube Player error:', event.data);
    let message = i18n.t('preview_error_generic');

    // Error codes: https://developers.google.com/youtube/iframe_api_reference#onError
    if (event.data === 150 || event.data === 101) {
        message = i18n.t('preview_error_restricted');
    } else if (event.data === 100) {
        message = i18n.t('preview_error_not_found');
    }

    showStatus(message, 'error');
    stopPreview(); // Reset UI
}

// Make it globally available
window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;

function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === 0) {
        stopPreview();
    }
}

function togglePreview(videoId, thumbnailWrapper) {
    console.log('togglePreview called with videoId:', videoId);

    if (!ytPlayerReady || !ytPlayer || !ytPlayer.loadVideoById) {
        console.warn('YouTube player not ready yet. ytPlayerReady:', ytPlayerReady);
        showStatus('Espera un momento, el reproductor se está cargando...', 'info');
        return;
    }

    if (!videoId) {
        console.error('No video ID provided');
        return;
    }

    // If same video is playing, pause it
    if (currentPreviewId === videoId) {
        stopPreview();
        return;
    }

    // Stop any current preview
    if (currentPreviewId) {
        stopPreview();
    }

    // Start new preview
    currentPreviewId = videoId;
    currentThumbnailWrapper = thumbnailWrapper;

    ytPlayer.loadVideoById(videoId);
    ytPlayer.unMute(); // Ensure audio is on
    ytPlayer.setVolume(100); // Max volume
    ytPlayer.playVideo();

    updatePlayingUI(thumbnailWrapper, true);
}

function stopPreview() {
    if (ytPlayer && ytPlayer.stopVideo) {
        ytPlayer.stopVideo();
    }

    if (currentThumbnailWrapper) {
        updatePlayingUI(currentThumbnailWrapper, false);
    }

    currentPreviewId = null;
    currentThumbnailWrapper = null;
}

function updatePlayingUI(wrapper, isPlaying) {
    if (!wrapper) return;

    const musicIcon = wrapper.querySelector('.music-icon');
    const pauseIcon = wrapper.querySelector('.pause-icon');

    if (isPlaying) {
        wrapper.classList.add('playing');
        if (musicIcon) musicIcon.style.display = 'none';
        if (pauseIcon) pauseIcon.style.display = 'block';
    } else {
        wrapper.classList.remove('playing');
        if (musicIcon) musicIcon.style.display = 'block';
        if (pauseIcon) pauseIcon.style.display = 'none';
    }
}

// ========================================
// Animations
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    renderHistory();
    renderFavorites();
    auth.init();  // Check session and load server data if logged in
    setTimeout(() => urlInput.focus(), 600);
});

// ========================================
// Success Animations
// ========================================

const CONFETTI_COLORS = ['#FF0000', '#ff3333', '#ff6666', '#2ed573', '#ffa502', '#ff6b81', '#70a1ff', '#7bed9f'];

function createConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    // Create 50 confetti pieces
    for (let i = 0; i < 50; i++) {
        const piece = document.createElement('div');
        piece.className = `confetti-piece ${Math.random() > 0.5 ? 'circle' : 'square'}`;

        // Random position
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.top = '-10px';

        // Random color
        piece.style.backgroundColor = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

        // Random size
        const size = 5 + Math.random() * 10;
        piece.style.width = `${size}px`;
        piece.style.height = `${size}px`;

        // Random animation delay and duration
        piece.style.animationDelay = `${Math.random() * 0.5}s`;
        piece.style.animationDuration = `${2 + Math.random() * 2}s`;

        container.appendChild(piece);
    }

    // Cleanup after animation
    setTimeout(() => container.remove(), 4000);
}

function showSuccessAnimation() {
    createConfetti();

    // Add a glow effect to container
    const card = document.querySelector('.card');
    card.style.boxShadow = '0 0 50px var(--success-color)';
    card.style.borderColor = 'var(--success-color)';

    setTimeout(() => {
        card.style.boxShadow = '';
        card.style.borderColor = '';
    }, 1000);
}

// ========================================
// Queue Manager (Visual Panel)
// ========================================
const queuePanel = document.getElementById('queuePanel');
const activeDownloadsContainer = document.getElementById('activeDownloads');
const pendingQueueContainer = document.getElementById('pendingQueue');

class QueueManager {
    constructor() {
        this.items = new Map(); // id -> { data, element, status }
        this.activeIds = [];    // List of IDs currently shown as active
        this.pendingIds = [];   // List of IDs in the stack

        this.MAX_ACTIVE_DISPLAY = 3; // Show max 3 active cards individually
    }

    add(id, videoInfo) {
        // Show panel if hidden
        queuePanel.classList.remove('hidden');

        const item = {
            id,
            info: videoInfo,
            status: 'starting',
            percent: 0,
            element: this.createCard(videoInfo, id)
        };

        this.items.set(id, item);

        // Add cancel button event listener
        const cancelBtn = item.element.querySelector('.q-cancel-btn');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.cancel(id);
            });
        }

        // Decide placement
        if (this.activeIds.length < this.MAX_ACTIVE_DISPLAY) {
            this.activeIds.push(id);
            activeDownloadsContainer.appendChild(item.element);
            item.element.classList.add('entering');
        } else {
            this.pendingIds.push(id);
            pendingQueueContainer.appendChild(item.element);
            item.element.classList.add('pending');
            this.updateStackVisuals();
        }
    }

    update(id, percent, message, extras) {
        const item = this.items.get(id);
        if (!item) return;

        item.percent = percent;

        // Update DOM
        const bar = item.element.querySelector('.q-progress-fill');
        const status = item.element.querySelector('.q-status');
        const titleEl = item.element.querySelector('.q-title');
        const thumbEl = item.element.querySelector('.q-thumb');

        if (bar) bar.style.width = `${percent}%`;

        if (status) {
            if (message && message.includes('Procesando')) {
                status.textContent = message; // "Procesando: 1/10"
            } else {
                status.textContent = i18n.t('downloading');
            }
        }

        // Update metadata if available (e.g. from server pre-fetch)
        if (extras) {
            if (extras.title && titleEl) {
                titleEl.textContent = extras.title;
            }
            if (extras.thumbnail && thumbEl) {
                thumbEl.src = extras.thumbnail;
            }
        }
    }

    complete(id) {
        const item = this.items.get(id);
        if (!item) return;

        // Turn green
        const bar = item.element.querySelector('.q-progress-fill');
        const status = item.element.querySelector('.q-status');

        if (bar) bar.classList.add('completed');
        if (status) status.textContent = i18n.t('download_complete');

        // Remove after delay
        setTimeout(() => {
            item.element.classList.add('leaving');

            setTimeout(() => {
                this.remove(id);
            }, 400); // Wait for animation
        }, 1500); // Show green for 1.5s
    }

    async cancel(id) {
        const item = this.items.get(id);
        if (!item) return;

        // Show cancelling status on UI
        const status = item.element.querySelector('.q-status');
        if (status) status.textContent = i18n.t('cancelling') || 'Cancelando...';

        // Disable the cancel button to prevent double-clicks
        const cancelBtn = item.element.querySelector('.q-cancel-btn');
        if (cancelBtn) cancelBtn.disabled = true;

        try {
            const response = await fetch(`${API_URL}/api/cancel/${id}`, {
                method: 'POST'
            });

            if (response.ok) {
                // Animate removal
                item.element.classList.add('cancelled');
                setTimeout(() => {
                    this.remove(id);
                }, 300);
            } else {
                // If cancel failed, restore status
                if (status) status.textContent = i18n.t('error_download');
                if (cancelBtn) cancelBtn.disabled = false;
            }
        } catch (error) {
            console.error('Cancel error:', error);
            if (status) status.textContent = i18n.t('error_download');
            if (cancelBtn) cancelBtn.disabled = false;
        }
    }

    remove(id) {
        const item = this.items.get(id);
        if (item && item.element) {
            item.element.remove();
        }

        this.items.delete(id);
        this.activeIds = this.activeIds.filter(i => i !== id);
        this.pendingIds = this.pendingIds.filter(i => i !== id);

        // Hide panel if empty
        if (this.items.size === 0) {
            setTimeout(() => {
                if (this.items.size === 0) queuePanel.classList.add('hidden');
            }, 500);
        } else {
            // Promote pending to active if slot available
            this.promoteNext();
        }
    }

    promoteNext() {
        if (this.activeIds.length < this.MAX_ACTIVE_DISPLAY && this.pendingIds.length > 0) {
            const nextId = this.pendingIds.shift();
            this.activeIds.push(nextId);
            const item = this.items.get(nextId);

            if (item) {
                // Determine start and end positions for animation
                // We want it to "fly" from stack to active list

                // 1. Remove style from pending
                item.element.classList.remove('pending', 'p-1', 'p-2', 'p-3', 'hidden-stack');
                item.element.style.transform = '';
                item.element.style.opacity = '';

                // 2. Move to active container
                activeDownloadsContainer.appendChild(item.element);

                // 3. Animate entry (slide up)
                item.element.animate([
                    { transform: 'translateY(20px) scale(0.9)', opacity: 0.8 },
                    { transform: 'translateY(0) scale(1)', opacity: 1 }
                ], {
                    duration: 400,
                    easing: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                });
            }

            this.updateStackVisuals();
        }
    }

    updateStackVisuals() {
        this.pendingIds.forEach((id, index) => {
            const item = this.items.get(id);
            if (!item) return;

            // Reset classes
            item.element.classList.remove('p-1', 'p-2', 'p-3', 'hidden-stack');

            if (index === 0) item.element.classList.add('p-1');
            else if (index === 1) item.element.classList.add('p-2');
            else if (index === 2) item.element.classList.add('p-3');
            else item.element.classList.add('hidden-stack');
        });
    }

    createCard(info, downloadId) {
        const div = document.createElement('div');
        div.className = 'queue-card';
        div.dataset.downloadId = downloadId;
        div.innerHTML = `
            <div class="q-header">
                <img src="${info.thumbnail || 'placeholder.jpg'}" class="q-thumb" alt="">
                <div class="q-info">
                    <div class="q-title">${info.title || i18n.t('initializing')}</div>
                    <div class="q-status">${i18n.t('loading')}</div>
                </div>
                <button class="q-cancel-btn" title="${i18n.t('cancel_download') || 'Cancelar'}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
            <div class="q-progress-bg">
                <div class="q-progress-fill"></div>
            </div>
        `;
        return div;
    }
}

const queueManager = new QueueManager();

document.addEventListener('mousemove', (e) => {
    const glow = document.querySelector('.background-glow');
    if (glow) {
        const moveX = (e.clientX - window.innerWidth / 2) * 0.02;
        const moveY = (e.clientY - window.innerHeight / 2) * 0.02;
        glow.style.transform = `translate(calc(-50% + ${moveX}px), calc(-50% + ${moveY}px))`;
    }
});
