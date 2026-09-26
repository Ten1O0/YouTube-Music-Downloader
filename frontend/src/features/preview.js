/**
 * Vista previa de un resultado con el reproductor de YouTube.
 */

import { i18n } from '../i18n/language-manager.js';
import { showStatus } from '../ui/status.js';

// ========================================
// Audio Preview (YouTube IFrame API)
// ========================================
let ytPlayer = null;

let ytPlayerReady = false;

let currentPreviewId = null;

let currentThumbnailWrapper = null;

// Called automatically by YouTube IFrame API when ready
export function onYouTubeIframeAPIReady() {
    console.log('YouTube IFrame API loaded, creating player...');
    ytPlayer = new globalThis.YT.Player('youtubePlayer', {
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

function onPlayerStateChange(event) {
    // YT.PlayerState.ENDED = 0
    if (event.data === 0) {
        stopPreview();
    }
}

export function togglePreview(videoId, thumbnailWrapper) {
    console.log('togglePreview called with videoId:', videoId);

    if (!ytPlayerReady || !ytPlayer?.loadVideoById) {
        console.warn('YouTube player not ready yet. ytPlayerReady:', ytPlayerReady);
        showStatus(i18n.t('player_loading'), 'info');
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

export function stopPreview() {
    if (ytPlayer?.stopVideo) {
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

/** La API del iframe de YouTube avisa llamando a esta función global. */
export function initVistaPrevia() {
    window.onYouTubeIframeAPIReady = onYouTubeIframeAPIReady;
}
