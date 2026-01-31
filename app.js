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
const API_URL = ''; // Relative path for production/ngrok support
const YOUTUBE_URL_PATTERN = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+/;
const HISTORY_MAX_ITEMS = 50;
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
        quality_max: '320kbps (Máxima)'
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
        quality_max: '320kbps (Max)'
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
        quality_max: '320kbps (Max)'
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
        quality_max: '320kbps (Max)'
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
        quality_max: '320kbps (Máxima)'
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
        quality_max: '320kbps (最大)'
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
                        queueManager.update(downloadId, qPercent, data.message || i18n.t('downloading'));
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
                    resolve(data);
                } else if (data.status === 'error') {
                    clearInterval(pollInterval);
                    if (typeof queueManager !== 'undefined') queueManager.remove(downloadId); // Remove if error
                    reject(new Error(data.message));
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

        const { download_id, total } = await startResponse.json();

        // Add to visual queue manager
        if (typeof queueManager !== 'undefined' && videoInfo) {
            queueManager.add(download_id, videoInfo);
        }

        if (!isBackground) {
            updateProgress(10, total > 1
                ? `Preparando descarga de ${total} canciones...`
                : 'Descargando...');
        }

        // Step 2: Poll for progress
        // We poll even in background, though UI updates might be invisible
        await pollProgress(download_id, total);

        // Step 3: Download the file
        if (!isBackground) updateProgress(95, 'Descargando archivo...');

        const downloadResponse = await fetch(`${API_URL}/api/download/${download_id}`);

        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al descargar el archivo');
        }

        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let filename = 'youtube-download.mp3';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) {
                filename = decodeURIComponent(match[1]);
            }
        }

        const blob = await downloadResponse.blob();

        if (!isBackground) updateProgress(100, '¡Descarga completada!');

        downloadBlob(blob, filename);

        // Add to history
        const videoId = extractVideoId(url);
        const historyEntry = videoInfo || {
            id: videoId,
            title: filename.replace(/\.(mp3|zip)$/i, ''),
            url: url,
            channel: 'YouTube'
        };
        if (total === 1) {  // Only add single downloads to history
            addToHistory(historyEntry);
        }

        if (!isBackground) {
            showSuccessAnimation();
            setTimeout(() => {
                showStatus('¡Descarga completada! Revisa tu carpeta de descargas', 'success');
                hideProgress();
            }, 500);
        } else {
            showStatus(`¡Descargado! ${videoInfo?.title || filename}`, 'success');
            if (uiElements?.item) {
                uiElements.item.style.opacity = '1';
                uiElements.item.style.pointerEvents = 'auto';
                uiElements.item.style.borderColor = 'var(--success-color)';
                // Visual checkmark or effect could end here
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

        // Poll for progress
        await pollProgress(download_id, total);

        // Download the ZIP file
        updateProgress(95, i18n.t('downloading_zip'));

        const downloadResponse = await fetch(`${API_URL}/api/download/${download_id}`);

        if (!downloadResponse.ok) {
            const errorData = await downloadResponse.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al descargar el archivo');
        }

        const contentDisposition = downloadResponse.headers.get('Content-Disposition');
        let filename = 'playlist_canciones.zip';
        if (contentDisposition) {
            const match = contentDisposition.match(/filename="?([^"]+)"?/);
            if (match) filename = decodeURIComponent(match[1]);
        }

        const blob = await downloadResponse.blob();
        updateProgress(100, '¡Descarga completada!');
        downloadBlob(blob, filename);

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

        showSuccessAnimation();

        setTimeout(() => {
            hideProgress();
            showStatus(i18n.t('zip_complete', { n: total }), 'success');
        }, 500);

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

// ========================================
// Download History
// ========================================

function getDownloadHistory() {
    try {
        const history = localStorage.getItem(HISTORY_STORAGE_KEY);
        return history ? JSON.parse(history) : [];
    } catch (e) {
        console.error('Error reading history:', e);
        return [];
    }
}

function saveDownloadHistory(history) {
    try {
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (e) {
        console.error('Error saving history:', e);
    }
}

function addToHistory(video) {
    const history = getDownloadHistory();

    // Create history entry
    const entry = {
        id: video.id || extractVideoId(video.url),
        title: video.title,
        thumbnail: video.thumbnail || `https://i.ytimg.com/vi/${video.id || extractVideoId(video.url)}/mqdefault.jpg`,
        channel: video.channel || 'Desconocido',
        url: video.url,
        downloadedAt: new Date().toISOString()
    };

    // Remove duplicate if exists
    const filteredHistory = history.filter(item => item.id !== entry.id);

    // Add new entry at the beginning
    filteredHistory.unshift(entry);

    // Limit to max items
    const trimmedHistory = filteredHistory.slice(0, HISTORY_MAX_ITEMS);

    saveDownloadHistory(trimmedHistory);
    renderHistory();
}

function clearHistory() {
    if (confirm('¿Estás seguro de que quieres limpiar el historial?')) {
        localStorage.removeItem(HISTORY_STORAGE_KEY);
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
    try {
        const favorites = localStorage.getItem(FAVORITES_STORAGE_KEY);
        return favorites ? JSON.parse(favorites) : [];
    } catch (e) {
        console.error('Error reading favorites:', e);
        return [];
    }
}

function saveFavorites(favorites) {
    try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favorites));
    } catch (e) {
        console.error('Error saving favorites:', e);
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
    }

    saveFavorites(favorites);
    renderFavorites();

    // Also update any other instances of this video's button on the page
    document.querySelectorAll(`.favorite-btn[data-id="${videoId}"]`).forEach(btn => {
        if (btn !== btnElement) {
            const isFav = existingIndex < 0; // If index was < 0, we just added it
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
        return;
    }

    favoritesList.innerHTML = '';

    favorites.forEach(item => {
        const div = document.createElement('div');
        div.className = 'history-item';

        div.innerHTML = `
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
            if (!e.target.closest('button')) {
                urlInput.value = item.url;
                urlInput.focus();
            }
        });

        favoritesList.appendChild(div);
    });
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
            rel: 0
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
            element: this.createCard(videoInfo)
        };

        this.items.set(id, item);

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

    update(id, percent, message) {
        const item = this.items.get(id);
        if (!item) return;

        item.percent = percent;

        // Update DOM
        const bar = item.element.querySelector('.q-progress-fill');
        const status = item.element.querySelector('.q-status');

        if (bar) bar.style.width = `${percent}%`;

        if (status) {
            if (message && message.includes('Procesando')) {
                status.textContent = message; // "Procesando: 1/10"
            } else {
                status.textContent = i18n.t('downloading');
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

    createCard(info) {
        const div = document.createElement('div');
        div.className = 'queue-card';
        div.innerHTML = `
            <div class="q-header">
                <img src="${info.thumbnail || 'placeholder.jpg'}" class="q-thumb" alt="">
                <div class="q-info">
                    <div class="q-title">${info.title || i18n.t('initializing')}</div>
                    <div class="q-status">${i18n.t('loading')}</div>
                </div>
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
