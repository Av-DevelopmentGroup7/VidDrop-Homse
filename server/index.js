/**
 * VidDrop - Universal Video Downloader API Service v3.0
 * 
 * Multi-platform backend service supporting:
 * YouTube (native via youtubei.js), TikTok (via TikWM API),
 * Facebook, Instagram, Twitter/X (via scraper APIs + optional RapidAPI)
 * 
 * Features: Search, Download, Audio Extract, Stream, Preview, Auto-Detect
 * 
 * Architecture:
 * - YouTube: youtubei.js (Innertube API) - dual client WEB + ANDROID
 * - TikTok: tikwm.com API (no watermark)
 * - Facebook: Multiple scraper APIs with fallbacks
 * - Instagram: Multiple scraper APIs with fallbacks
 * - Twitter/X: TwDown API with fallbacks
 * - Optional: RapidAPI key for extended coverage
 */

const express = require('express');
const cors = require('cors');
const { Innertube, Platform, ClientType } = require('youtubei.js');
const axios = require('axios');
const https = require('https');
const { execSync, exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Trust self-signed certs for scraper APIs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Provide JS evaluator for YouTube deciphering
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

// ============================================================
// STREAM UTILITIES
// ============================================================
function streamToResponse(webStream, res, onError) {
  const reader = webStream.getReader();
  
  res.on('close', () => {
    reader.cancel().catch(() => {});
  });
  
  async function pump() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        if (!res.write(value)) {
          await new Promise(resolve => res.once('drain', resolve));
        }
      }
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream error', details: err.message });
      }
      onError?.(err);
    }
  }

  pump();
}

// ============================================================
// APP SETUP
// ============================================================
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// ============================================================
// YouTube Clients
// ============================================================
let ytWeb = null;
let ytAndroid = null;

async function initYouTube() {
  try {
    ytWeb = await Innertube.create({
      retrieve_player: true,
      client_type: ClientType.WEB,
      lang: 'en',
      location: 'US'
    });
    console.log('YouTube WEB client initialized');
  } catch (err) {
    console.error('YouTube WEB client init error:', err.message);
  }

  try {
    ytAndroid = await Innertube.create({
      retrieve_player: true,
      client_type: ClientType.ANDROID,
      generate_session_locally: false,
      enable_session_cache: false
    });
    console.log('YouTube ANDROID client initialized');
  } catch (err) {
    console.error('YouTube ANDROID client init error:', err.message);
  }
}

function getWebClient() {
  if (!ytWeb) throw new Error('YouTube WEB client not initialized');
  return ytWeb;
}

function getAndroidClient() {
  if (!ytAndroid) throw new Error('YouTube ANDROID client not initialized');
  return ytAndroid;
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================
function sanitizeFilename(filename) {
  return filename
    .replace(/[^\w\s.-]/gi, '')
    .replace(/\s+/g, '_')
    .substring(0, 100);
}

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const s = parseInt(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`
    : `${m}:${sec.toString().padStart(2, '0')}`;
}

const QUALITY_MAP = {
  '144p': 144, '240p': 240, '360p': 360, '480p': 480,
  '720p': 720, '1080p': 1080, '1440p': 1440, '2160p': 2160
};

function findBestFormat(formats, quality, mimeType) {
  if (quality === 'highest') {
    return formats
      .filter(f => f.mime_type?.includes(mimeType))
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
  }
  if (quality === 'lowest') {
    return formats
      .filter(f => f.mime_type?.includes(mimeType))
      .sort((a, b) => (a.height || 0) - (b.height || 0))[0];
  }
  const targetHeight = QUALITY_MAP[quality];
  if (targetHeight) {
    return formats
      .filter(f => f.mime_type?.includes(mimeType))
      .sort((a, b) => {
        const aDist = Math.abs((a.height || 0) - targetHeight);
        const bDist = Math.abs((b.height || 0) - targetHeight);
        return aDist - bDist;
      })[0];
  }
  return formats[0];
}

function extractVideoId(url) {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return ytMatch[1];
  return null;
}

function detectPlatform(url) {
  if (!url) return null;
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) return 'youtube';
  if (lowerUrl.includes('facebook.com') || lowerUrl.includes('fb.watch') || lowerUrl.includes('fb.com')) return 'facebook';
  if (lowerUrl.includes('instagram.com') || lowerUrl.includes('instagr.am')) return 'instagram';
  if (lowerUrl.includes('tiktok.com')) return 'tiktok';
  if (lowerUrl.includes('twitter.com') || lowerUrl.includes('x.com')) return 'twitter';
  return null;
}

// ============================================================
// TIKTOK DOWNLOADER (TikWM API - Confirmed Working)
// ============================================================
async function downloadTikTok(url) {
  try {
    const response = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}&hd=1`, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });

    if (response.data?.code === 0 && response.data?.data) {
      const d = response.data.data;
      return {
        videoUrl: d.play || d.wmplay || d.hdplay,
        title: d.title || 'TikTok Video',
        thumbnail: d.cover || d.origin_cover || '',
        audioUrl: d.music || null,
        author: d.author || 'Unknown',
        noWatermark: true,
        duration: d.duration || 0,
        views: d.play_count || 0,
        likes: d.digg_count || 0
      };
    }
    throw new Error('TikTok API returned no video');
  } catch (error) {
    throw new Error('TikTok download failed: ' + error.message);
  }
}

// ============================================================
// FACEBOOK DOWNLOADER (Multi-strategy scraper)
// ============================================================
async function downloadFacebook(url) {
  const strategies = [
    // Strategy 1: fdownloader.net
    async () => {
      const resp = await axios.post('https://www.fdownloader.net/api/ajaxSearch',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Accept': '*/*',
            'Origin': 'https://www.fdownloader.net',
            'Referer': 'https://www.fdownloader.net/'
          }
        }
      );
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
    // Strategy 2: fdown.net
    async () => {
      const resp = await axios.post('https://fdown.net/download.php',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://fdown.net/'
          }
        }
      );
      const links = resp.data.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g);
      if (links?.length > 0) return links[0].replace(/href="/, '');
      const dl = resp.data.match(/download="([^"]+)"/g);
      if (dl?.length > 0) return dl[0].match(/download="([^"]+)"/)?.[1];
      return null;
    },
    // Strategy 3: savefrom.net
    async () => {
      const resp = await axios.get('https://en1.savefrom.net/1-how-to-download-facebook-video-8GJ.html?url=' + encodeURIComponent(url), {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
          'Referer': 'https://en1.savefrom.net/'
        }
      });
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
    // Strategy 4: getmyfb.com
    async () => {
      const resp = await axios.get('https://getmyfb.com/process?url=' + encodeURIComponent(url), {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json'
        }
      });
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0] || links?.[1];
    },
  ];

  for (const strategy of strategies) {
    try {
      const videoUrl = await strategy();
      if (videoUrl) {
        return { videoUrl, title: 'Facebook Video', thumbnail: '', platform: 'facebook' };
      }
    } catch (e) {
      // Try next strategy
    }
  }

  // Strategy 5: RapidAPI fallback
  if (process.env.RAPIDAPI_KEY) {
    try {
      const resp = await axios.post('https://popular-video-downloader.p.rapidapi.com/download',
        { url },
        {
          timeout: 15000,
          headers: {
            'x-rapidapi-host': 'popular-video-downloader.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      if (resp.data?.url) {
        return { videoUrl: resp.data.url, title: resp.data.title || 'Facebook Video', thumbnail: resp.data.thumbnail || '', platform: 'facebook' };
      }
    } catch (e) { /* skip */ }
  }

  throw new Error('Facebook download failed - all strategies exhausted. Add RAPIDAPI_KEY env var for extended support.');
}

// ============================================================
// INSTAGRAM DOWNLOADER (Multi-strategy scraper)
// ============================================================
async function downloadInstagram(url) {
  const strategies = [
    // Strategy 1: saveig.app
    async () => {
      const resp = await axios.post('https://saveig.app/api/ajaxSearch',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://saveig.app/',
            'Accept': '*/*'
          }
        }
      );
      try {
        const json = typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data;
        if (json.items) {
          for (const item of json.items) {
            if (item.downloadUrl) return item.downloadUrl;
          }
        }
      } catch (e) {
        const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
        return links?.[0];
      }
    },
    // Strategy 2: snapinsta.to
    async () => {
      const resp = await axios.post('https://snapinsta.to/en46/action.php',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': '*/*'
          }
        }
      );
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
    // Strategy 3: snapinsta.app
    async () => {
      const resp = await axios.post('https://snapinsta.app/action.php',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://snapinsta.app/'
          }
        }
      );
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
    // Strategy 4: instagramsave.online
    async () => {
      const resp = await axios.get('https://instagramsave.online/api?url=' + encodeURIComponent(url), {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' }
      });
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
    // Strategy 5: savefrom.net
    async () => {
      const resp = await axios.get('https://en1.savefrom.net/19wr/?url=' + encodeURIComponent(url), {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
          'Referer': 'https://en1.savefrom.net/'
        }
      });
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
  ];

  for (const strategy of strategies) {
    try {
      const videoUrl = await strategy();
      if (videoUrl) {
        return { videoUrl, title: 'Instagram Video', thumbnail: '', platform: 'instagram' };
      }
    } catch (e) {
      // Try next strategy
    }
  }

  // Strategy 6: RapidAPI fallback
  if (process.env.RAPIDAPI_KEY) {
    try {
      const resp = await axios.post('https://popular-video-downloader.p.rapidapi.com/download',
        { url },
        {
          timeout: 15000,
          headers: {
            'x-rapidapi-host': 'popular-video-downloader.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      if (resp.data?.url) {
        return { videoUrl: resp.data.url, title: resp.data.title || 'Instagram Video', thumbnail: resp.data.thumbnail || '', platform: 'instagram' };
      }
    } catch (e) { /* skip */ }
  }

  throw new Error('Instagram download failed - all strategies exhausted. Add RAPIDAPI_KEY env var for extended support.');
}

// ============================================================
// TWITTER/X DOWNLOADER (Multi-strategy scraper)
// ============================================================
async function downloadTwitter(url) {
  const strategies = [
    // Strategy 1: twdown.net
    async () => {
      const resp = await axios.post('https://twdown.net/download.php',
        'URL=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': 'https://twdown.net/',
            'Accept': '*/*'
          }
        }
      );
      const links = resp.data.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g);
      if (links?.length > 0) return links[0].replace(/href="/, '');
      const allLinks = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return allLinks?.[0];
    },
    // Strategy 2: ssstwitter.com
    async () => {
      const resp = await axios.post('https://ssstwitter.com/result',
        'q=' + encodeURIComponent(url),
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': 'https://ssstwitter.com/'
          }
        }
      );
      const links = resp.data.match(/href="(https:\/\/[^"]+\.mp4[^"]*)"/g);
      if (links?.length > 0) return links[0].replace(/href="/, '');
      const allLinks = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return allLinks?.[0];
    },
    // Strategy 3: x2convert.com
    async () => {
      const resp = await axios.get('https://x2convert.com/api?url=' + encodeURIComponent(url), {
        timeout: 12000,
        headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0' }
      });
      const links = resp.data.match(/https:\/\/[^"']+\.mp4[^"'\s]*/g);
      return links?.[0];
    },
  ];

  for (const strategy of strategies) {
    try {
      const videoUrl = await strategy();
      if (videoUrl) {
        return { videoUrl, title: 'Twitter Video', thumbnail: '', platform: 'twitter' };
      }
    } catch (e) {
      // Try next strategy
    }
  }

  // Strategy 4: RapidAPI fallback
  if (process.env.RAPIDAPI_KEY) {
    try {
      const resp = await axios.post('https://popular-video-downloader.p.rapidapi.com/download',
        { url },
        {
          timeout: 15000,
          headers: {
            'x-rapidapi-host': 'popular-video-downloader.p.rapidapi.com',
            'x-rapidapi-key': process.env.RAPIDAPI_KEY,
            'Content-Type': 'application/json'
          }
        }
      );
      if (resp.data?.url) {
        return { videoUrl: resp.data.url, title: resp.data.title || 'Twitter Video', thumbnail: resp.data.thumbnail || '', platform: 'twitter' };
      }
    } catch (e) { /* skip */ }
  }

  throw new Error('Twitter download failed - all strategies exhausted. Add RAPIDAPI_KEY env var for extended support.');
}

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({
    service: 'VidDrop API',
    version: '3.0.0',
    status: 'running',
    platforms: ['YouTube', 'Facebook', 'Instagram', 'TikTok', 'Twitter/X'],
    endpoints: {
      auto: 'GET /api/auto?url=<videoUrl>',
      search: 'GET /api/search?q=<query>&limit=<number>',
      info: 'GET /api/info?url=<videoUrl> or ?id=<videoId>',
      download: 'GET /api/download?url=<videoUrl>&quality=<quality>',
      audio: 'GET /api/audio?url=<videoUrl> or ?id=<videoId>',
      stream: 'GET /api/stream?url=<videoUrl>&type=<type>',
      trending: 'GET /api/trending',
      details: 'GET /api/details?url=<videoUrl> or ?id=<videoId>',
      thumbnail: 'GET /api/thumbnail?url=<videoUrl> or ?id=<videoId>',
      formats: 'GET /api/formats?url=<videoUrl> or ?id=<videoId>',
      facebook: 'GET /api/facebook?url=<facebookUrl>',
      instagram: 'GET /api/instagram?url=<instagramUrl>',
      tiktok: 'GET /api/tiktok?url=<tiktokUrl>',
      twitter: 'GET /api/twitter?url=<twitterUrl>'
    }
  });
});

// ============================================================
// AUTO DETECT - Auto-detect platform from URL and process
// ============================================================
app.get('/api/auto', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required parameter: url' });
    }

    const platform = detectPlatform(url);
    if (!platform) {
      return res.status(400).json({ 
        error: 'Unsupported platform',
        supported: ['YouTube', 'Facebook', 'Instagram', 'TikTok', 'Twitter/X'],
        message: 'Paste any video link from YouTube, Facebook, Instagram, TikTok, or Twitter/X'
      });
    }

    const result = {
      success: true,
      platform,
      inputUrl: url
    };

    try {
      switch (platform) {
        case 'youtube': {
          const ytAndroid = getAndroidClient();
          const videoId = extractVideoId(url);
          if (!videoId) throw new Error('Invalid YouTube URL');
          const info = await ytAndroid.getBasicInfo(videoId);
          result.title = info.basic_info?.title || 'Unknown';
          result.thumbnail = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
          result.duration = formatDuration(info.basic_info?.duration);
          result.durationSeconds = parseInt(info.basic_info?.duration) || 0;
          result.author = info.basic_info?.author || 'Unknown';
          result.viewCount = parseInt(info.basic_info?.view_count) || 0;
          result.streamingData = !!info.streaming_data;
          break;
        }
        case 'facebook': {
          const fb = await downloadFacebook(url);
          result.title = fb.title;
          result.videoUrl = fb.videoUrl;
          result.thumbnail = fb.thumbnail;
          break;
        }
        case 'instagram': {
          const ig = await downloadInstagram(url);
          result.title = ig.title;
          result.videoUrl = ig.videoUrl;
          result.thumbnail = ig.thumbnail;
          break;
        }
        case 'tiktok': {
          const tk = await downloadTikTok(url);
          result.title = tk.title;
          result.videoUrl = tk.videoUrl;
          result.thumbnail = tk.thumbnail;
          result.audioUrl = tk.audioUrl;
          result.author = tk.author;
          result.noWatermark = tk.noWatermark;
          result.duration = tk.duration;
          result.views = tk.views;
          result.likes = tk.likes;
          break;
        }
        case 'twitter': {
          const tw = await downloadTwitter(url);
          result.title = tw.title;
          result.videoUrl = tw.videoUrl;
          result.thumbnail = tw.thumbnail;
          break;
        }
      }
    } catch (e) {
      result.error = e.message;
      result.platformStatus = 'error';
    }

    res.json(result);
  } catch (error) {
    console.error('Auto detect error:', error.message);
    res.status(500).json({ error: 'Auto detect failed', details: error.message });
  }
});

// ============================================================
// SEARCH - Search YouTube for videos
// ============================================================
app.get('/api/search', async (req, res) => {
  try {
    const { q, page, limit } = req.query;
    if (!q) {
      return res.status(400).json({ error: 'Missing required parameter: q (search query)' });
    }

    const yt = getWebClient();
    const searchResults = await yt.search(q, {
      type: 'video',
      limit: parseInt(limit) || 20,
      page: parseInt(page) || 1
    });

    const results = searchResults.results
      .filter(result => result.type === 'Video')
      .map(video => ({
        id: video.id,
        title: video.title?.text || video.title || 'Untitled',
        channel: {
          name: video.author?.name || 'Unknown',
          id: video.author?.id || '',
          url: video.author?.url || ''
        },
        thumbnail: video.thumbnails?.[video.thumbnails.length - 1]?.url || '',
        duration: video.duration?.text || '0:00',
        views: video.view_count?.text || '0 views',
        published: video.published?.text || '',
        isLive: video.is_live || false
      }));

    res.json({ success: true, query: q, total: results.length, results });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', details: error.message });
  }
});

// ============================================================
// VIDEO INFO - Get video information (YouTube + Social)
// ============================================================
app.get('/api/info', async (req, res) => {
  try {
    const { id, url } = req.query;
    const videoId = id || extractVideoId(url);
    
    if (!videoId && !url) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    // Handle social media URLs
    if (url && !videoId) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok': result = await downloadTikTok(url); break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          return res.json({ success: true, platform, ...result });
        } catch (e) {
          return res.status(500).json({ error: e.message, platform });
        }
      }
    }

    if (!videoId) {
      return res.status(400).json({ error: 'Invalid video URL' });
    }

    // YouTube video info
    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const details = info.basic_info;
    const streamingData = info.streaming_data;

    const videoFormats = (streamingData?.formats || []).map(f => ({
      itag: f.itag,
      quality: f.quality,
      resolution: f.width && f.height ? `${f.width}x${f.height}` : 'unknown',
      container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
      mimeType: f.mime_type,
      bitrate: f.bitrate,
      contentLength: f.content_length,
      hasAudio: f.has_audio || false,
      hasVideo: f.has_video || false
    }));

    const audioFormats = (streamingData?.adaptive_formats || [])
      .filter(f => f.has_audio && !f.has_video)
      .map(f => ({
        itag: f.itag,
        quality: f.audio_quality || 'unknown',
        container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
        mimeType: f.mime_type,
        bitrate: f.bitrate,
        contentLength: f.content_length
      }));

    res.json({
      success: true,
      platform: 'youtube',
      video: {
        id: details.id || videoId,
        title: details.title || 'Untitled',
        description: details.short_description || '',
        channel: {
          name: details.author || 'Unknown',
          id: details.channel_id || ''
        },
        duration: parseInt(details.duration) || 0,
        durationFormatted: formatDuration(details.duration),
        viewCount: parseInt(details.view_count) || 0,
        publishDate: details.publish_date || '',
        isLive: details.is_live || false,
        thumbnail: {
          default: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
          medium: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          high: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          maxres: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
        }
      },
      formats: videoFormats,
      audioFormats: audioFormats
    });
  } catch (error) {
    console.error('Info error:', error.message);
    res.status(500).json({ error: 'Failed to get video info', details: error.message });
  }
});

// ============================================================
// VIDEO DOWNLOAD - Download from any platform
// ============================================================
app.get('/api/download', async (req, res) => {
  try {
    const { id, quality, url } = req.query;

    // Handle social media platforms
    if (url) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok': result = await downloadTikTok(url); break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          if (!result || !result.videoUrl) {
            return res.status(500).json({ error: `Could not extract ${platform} video URL` });
          }

          const ext = result.videoUrl.includes('.webm') ? 'webm' : 'mp4';
          res.setHeader('Content-Type', 'video/mp4');
          res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(result.title || 'video')}.${ext}"`);

          const response = await globalThis.fetch(result.videoUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Referer': url
            }
          });

          if (!response.ok) {
            return res.status(502).json({ error: 'Failed to fetch video', status: response.status });
          }

          streamToResponse(response.body, res);
          return;
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      }
    }

    // YouTube download
    const videoId = id || extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'video';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    const downloadOptions = {
      type: 'video+audio',
      quality: quality === 'highest' ? 'best' : (quality === 'lowest' ? 'worst' : quality)
    };

    const stream = await yt.download(videoId, downloadOptions);
    
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(title)}.mp4"`);
    
    streamToResponse(stream, res);
  } catch (error) {
    console.error('Download error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed', details: error.message, stack: error.stack });
    }
  }
});

// ============================================================
// AUDIO DOWNLOAD - Extract audio from any platform
// ============================================================
app.get('/api/audio', async (req, res) => {
  try {
    const { id, url } = req.query;

    // Handle social media platforms
    if (url) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok':
              result = await downloadTikTok(url);
              if (result.audioUrl) {
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(result.title || 'audio')}.mp3"`);
                const response = await globalThis.fetch(result.audioUrl);
                if (response.ok) {
                  streamToResponse(response.body, res);
                  return;
                }
              }
              break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          if (!result || !result.videoUrl) {
            return res.status(500).json({ error: `Could not extract ${platform} audio` });
          }

          res.setHeader('Content-Type', 'audio/mpeg');
          res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(result.title || 'audio')}.m4a"`);

          const response = await globalThis.fetch(result.videoUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
              'Accept': '*/*',
              'Referer': url
            }
          });

          if (!response.ok) {
            return res.status(502).json({ error: 'Failed to fetch audio' });
          }

          streamToResponse(response.body, res);
          return;
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      }
    }

    // YouTube audio
    const videoId = id || extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'audio';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    // Get the combined format (itag 18) URL from ANDROID client
    // This is the only format with a deciphered URL
    const combinedFormats = streamingData.formats || [];
    const combinedFormat = combinedFormats.find(f => f.url && f.has_audio && f.has_video);
    
    if (!combinedFormat || !combinedFormat.url) {
      return res.status(500).json({ error: 'No combined format available for audio extraction' });
    }
    
    const videoUrl = combinedFormat.url;
    
    const tmpVideo = path.join(os.tmpdir(), `viddrop_${Date.now()}.mp4`);
    const tmpAudio = path.join(os.tmpdir(), `viddrop_${Date.now()}.m4a`);
    
    try {
      // Download the video using the direct URL
      execSync(`curl -s -L -H "User-Agent: com.google.android.youtube/18.34.36 (Linux; U; Android 13; en_US) gzip" -o "${tmpVideo}" "${videoUrl}"`, { timeout: 60000 });
      
      // Extract audio using ffmpeg
      execSync(`ffmpeg -i "${tmpVideo}" -vn -acodec copy "${tmpAudio}" -y 2>/dev/null`, { timeout: 60000 });
      
      // Stream the audio file to the response
      const audioStats = fs.statSync(tmpAudio);
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(title)}.m4a"`);
      res.setHeader('Content-Length', audioStats.size);
      
      const audioReadStream = fs.createReadStream(tmpAudio);
      audioReadStream.pipe(res);
      
      audioReadStream.on('end', () => {
        // Cleanup temp files
        fs.unlinkSync(tmpVideo);
        fs.unlinkSync(tmpAudio);
      });
      
      audioReadStream.on('error', () => {
        fs.unlinkSync(tmpVideo);
        try { fs.unlinkSync(tmpAudio); } catch (e) {}
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to stream audio file' });
        }
      });
    } catch (error) {
      // Cleanup on error
      try { fs.unlinkSync(tmpVideo); } catch (e) {}
      try { fs.unlinkSync(tmpAudio); } catch (e) {}
      throw error;
    }
  } catch (error) {
    console.error('Audio download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Audio download failed', details: error.message });
    }
  }
});

// ============================================================
// STREAM - Get streaming URLs for playback
// ============================================================
app.get('/api/stream', async (req, res) => {
  try {
    const { id, type, url } = req.query;

    // Handle social media
    if (url) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok': result = await downloadTikTok(url); break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          if (result) {
            return res.json({
              success: true,
              platform,
              streamUrl: result.videoUrl,
              title: result.title,
              thumbnail: result.thumbnail,
              audioUrl: result.audioUrl || null,
              noWatermark: result.noWatermark || false
            });
          }
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      }
    }

    // YouTube stream
    const videoId = id || extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'Untitled';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    const streamType = type || 'highest';
    let streamObj;
    
    try {
      if (streamType === 'audio') {
        streamObj = await yt.download(videoId, { type: 'audio', quality: 'best' });
      } else {
        streamObj = await yt.download(videoId, { type: 'video+audio', quality: streamType === 'lowest' ? 'worst' : 'best' });
      }
    } catch (e) {
      streamObj = null;
    }

    res.json({
      success: true,
      platform: 'youtube',
      videoId,
      title,
      duration: parseInt(info.basic_info.duration) || 0,
      durationFormatted: formatDuration(info.basic_info.duration),
      streamUrl: streamObj ? (streamObj.url || null) : null,
      streamType,
      dashManifestUrl: streamingData.dash_manifest_url || null,
      hlsManifestUrl: streamingData.hls_manifest_url || null
    });
  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(500).json({ error: 'Stream failed', details: error.message });
  }
});

// ============================================================
// TRENDING - Get trending YouTube videos
// ============================================================
app.get('/api/trending', async (req, res) => {
  try {
    const yt = getWebClient();
    const trendingResults = await yt.search('music', { type: 'video', limit: 20 });
    const videoItems = trendingResults.results.filter(v => v.type === 'Video');
    
    if (videoItems.length < 5) {
      try {
        const homeFeed = await yt.getHomeFeed();
        const feedSections = Array.isArray(homeFeed?.contents) ? homeFeed.contents : [];
        for (const section of feedSections) {
          const items = Array.isArray(section?.contents) ? section.contents : [];
          for (const item of items) {
            if (item.type === 'Video') {
              videoItems.push(item);
            }
          }
        }
      } catch (e) {
        // Ignore
      }
    }
    
    const videos = videoItems.slice(0, 30)
      .map(video => ({
        id: video.id,
        title: video.title?.text || video.title || 'Untitled',
        channel: {
          name: video.author?.name || 'Unknown',
          id: video.author?.id || ''
        },
        thumbnail: video.thumbnails?.[video.thumbnails.length - 1]?.url || '',
        duration: video.duration?.text || '0:00',
        views: video.view_count?.text || '0 views'
      }));

    res.json({ success: true, total: videos.length, results: videos });
  } catch (error) {
    console.error('Trending error:', error.message);
    res.status(500).json({ error: 'Failed to fetch trending', details: error.message });
  }
});

// ============================================================
// DETAILS - Full video details (YouTube + Social)
// ============================================================
app.get('/api/details', async (req, res) => {
  try {
    const { id, url } = req.query;

    // Handle social media
    if (url) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok': result = await downloadTikTok(url); break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          return res.json({ success: true, platform, ...result });
        } catch (e) {
          return res.status(500).json({ error: e.message, platform });
        }
      }
    }

    const videoId = id || extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const details = info.basic_info;

    res.json({
      success: true,
      platform: 'youtube',
      id: details.id || videoId,
      title: details.title || 'Untitled',
      description: details.short_description || '',
      channel: {
        name: details.author || 'Unknown',
        id: details.channel_id || ''
      },
      keywords: details.keywords || [],
      duration: parseInt(details.duration) || 0,
      durationFormatted: formatDuration(details.duration),
      viewCount: parseInt(details.view_count) || 0,
      publishDate: details.publish_date || '',
      isLive: details.is_live || false,
      category: details.category || '',
      thumbnails: details.thumbnail || [],
      tags: details.tags || [],
      downloadOptions: {
        video: (info.streaming_data?.formats || []).map(f => ({
          itag: f.itag,
          quality: f.quality,
          resolution: f.width && f.height ? `${f.width}x${f.height}` : 'unknown',
          container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown'
        })),
        audio: (info.streaming_data?.adaptive_formats || [])
          .filter(f => f.has_audio && !f.has_video)
          .map(f => ({
            itag: f.itag,
            quality: f.audio_quality,
            container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
            bitrate: f.bitrate
          }))
      }
    });
  } catch (error) {
    console.error('Details error:', error.message);
    res.status(500).json({ error: 'Failed to get video details', details: error.message });
  }
});

// ============================================================
// THUMBNAIL - Get thumbnail from any platform
// ============================================================
app.get('/api/thumbnail', async (req, res) => {
  try {
    const { id, size, url } = req.query;

    // Handle social media thumbnails
    if (url) {
      const platform = detectPlatform(url);
      if (platform && platform !== 'youtube') {
        try {
          let result;
          switch (platform) {
            case 'facebook': result = await downloadFacebook(url); break;
            case 'instagram': result = await downloadInstagram(url); break;
            case 'tiktok': result = await downloadTikTok(url); break;
            case 'twitter': result = await downloadTwitter(url); break;
          }
          if (result && result.thumbnail) {
            return res.json({ success: true, platform, thumbnail: result.thumbnail });
          }
        } catch (e) {
          return res.status(500).json({ error: e.message });
        }
      }
    }

    const videoId = id || extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const thumbnailSizes = {
      default: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
      medium: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      high: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      standard: `https://i.ytimg.com/vi/${videoId}/sddefault.jpg`,
      maxres: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
    };

    if (size && thumbnailSizes[size]) {
      return res.json({ success: true, videoId, url: thumbnailSizes[size], size });
    }

    res.json({ success: true, videoId, thumbnails: thumbnailSizes });
  } catch (error) {
    console.error('Thumbnail error:', error.message);
    res.status(500).json({ error: 'Failed to get thumbnail', details: error.message });
  }
});

// ============================================================
// FORMAT LIST - Get all available formats (YouTube)
// ============================================================
app.get('/api/formats', async (req, res) => {
  try {
    const { id, url } = req.query;
    const videoId = id || extractVideoId(url);
    
    if (!videoId) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID) or url' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(videoId);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const streamingData = info.streaming_data;
    const formats = streamingData?.formats || [];
    const adaptive = streamingData?.adaptive_formats || [];

    const videoFormats = formats.map(f => ({
      itag: f.itag,
      type: 'video+audio',
      quality: f.quality,
      resolution: f.width && f.height ? `${f.width}x${f.height}` : 'unknown',
      mimeType: f.mime_type,
      container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
      bitrate: f.bitrate,
      contentLength: f.content_length,
      fps: f.fps
    }));

    const audioFormats = adaptive
      .filter(f => f.has_audio && !f.has_video)
      .map(f => ({
        itag: f.itag,
        type: 'audio-only',
        quality: f.audio_quality,
        mimeType: f.mime_type,
        container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
        bitrate: f.bitrate,
        contentLength: f.content_length,
        sampleRate: f.audio_sample_rate,
        audioChannels: f.audio_channels
      }));

    const videoOnlyFormats = adaptive
      .filter(f => f.has_video && !f.has_audio)
      .map(f => ({
        itag: f.itag,
        type: 'video-only',
        quality: f.quality,
        resolution: f.width && f.height ? `${f.width}x${f.height}` : 'unknown',
        mimeType: f.mime_type,
        container: f.mime_type?.split(';')[0]?.split('/')[1] || 'unknown',
        bitrate: f.bitrate,
        contentLength: f.content_length,
        fps: f.fps
      }));

    res.json({
      success: true,
      videoId,
      title: info.basic_info.title || 'Untitled',
      totalFormats: formats.length + adaptive.length,
      combinedFormats: videoFormats.length,
      audioOnlyFormats: audioFormats.length,
      videoOnlyFormats: videoOnlyFormats.length,
      videoFormats,
      audioFormats,
      videoOnlyFormats
    });
  } catch (error) {
    console.error('Formats error:', error.message);
    res.status(500).json({ error: 'Failed to get formats', details: error.message });
  }
});

// ============================================================
// FACEBOOK - Dedicated endpoint
// ============================================================
app.get('/api/facebook', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required parameter: url (Facebook video URL)' });
    }

    const result = await downloadFacebook(url);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Facebook error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// INSTAGRAM - Dedicated endpoint
// ============================================================
app.get('/api/instagram', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required parameter: url (Instagram URL)' });
    }

    const result = await downloadInstagram(url);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Instagram error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TIKTOK - Dedicated endpoint
// ============================================================
app.get('/api/tiktok', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required parameter: url (TikTok URL)' });
    }

    const result = await downloadTikTok(url);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('TikTok error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// TWITTER/X - Dedicated endpoint
// ============================================================
app.get('/api/twitter', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'Missing required parameter: url (Twitter/X URL)' });
    }

    const result = await downloadTwitter(url);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Twitter error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// ERROR HANDLING
// ============================================================
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// ============================================================
// START SERVER
// ============================================================
(async () => {
  await initYouTube();

  app.listen(PORT, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║         VidDrop API Server Running v3.0                  ║
║         URL: http://localhost:${PORT}                       ║
║         Service: Universal Video Downloader              ║
║         Platforms: YouTube | Facebook | Instagram        ║
║                   TikTok | Twitter/X                     ║
║         TikTok: tikwm.com API (working)                  ║
║         YouTube: youtubei.js (working)                   ║
║         FB/IG/TW: Multi-strategy scraper + RapidAPI      ║
╚══════════════════════════════════════════════════════════╝
    `);
  });
})();

module.exports = app;
