const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { URL } = require('url');

const app = express();
app.use(cors());

// ---------- HELPERS ----------
function buildEmbedUrl(source, id, season, episode) {
  const s = source.toLowerCase();
  if (s.includes('vsembed_ru')) {
    return season
      ? `https://vsembed.ru/embed/tv/${id}/${season}/${episode}`
      : `https://vsembed.ru/embed/movie/${id}`;
  }
  if (s.includes('vsembed_su')) {
    return season
      ? `https://vsembed.su/embed/tv/${id}/${season}/${episode}`
      : `https://vsembed.su/embed/movie/${id}`;
  }
  if (s.includes('vidsrcme_ru')) {
    return season
      ? `https://vidsrcme.ru/embed/tv/${id}/${season}/${episode}`
      : `https://vidsrcme.ru/embed/movie/${id}`;
  }
  if (s.includes('vidsrcme_su')) {
    return season
      ? `https://vidsrcme.su/embed/tv/${id}/${season}/${episode}`
      : `https://vidsrcme.su/embed/movie/${id}`;
  }
  if (s.includes('embed2')) {
    return season
      ? `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`
      : `https://www.2embed.cc/embed/${id}`;
  }
  return null;
}

// Extract first iframe src from HTML
function extractIframeSrc(html) {
  const $ = cheerio.load(html);
  return $('iframe').first().attr('src') || null;
}

// Extract video URL from a page (generic)
function extractVideoFromPage(html) {
  const $ = cheerio.load(html);
  // <video> with src
  let src = $('video').attr('src');
  if (src && src.startsWith('http')) return src;
  // <video><source>
  src = $('video source').first().attr('src');
  if (src && src.startsWith('http')) return src;
  // regex fallback for m3u8 / mp4 / mpd
  const match = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  if (match) return match[0];
  return null;
}

// Try known API endpoints for certain sources
async function tryApiEndpoints(domain, id, season, episode) {
  const endpoints = [];
  if (domain.includes('vsembed')) {
    endpoints.push(`${domain}/api/source/${id}`);
    endpoints.push(`${domain}/api/movie/${id}`);
    if (season) endpoints.push(`${domain}/api/tv/${id}/${season}/${episode}`);
  }
  if (domain.includes('vidsrcme')) {
    endpoints.push(`https://vidsrcme.ru/api/embed/movie/${id}`);
    endpoints.push(`https://vidsrcme.ru/api/embed/tv/${id}/${season}/${episode}`);
  }

  for (const url of endpoints) {
    try {
      console.log(`  Trying API: ${url}`);
      const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      const videoUrl = findVideoUrlInJson(json);
      if (videoUrl) {
        console.log(`  Found video URL via API: ${videoUrl}`);
        return videoUrl;
      }
    } catch (e) { /* ignore */ }
  }
  return null;
}

function findVideoUrlInJson(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const stack = [obj];
  while (stack.length) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
    } else if (typeof current === 'object') {
      for (const key of Object.keys(current)) {
        const val = current[key];
        if (typeof val === 'string' && /\.(mp4|m3u8|mpd)($|\?)/i.test(val)) return val;
        stack.push(val);
      }
    }
  }
  return null;
}

// ---------- ROUTES ----------

// Health check
app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

// /raw-html – shows the untouched embed page source (for debugging)
app.get('/raw-html', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing params');
  const url = buildEmbedUrl(source, id, season, episode);
  if (!url) return res.status(400).send('Unsupported source');
  try {
    const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    res.set('Content-Type', 'text/plain');
    res.send(data);
  } catch (e) {
    res.status(500).send('Error: ' + e.message);
  }
});

// /extract – follow iframe chain and return the direct video URL
app.get('/extract', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).json({ error: 'Missing params' });

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).json({ error: 'Unsupported source' });

  try {
    console.log(`[Extract] Fetching embed: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    // 1. Try API endpoints first (fast, no scraping)
    const domain = new URL(embedUrl).origin;
    let videoUrl = await tryApiEndpoints(domain, id, season, episode);
    if (videoUrl) {
      return res.json({ videoUrl });
    }

    // 2. Look for a nested iframe
    const iframeSrc = extractIframeSrc(html);
    if (iframeSrc) {
      console.log(`[Extract] Found nested iframe: ${iframeSrc}`);
      const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
      const { data: iframeHtml } = await axios.get(iframeUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      videoUrl = extractVideoFromPage(iframeHtml);
      if (videoUrl) {
        console.log(`[Extract] Success via iframe: ${videoUrl}`);
        return res.json({ videoUrl });
      }
      return res.status(404).json({
        error: 'No video found in nested iframe',
        iframeUrl,
        snippet: iframeHtml.substring(0, 1000)
      });
    }

    // 3. No iframe – try direct extraction from the embed page
    videoUrl = extractVideoFromPage(html);
    if (videoUrl) {
      console.log(`[Extract] Success via direct: ${videoUrl}`);
      return res.json({ videoUrl });
    }

    // 4. Nothing found
    return res.status(404).json({
      error: 'No iframe or video found',
      snippet: html.substring(0, 1000)
    });

  } catch (err) {
    console.error('[Extract] Error:', err.message);
    res.status(500).json({ error: 'Extraction failed', details: err.message });
  }
});

// /proxy – stream the video directly (fallback)
app.get('/proxy', async (req, res) => {
  // ... keep your existing /proxy handler ...
});

// /embed-proxy (optional, for same‑origin iframe trick)
app.get('/embed-proxy', async (req, res) => {
  // ... keep if you want, but not essential ...
});

// /fetch-proxy (optional, for rewriting resources)
app.get('/fetch-proxy', async (req, res) => {
  // ... keep if you want ...
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
