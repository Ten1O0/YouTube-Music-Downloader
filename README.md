# 🎵 YouTube Downloader

A modern and elegant web application to download music from YouTube as high-quality MP3 files.

![YouTube Downloader](https://img.shields.io/badge/YouTube-Downloader-red?style=for-the-badge&logo=youtube)
![Python](https://img.shields.io/badge/Python-3.8+-blue?style=for-the-badge&logo=python)
![Flask](https://img.shields.io/badge/Flask-2.0+-green?style=for-the-badge&logo=flask)

## ✨ Features

### 🔗 Multiple Download Options
- **Direct URL**: Paste any YouTube link (videos, shorts, music).
- **Full Playlists**: Download entire playlists as a single ZIP file.
- **Search by Name**: Search for songs by title and choose from results.

### 🎨 Modern Interface
- **Light/Dark Mode**: Switch between themes with a single click.
- **Audio Preview**: Listen to a snippet before downloading (Music note icon 🎵).
- **Quality Selection**: Choose your preferred audio quality (128kbps, 192kbps, 320kbps).
- **Feedback Animations**: Confetti 🎉 and success animations when downloads complete.
- **Real-time Progress**: Track download progress instantly.
- **Responsive Design**: Works perfectly on mobile and desktop.

### 🚀 Performance
- Background downloading without blocking the interface.
- Automatic conversion to high-quality MP3.
- Support for playlists of any size.

## 📋 Requirements

- **Python 3.8** or higher
- **FFmpeg** (included in the project for Windows)
- Internet connection

## 🛠️ Installation

### 1. Clone or download the project

```bash
git clone https://github.com/your-username/youtube-downloader.git
cd youtube-downloader
```

### 2. Create virtual environment (recommended)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux/Mac
source .venv/bin/activate
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Verify FFmpeg

The project includes FFmpeg for Windows. If you are on Linux/Mac, install it manually:

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Mac (with Homebrew)
brew install ffmpeg
```

## 🚀 Usage

### Start the server

```bash
python server.py
```

The server will start at `http://localhost:5000`

### Open the application

1. Open your browser.
2. Go to `http://localhost:5000`.
3. Ready to download!

## 📖 User Guide

### Download a specific video

1. Copy the YouTube video URL.
2. Paste it into the input field.
3. Select audio quality (optional).
4. Click "Download".
5. The MP3 file will download automatically.

### Download a full playlist

1. Copy the playlist URL (or a video within it).
2. Paste it into the input field.
3. Click "Download".
4. You will see progress for each song.
5. A ZIP file with all songs will be downloaded.

### Search by name

1. Type the song name or artist.
2. Click "Download" (or press Enter).
3. 5 results will appear with thumbnails.
4. Preview the audio by clicking the music note icon 🎵.
5. Click on the result you want to download.

## 📁 Project Structure

```
YouTube Downloader/
├── server.py           # Flask Backend
├── index.html          # Main Frontend Page
├── styles.css          # CSS Styles
├── app.js              # Frontend Logic
├── requirements.txt    # Python Dependencies
└── ffmpeg-master-latest-win64-gpl/
    └── bin/            # FFmpeg for Windows
```

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Main page |
| GET | `/api/health` | Server health check |
| POST | `/api/search` | Search YouTube videos |
| POST | `/api/start-download` | Start download |
| GET | `/api/progress/<id>` | Get download progress |
| GET | `/api/download/<id>` | Download completed file |

## ⚙️ Configuration

Main variables can be modified in `server.py`:

```python
DOWNLOAD_TIMEOUT = 1800  # Timeout in seconds (30 min)
TEMP_DIR = os.path.join(tempfile.gettempdir(), 'youtube_downloader')
```

## 🐛 Troubleshooting

### "Cannot connect to server"
- Check if the server is running (`python server.py`).
- Ensure port 5000 is not in use.

### "Download error"
- Check your internet connection.
- Some videos may have geographic restrictions.
- Update yt-dlp: `pip install --upgrade yt-dlp`

### Download takes too long
- Large playlists can take several minutes.
- Progress is shown in real-time.

## 📦 Dependencies

| Package | Version | Usage |
|---------|---------|-----|
| Flask | ≥2.0 | Web Framework |
| Flask-CORS | ≥3.0 | Cross-origin requests |
| yt-dlp | Latest | YouTube content downloader |

## 🔒 Disclaimer

This tool is designed for personal and educational use only. Please respect YouTube's Terms of Service and copyright laws. Do not use this tool to:

- Download copyrighted content without permission.
- Redistribute downloaded content commercially.
- Violate YouTube's Terms of Service.

## 🤝 Contributing

Contributions are welcome. For major changes:

1. Fork the repository.
2. Create a feature branch (`git checkout -b feature/new-feature`).
3. Commit your changes (`git commit -m 'Add new feature'`).
4. Push to the branch (`git push origin feature/new-feature`).
5. Open a Pull Request.

## 📄 License

This project is licensed under the MIT License. See the `LICENSE` file for details.

---

<p align="center">
  Made with ❤️ using Python and Flask
</p>
