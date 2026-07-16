# VidDrop API - Universal Video Downloader v3.0

<p align="center">
  <strong>Download videos from any platform - YouTube, Facebook, Instagram, TikTok, Twitter/X</strong>
</p>

---

## About

VidDrop is a powerful, production-ready REST API service for downloading videos and audio from multiple platforms. Built with Node.js and Express, it uses a multi-strategy architecture to ensure maximum reliability.

**Live API:** [https://viddrop-tv57.onrender.com](https://viddrop-tv57.onrender.com)

---

## Supported Platforms

| Platform | Video Download | Audio Extract | No Watermark | API Method |
|----------|---------------|---------------|--------------|------------|
| **YouTube** | All qualities (144p-8K) | MP4/M4A | N/A | youtubei.js (Innertube) |
| **TikTok** | HD Video | MP3 Audio | Yes | tikwm.com API |
| **Facebook** | HD/SD Video | Included | N/A | Multi-strategy scraper |
| **Instagram** | Reels/Stories/Posts | Included | N/A | Multi-strategy scraper |
| **Twitter/X** | HD/SD Video | Included | N/A | Multi-strategy scraper |

---

## Quick Start

### Installation

```bash
git clone https://github.com/Av-DevelopmentGroup7/VidDrop-Homse.git
cd VidDrop-Homse
npm install
npm start
```

### Environment Variables (Optional)

```bash
# For extended Facebook/Instagram/Twitter support
RAPIDAPI_KEY=your_rapidapi_key_here

# Server port
PORT=3000
```

> **Free RapidAPI Key:** Get a free key at [rapidapi.com](https://rapidapi.com) and subscribe to "Popular Video Downloader" (free tier: 30 requests/minute).

---

## API Endpoints

### 1. Health Check
```
GET /
```

### 2. Auto-Detect (Smart URL Detection)
```
GET /api/auto?url=https://any-video-url.com
```
Automatically detects the platform and processes accordingly. Supports YouTube, Facebook, Instagram, TikTok, Twitter/X URLs.

### 3. Search YouTube
```
GET /api/search?q=query&limit=20
```

**Example:**
```
https://viddrop-tv57.onrender.com/api/search?q=lofi+music&limit=5
```

### 4. Get Video Info
```
GET /api/info?id=videoId
GET /api/info?url=https://any-platform.com/video
```

**Example (YouTube):**
```
https://viddrop-tv57.onrender.com/api/info?id=dQw4w9WgXcQ
```

**Example (Social Media):**
```
https://viddrop-tv57.onrender.com/api/info?url=https://www.tiktok.com/@user/video/123
```

### 5. Download Video
```
GET /api/download?id=videoId&quality=720p
GET /api/download?url=https://any-platform.com/video
```

**Qualities:** `144p` | `240p` | `360p` | `480p` | `720p` | `1080p` | `1440p` | `2160p` | `highest` | `lowest`

**Example (YouTube 720p):**
```
https://viddrop-tv57.onrender.com/api/download?id=dQw4w9WgXcQ&quality=720p
```

**Example (TikTok):**
```
https://viddrop-tv57.onrender.com/api/download?url=https://www.tiktok.com/@zachking/video/7025456384175017243
```

### 6. Download Audio
```
GET /api/audio?id=videoId
GET /api/audio?url=https://any-platform.com/video
```

**Example (YouTube):**
```
https://viddrop-tv57.onrender.com/api/audio?id=dQw4w9WgXcQ
```

**Example (TikTok - extracts original sound):**
```
https://viddrop-tv57.onrender.com/api/audio?url=https://www.tiktok.com/@user/video/123
```

### 7. Get Stream URL
```
GET /api/stream?id=videoId&type=highest
GET /api/stream?url=https://any-platform.com/video&type=highest
```

**Types:** `highest` | `lowest` | `audio`

### 8. Get Trending Videos
```
GET /api/trending
```

### 9. Get Full Details
```
GET /api/details?id=videoId
GET /api/details?url=https://any-platform.com/video
```

### 10. Get Thumbnails
```
GET /api/thumbnail?id=videoId&size=maxres
GET /api/thumbnail?url=https://any-platform.com/video
```

**Sizes:** `default` | `medium` | `high` | `standard` | `maxres`

### 11. Get Available Formats
```
GET /api/formats?id=videoId
GET /api/formats?url=https://any-platform.com/video
```

### 12. Platform-Specific Endpoints
```
GET /api/facebook?url=https://facebook.com/watch/?v=123
GET /api/instagram?url=https://instagram.com/p/post/
GET /api/tiktok?url=https://tiktok.com/@user/video/123
GET /api/twitter?url=https://twitter.com/user/status/123
```

---

## Usage Examples

### Example 1: Search & Download (JavaScript/Fetch)
```javascript
// Search for videos
const search = await fetch('https://viddrop-tv57.onrender.com/api/search?q=lofi+music&limit=5');
const { results } = await search.json();
console.log(results[0]); // { id, title, channel, thumbnail, duration, views }

// Download the first result
const videoId = results[0].id;
const downloadUrl = `https://viddrop-tv57.onrender.com/api/download?id=${videoId}&quality=720p`;
// Open downloadUrl in browser or use fetch to get the video blob
```

### Example 2: Auto-Detect & Download Any URL
```javascript
// Paste any URL from any platform
const result = await fetch('https://viddrop-tv57.onrender.com/api/auto?url=' + encodeURIComponent('https://www.tiktok.com/@zachking/video/7025456384175017243'));
const data = await result.json();

if (data.success && data.videoUrl) {
  console.log(`Platform: ${data.platform}`);
  console.log(`Title: ${data.title}`);
  console.log(`Video: ${data.videoUrl}`);
  
  if (data.audioUrl) {
    console.log(`Audio: ${data.audioUrl}`);
  }
  
  if (data.noWatermark) {
    console.log('TikTok video without watermark!');
  }
}
```

### Example 3: Mobile App Integration (React Native/Flutter)
```javascript
// In your mobile app, when user pastes a URL:
async function handleDownload(userUrl) {
  const response = await fetch(`https://viddrop-tv57.onrender.com/api/auto?url=${encodeURIComponent(userUrl)}`);
  const data = await response.json();
  
  if (data.success && data.videoUrl) {
    // Show video preview
    setVideoPreview({
      title: data.title,
      thumbnail: data.thumbnail,
      duration: data.duration,
      platform: data.platform
    });
    
    // Download function
    const downloadVideo = async (quality) => {
      const dlUrl = `https://viddrop-tv57.onrender.com/api/download?url=${encodeURIComponent(userUrl)}&quality=${quality}`;
      // Use your platform's download manager
    };
  }
}
```

### Example 4: Extract TikTok Audio (Original Sound)
```javascript
const response = await fetch('https://viddrop-tv57.onrender.com/api/audio?url=https://www.tiktok.com/@user/video/123');
const blob = await response.blob();
// Save blob as MP3 file
```

---

## Response Format

### Search Response
```json
{
  "success": true,
  "query": "lofi music",
  "total": 20,
  "results": [
    {
      "id": "VIDEO_ID",
      "title": "Video Title",
      "channel": { "name": "Channel Name", "id": "UC...", "url": "" },
      "thumbnail": "https://i.ytimg.com/...",
      "duration": "10:30",
      "views": "1.2M views",
      "published": "2 months ago"
    }
  ]
}
```

### TikTok Response
```json
{
  "success": true,
  "platform": "tiktok",
  "title": "Video Title",
  "videoUrl": "https://v16m.tiktokcdn.com/...",
  "audioUrl": "https://sf16.tiktokcdn.com/...",
  "thumbnail": "https://p16.tiktokcdn.com/...",
  "author": { "id": "...", "unique_id": "user123", "nickname": "User" },
  "noWatermark": true,
  "duration": 15,
  "views": 1234567,
  "likes": 123456
}
```

### Auto-Detect Response (YouTube)
```json
{
  "success": true,
  "platform": "youtube",
  "title": "Video Title",
  "thumbnail": "https://i.ytimg.com/...",
  "duration": "3:45",
  "durationSeconds": 225,
  "author": "Channel Name",
  "viewCount": 1234567,
  "streamingData": true
}
```

---

## Architecture

VidDrop uses a multi-strategy approach for maximum reliability:

1. **YouTube:** Uses `youtubei.js` (Innertube API) with dual client strategy (WEB for search/info, ANDROID for downloads)
2. **TikTok:** Uses `tikwm.com` API which provides watermark-free downloads with full metadata
3. **Facebook/Instagram/Twitter:** Uses multiple scraper APIs with automatic fallback chain (4-6 strategies per platform)
4. **RapidAPI Fallback:** Optional RapidAPI key for extended coverage when scraper APIs are blocked

---

## Deployment

### Render (Free Tier)
The API is deployed on [Render](https://render.com) at:
[https://viddrop-tv57.onrender.com](https://viddrop-tv57.onrender.com)

To deploy your own instance:
1. Push to GitHub
2. Connect to Render
3. Set environment variables (RAPIDAPI_KEY, PORT)
4. Deploy

### Environment Variables for Production
```
PORT=3000
NODE_ENV=production
RAPIDAPI_KEY=your_key_here
```

---

## Rate Limiting

- **YouTube:** No rate limit (uses official Innertube API)
- **TikTok:** ~30 requests/minute (tikwm.com limits)
- **Facebook/IG/Twitter:** Varies by scraper API used
- **RapidAPI:** 30 requests/minute (free tier)

---

## Error Handling

```json
{
  "error": "Descriptive error message",
  "details": "Technical details (only in development mode)"
}
```

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Author

**Av-DevelopmentGroup7**

GitHub: [https://github.com/Av-DevelopmentGroup7](https://github.com/Av-DevelopmentGroup7)

---

## Changelog

### v3.0.0 (Current)
- Multi-platform support: YouTube, Facebook, Instagram, TikTok, Twitter/X
- Auto-detect platform from any URL
- TikTok no-watermark downloads via tikwm.com API
- Multi-strategy scraper chain for Facebook, Instagram, Twitter
- RapidAPI integration for extended coverage
- Smart URL parsing for all supported platforms
- Dual client YouTube architecture (WEB + ANDROID)
- Platform-specific dedicated endpoints
- Comprehensive error handling

### v2.0.0
- YouTube video download with quality selection
- Audio extraction (MP4/M4A)
- Video streaming URLs
- Thumbnail extraction
- Format listing
- Trending videos

### v1.0.0
- Basic YouTube search and info
- Video download functionality
