# VidDrop

**Powerful YouTube Video Downloader API Service v2.0**

VidDrop is a production-ready backend service that provides comprehensive YouTube integration including video search, download, audio extraction, and streaming capabilities using YouTube's InnerTube API.

## Features

- **YouTube Search** - Search for any video on YouTube with full metadata
- **Video Download** - Download videos in multiple qualities (144p to 4K)
- **Audio Extraction** - Extract and download audio from any video
- **Video Streaming** - Get direct streaming URLs for playback in your app
- **Video Info** - Get detailed information about any YouTube video
- **Trending Videos** - Fetch popular/trending videos
- **Thumbnail Access** - Access all thumbnail resolutions (default to maxres)
- **Format List** - Get all available video/audio formats with metadata

## Architecture

VidDrop uses a dual-client approach with `youtubei.js` (Innertube):

- **WEB client** - Used for search, metadata, and trending
- **ANDROID client** - Used for streaming/download URLs (pre-deciphered)

This approach avoids signature deciphering issues and provides reliable streaming URLs.

## API Endpoints

### 1. Health Check
```
GET /
```

### 2. Search Videos
```
GET /api/search?q=<query>&limit=<number>&page=<number>
```

**Example:**
```bash
curl "http://localhost:3000/api/search?q=lofi+music&limit=10"
```

### 3. Get Video Info
```
GET /api/info?id=<video_id>
```

### 4. Download Video
```
GET /api/download?id=<video_id>&quality=<quality>
```

**Quality Options:** `144p`, `240p`, `360p`, `480p`, `720p`, `1080p`, `1440p`, `2160p`, `highest`, `lowest`

**Example:**
```bash
curl "http://localhost:3000/api/download?id=dQw4w9WgXcQ&quality=720p"
```

### 5. Download Audio
```
GET /api/audio?id=<video_id>
```

**Example:**
```bash
curl "http://localhost:3000/api/audio?id=dQw4w9WgXcQ"
```

### 6. Get Stream URL
```
GET /api/stream?id=<video_id>&type=<type>
```

**Type Options:** `highest`, `lowest`, `audio`

**Example:**
```bash
curl "http://localhost:3000/api/stream?id=dQw4w9WgXcQ&type=highest"
```

### 7. Get Trending Videos
```
GET /api/trending
```

### 8. Get Full Video Details
```
GET /api/details?id=<video_id>
```

### 9. Get Thumbnail
```
GET /api/thumbnail?id=<video_id>&size=<size>
```

**Size Options:** `default`, `medium`, `high`, `standard`, `maxres`

### 10. Get Format List
```
GET /api/formats?id=<video_id>
```

## Installation

```bash
git clone https://github.com/YOUR_USERNAME/VidDrop-Homse.git
cd VidDrop-Homse
npm install
npm start
```

## Development

```bash
npm run dev
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | Server port |

## Technology Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **youtubei.js (Innertube)** - YouTube InnerTube API client
- **CORS** - Cross-origin resource sharing

## License

MIT License

---
Built by VidDrop Team
