/**
 * Las barras de posición y de volumen, y el botón de silencio. Las del mini
 * reproductor y las de la pantalla completa se mueven a la par.
 */

export function initBarras(audio) {
    const playerSeek = document.getElementById('playerSeek');
    const playerSeekFill = document.getElementById('playerSeekFill');
    const playerVolume = document.getElementById('playerVolume');
    const playerVolumeFill = document.getElementById('playerVolumeFill');
    const playerMuteBtn = document.getElementById('playerMuteBtn');
    const fullPlayerSeek = document.getElementById('fullPlayerSeek');
    const fullPlayerSeekFill = document.getElementById('fullPlayerSeekFill');
    const fullPlayerVolume = document.getElementById('fullPlayerVolume');
    const fullPlayerVolumeFill = document.getElementById('fullPlayerVolumeFill');
    const fullPlayerMuteBtn = document.getElementById('fullPlayerMuteBtn');

    let isMuted = false;
    let prevVolume = 1;

    function updateVolumeBar(val) {
        if (playerVolumeFill) playerVolumeFill.style.width = val + '%';
        if (playerVolume) playerVolume.value = val;
        if (fullPlayerVolumeFill) fullPlayerVolumeFill.style.width = val + '%';
        if (fullPlayerVolume) fullPlayerVolume.value = val;
    }

    const handleSeekInput = (el) => {
        if (!audio.duration) return;
        const newTime = (el.value / 100) * audio.duration;
        audio.currentTime = newTime;

        const pct = el.value + '%';
        if (playerSeekFill) playerSeekFill.style.width = pct;
        if (fullPlayerSeekFill) fullPlayerSeekFill.style.width = pct;
    };

    if (playerSeek) playerSeek.addEventListener('input', () => handleSeekInput(playerSeek));
    if (fullPlayerSeek) fullPlayerSeek.addEventListener('input', () => handleSeekInput(fullPlayerSeek));

    function syncMuteButtonsState() {
        const volIcon = playerMuteBtn?.querySelector('.vol-icon');
        const muteIcon = playerMuteBtn?.querySelector('.mute-icon');
        if (volIcon) volIcon.style.display = isMuted ? 'none' : 'block';
        if (muteIcon) muteIcon.style.display = isMuted ? 'block' : 'none';

        const fpVolIcon = fullPlayerMuteBtn?.querySelector('.fp-vol-icon');
        const fpMuteIcon = fullPlayerMuteBtn?.querySelector('.fp-mute-icon');
        if (fpVolIcon) fpVolIcon.style.display = isMuted ? 'none' : 'block';
        if (fpMuteIcon) fpMuteIcon.style.display = isMuted ? 'block' : 'none';
    }

    const handleVolumeInput = (el) => {
        const vol = el.value / 100;
        audio.volume = vol;
        isMuted = vol === 0;
        updateVolumeBar(el.value);
        syncMuteButtonsState();
    };

    if (playerVolume) playerVolume.addEventListener('input', () => handleVolumeInput(playerVolume));
    if (fullPlayerVolume) fullPlayerVolume.addEventListener('input', () => handleVolumeInput(fullPlayerVolume));

    const toggleMute = () => {
        isMuted = !isMuted;
        if (isMuted) {
            prevVolume = audio.volume;
            audio.volume = 0;
            updateVolumeBar(0);
        } else {
            audio.volume = prevVolume;
            updateVolumeBar(prevVolume * 100);
        }
        syncMuteButtonsState();
    };

    if (playerMuteBtn) playerMuteBtn.addEventListener('click', toggleMute);
    if (fullPlayerMuteBtn) fullPlayerMuteBtn.addEventListener('click', toggleMute);

    // Inicializar barras de volumen sincronizadas
    if (audio) {
        updateVolumeBar(audio.volume * 100);
    }
}
