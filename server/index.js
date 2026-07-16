/**
 * VidDrop - YouTube Video Downloader API Service v2.0
 * 
 * A powerful backend service for searching, downloading videos,
 * extracting audio, and streaming content from YouTube.
 * 
 * Architecture:
 * - WEB client: Used for search, trending, and metadata (no player needed)
 * - ANDROID client: Used for streaming/download URLs (URLs come pre-deciphered)
 * 
 * This dual-client approach avoids the signature deciphering issue
 * and provides reliable streaming URLs.
 */

const express = require('express');
const cors = require('cors');
const { Innertube, Platform, ClientType } = require('youtubei.js');

// Provide JS evaluator for any deciphering needs
Platform.shim.eval = async (data) => {
  return new Function(data.output)();
};

// ============================================================
// STREAM UTILITIES
// ============================================================
const { pipeline } = require('stream');
const { Writable } = require('stream');

/**
 * Convert a Web ReadableStream to a Node.js stream and pipe to response
 */
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
          // Backpressure - wait for drain
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

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// Middleware
// ============================================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));

// ============================================================
// YouTube Clients
// ============================================================

let ytWeb = null;
let ytAndroid = null;

async function initYouTube() {
  try {
    // WEB client for search, info, trending (no player needed)
    ytWeb = await Innertube.create({
      retrieve_player: false,
      client_type: ClientType.WEB,
      lang: 'en',
      location: 'US'
    });
    console.log('YouTube WEB client initialized');
  } catch (err) {
    console.error('YouTube WEB client init error:', err.message);
    ytWeb = null;
  }

  try {
    // ANDROID client for streaming/download (URLs come pre-deciphered)
    ytAndroid = await Innertube.create({
      retrieve_player: false,
      client_type: ClientType.ANDROID,
      generate_session_locally: false,
      enable_session_cache: false
    });
    console.log('YouTube ANDROID client initialized');
  } catch (err) {
    console.error('YouTube ANDROID client init error:', err.message);
    ytAndroid = null;
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

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/', (req, res) => {
  res.json({
    service: 'VidDrop API',
    version: '2.0.0',
    status: 'running',
    engine: 'youtubei.js (Innertube)',
    endpoints: {
      search: 'GET /api/search?q=<query>&page=<number>',
      info: 'GET /api/info?id=<videoId>',
      download: 'GET /api/download?id=<videoId>&quality=<quality>',
      audio: 'GET /api/audio?id=<videoId>',
      stream: 'GET /api/stream?id=<videoId>&type=<type>',
      trending: 'GET /api/trending',
      details: 'GET /api/details?id=<videoId>',
      thumbnail: 'GET /api/thumbnail?id=<videoId>',
      formats: 'GET /api/formats?id=<videoId>'
    }
  });
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
// VIDEO INFO - Get detailed information about a video
// ============================================================
app.get('/api/info', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    // Use ANDROID client for complete streaming data
    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

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
      video: {
        id: details.id || id,
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
          default: `https://i.ytimg.com/vi/${id}/default.jpg`,
          medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
          high: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
          maxres: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
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
// VIDEO DOWNLOAD - Download video with quality options
// ============================================================
app.get('/api/download', async (req, res) => {
  try {
    const { id, quality } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'video';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    // Find the best format matching quality
    const formats = streamingData.formats || [];
    const selectedFormat = findBestFormat(formats, quality || 'highest', 'video/mp4');

    if (!selectedFormat) {
      return res.status(400).json({ error: 'No matching format found' });
    }

    const videoUrl = selectedFormat.url;
    if (!videoUrl) {
      return res.status(500).json({ error: 'Could not resolve video URL' });
    }

    // Set headers for direct download
    const ext = selectedFormat.mime_type?.includes('webm') ? 'webm' : 'mp4';
    const contentLength = selectedFormat.content_length;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(title)}.${ext}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Accept-Ranges', 'bytes');

    // Fetch and pipe the video stream with proper headers
    const response = await globalThis.fetch(videoUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/18.34.36 (Linux; U; Android 13; en_US) gzip',
        'Accept': '*/*',
        'Accept-Encoding': 'identity;q=1, *;q=0'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch video stream', status: response.status });
    }

    streamToResponse(response.body, res);

  } catch (error) {
    console.error('Download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Download failed', details: error.message });
    }
  }
});

// ============================================================
// AUDIO DOWNLOAD - Extract and download audio from video
// ============================================================
app.get('/api/audio', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'audio';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    // ANDROID client provides combined format (itag 18) with audio+video URL
    // Adaptive audio-only formats don't have URLs (YouTube restriction)
    // Use the combined format URL which includes audio, or server_abr_streaming_url
    let audioUrl = null;
    let audioFormat = null;

    // Try 1: Use combined format (itag 18) which includes audio
    const combinedFormats = streamingData.formats || [];
    const combinedWithAudio = combinedFormats.filter(f => f.url && f.has_audio);
    if (combinedWithAudio.length > 0) {
      audioFormat = combinedWithAudio.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      audioUrl = audioFormat.url;
    }

    // Try 2: Use server_abr_streaming_url as fallback
    if (!audioUrl && streamingData.server_abr_streaming_url) {
      audioUrl = streamingData.server_abr_streaming_url;
      audioFormat = { mime_type: 'audio/mp4; codecs="mp4a.40.2"', content_length: null };
    }

    if (!audioUrl) {
      return res.status(500).json({ error: 'Could not resolve audio URL' });
    }

    // Set headers for audio download
    const ext = audioFormat.mime_type?.includes('webm') ? 'webm' : 'm4a';
    const contentLength = audioFormat.content_length;

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="${sanitizeFilename(title)}.${ext}"`);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Fetch and pipe the audio stream
    const response = await globalThis.fetch(audioUrl, {
      headers: {
        'User-Agent': 'com.google.android.youtube/18.34.36 (Linux; U; Android 13; en_US) gzip',
        'Accept': '*/*',
        'Accept-Encoding': 'identity;q=1, *;q=0'
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: 'Failed to fetch audio stream', status: response.status });
    }

    streamToResponse(response.body, res);

  } catch (error) {
    console.error('Audio download error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Audio download failed', details: error.message });
    }
  }
});

// ============================================================
// STREAM - Get streaming URLs for video playback
// ============================================================
app.get('/api/stream', async (req, res) => {
  try {
    const { id, type } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const title = info.basic_info.title || 'Untitled';
    const streamingData = info.streaming_data;

    if (!streamingData) {
      return res.status(500).json({ error: 'No streaming data available' });
    }

    const formats = streamingData.formats || [];
    const adaptive = streamingData.adaptive_formats || [];

    // Build resolved format lists (ANDROID client provides pre-deciphered URLs)
    const resolvedVideoFormats = formats.map(f => ({
      itag: f.itag,
      quality: f.quality,
      resolution: f.width && f.height ? `${f.width}x${f.height}` : null,
      mimeType: f.mime_type,
      bitrate: f.bitrate,
      contentLength: f.content_length,
      url: f.url || null,
      fps: f.fps
    }));

    const resolvedAudioFormats = adaptive
      .filter(f => f.has_audio && !f.has_video)
      .map(f => ({
        itag: f.itag,
        quality: f.audio_quality,
        mimeType: f.mime_type,
        bitrate: f.bitrate,
        contentLength: f.content_length,
        url: f.url || null
      }));

    // Find the best stream URL based on request type
    const streamType = type || 'highest';
    let bestStreamUrl = null;

    if (streamType === 'audio') {
      const bestAudio = resolvedAudioFormats
        .filter(f => f.url)
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      bestStreamUrl = bestAudio?.url || null;
    } else {
      const videoWithUrl = resolvedVideoFormats.filter(f => f.url && f.resolution);
      if (videoWithUrl.length > 0) {
        if (streamType === 'lowest') {
          bestStreamUrl = videoWithUrl.sort((a, b) => {
            const aH = parseInt(a.resolution?.split('x')[1] || '0');
            const bH = parseInt(b.resolution?.split('x')[1] || '0');
            return aH - bH;
          })[0]?.url;
        } else {
          // highest
          bestStreamUrl = videoWithUrl.sort((a, b) => {
            const aH = parseInt(a.resolution?.split('x')[1] || '0');
            const bH = parseInt(b.resolution?.split('x')[1] || '0');
            return bH - aH;
          })[0]?.url;
        }
      } else {
        bestStreamUrl = resolvedVideoFormats.find(f => f.url)?.url || null;
      }
    }

    res.json({
      success: true,
      videoId: id,
      title: title,
      duration: parseInt(info.basic_info.duration) || 0,
      durationFormatted: formatDuration(info.basic_info.duration),
      streamUrl: bestStreamUrl,
      streamType: streamType,
      availableStreams: {
        video: resolvedVideoFormats,
        audio: resolvedAudioFormats
      },
      dashManifestUrl: streamingData.dash_manifest_url || null,
      hlsManifestUrl: streamingData.hls_manifest_url || null
    });
  } catch (error) {
    console.error('Stream error:', error.message);
    res.status(500).json({ error: 'Stream failed', details: error.message });
  }
});

// ============================================================
// TRENDING - Get trending videos
// ============================================================
app.get('/api/trending', async (req, res) => {
  try {
    const yt = getWebClient();
    
    // Use search for trending content instead of getHomeFeed which has structure issues
    const trendingResults = await yt.search('music', { type: 'video', limit: 20 });
    const videoItems = trendingResults.results.filter(v => v.type === 'Video');
    
    // Also try getHomeFeed as fallback
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
        // Ignore home feed errors
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
// DETAILS - Full video details with all metadata
// ============================================================
app.get('/api/details', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

    if (!info || !info.basic_info) {
      return res.status(404).json({ error: 'Video not found or unavailable' });
    }

    const details = info.basic_info;

    res.json({
      success: true,
      id: details.id || id,
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
// THUMBNAIL - Get video thumbnail URLs
// ============================================================
app.get('/api/thumbnail', async (req, res) => {
  try {
    const { id, size } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const thumbnailSizes = {
      default: `https://i.ytimg.com/vi/${id}/default.jpg`,
      medium: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      high: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      standard: `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
      maxres: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
    };

    if (size && thumbnailSizes[size]) {
      return res.json({ success: true, videoId: id, url: thumbnailSizes[size], size });
    }

    res.json({ success: true, videoId: id, thumbnails: thumbnailSizes });
  } catch (error) {
    console.error('Thumbnail error:', error.message);
    res.status(500).json({ error: 'Failed to get thumbnail', details: error.message });
  }
});

// ============================================================
// FORMAT LIST - Get all available formats for a video
// ============================================================
app.get('/api/formats', async (req, res) => {
  try {
    const { id } = req.query;
    if (!id) {
      return res.status(400).json({ error: 'Missing required parameter: id (video ID)' });
    }

    const yt = getAndroidClient();
    const info = await yt.getBasicInfo(id);

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
      videoId: id,
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
╔══════════════════════════════════════════════════╗
║         VidDrop API Server Running               ║
║         URL: http://localhost:${PORT}             ║
║         Service: YouTube Downloader v2.0         ║
║         Clients: WEB + ANDROID                   ║
╚══════════════════════════════════════════════════╝
    `);
  });
})();

module.exports = app;
