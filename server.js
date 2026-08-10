const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

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
  return null;
}

// Try to find video URL from JSON-like APIs
async function tryApiEndpoints(baseDomain, id, season, episode) {
  const endpoints = [];
  // Common patterns
  const type = season ? 'tv' : 'movie';
  endpoints.push(`${baseDomain}/api/${type}/${id}`);
  endpoints.push(`${baseDomain}/api/source/${id}`);
  endpoints.push(`${baseDomain}/api/embed/${type}/${id}`);
  if (season) {
    endpoints.push(`${baseDomain}/api/tv/${id}/${season}/${episode}`);
  }

  for (const url of endpoints) {
    try {
      console.log(`  Trying API: ${url}`);
      const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      // Check if JSON contains video links
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      const videoUrl = findVideoUrlInJson(json);
      if (videoUrl) {
        console.log(`  Found video URL from API: ${videoUrl}`);
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

// Extract possible API URLs from scripts
async function searchScriptsForApi(html, baseUrl) {
  const $ = cheerio.load(html);
  const scripts = [];
  $('script[src]').each((i, el) => scripts.push($(el).attr('src')));
  
  for (const src of scripts) {
    const scriptUrl = src.startsWith('http') ? src : new URL(src, baseUrl).href;
    try {
      const { data } = await axios.get(scriptUrl);
      // Look for patterns like: api/, source, file, m3u8, mp4, dash, hls
      const matches = data.match(/(["'`])(https?:\/\/[^"'\`]*?(?:api\/|source|file|m3u8|mp4|mpd|dash|hls)[^"'\`]*?)\1/gi);
      if (matches) {
        for (const m of matches) {
          const cleaned = m.replace(/["'`]/g, '');
          if (/\.(mp4|m3u8|mpd)($|\?)/i.test(cleaned)) {
            console.log(`  Found direct video URL in script: ${cleaned}`);
            return cleaned;
          }
          // Could be an API endpoint – try fetching it
          try {
            const apiResp = await axios.get(cleaned, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            const videoUrl = findVideoUrlInJson(apiResp.data);
            if (videoUrl) {
              console.log(`  Found video URL from script API: ${videoUrl}`);
              return videoUrl;
            }
          } catch (e) { /* ignore */ }
        }
      }
    } catch (e) { /* script fetch failed */ }
  }
  return null;
}

// Enhanced extractor for vsembed
async function extractVSembed(html, embedUrl, id, season, episode) {
  // 1. Try static extraction (original)
  const $ = cheerio.load(html);
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;

  const scriptMatch = html.match(/source\s*:\s*['"]([^'"]+)['"]/);
  if (scriptMatch) return scriptMatch[1];

  // 2. Try to discover API from scripts
  const domain = new URL(embedUrl).origin;
  const scriptApiResult = await searchScriptsForApi(html, embedUrl);
  if (scriptApiResult) return scriptApiResult;

  // 3. Try common API endpoints
  const apiResult = await tryApiEndpoints(domain, id, season, episode);
  if (apiResult) return apiResult;

  // 4. Fallback generic
  const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  return linkMatch ? linkMatch[0] : null;
}

// Generic extractor (unchanged)
async function extractGeneric(html) {
  const $ = cheerio.load(html);
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;
  const scriptRegex = /['"](https?:\/\/[^"']+\.(?:mp4|m3u8|mpd)[^"']*)['"]/gi;
  const matches = html.match(scriptRegex);
  if (matches) return matches[0].replace(/['"]/g, '');
  return null;
}

// ---------- ROUTES ----------
app.get('/proxy', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).json({ error: 'Missing source or id' });

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).json({ error: 'Unsupported source' });

  try {
    console.log(`Fetching embed: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let videoUrl = null;
    const srcLower = source.toLowerCase();

    if (srcLower.includes('vsembed')) {
      videoUrl = await extractVSembed(html, embedUrl, id, season, episode);
    } else if (srcLower.includes('vidsrcme')) {
      // Vidsrcme may also be dynamic, reuse the enhanced extractor
      videoUrl = await extractVSembed(html, embedUrl, id, season, episode);
    } else {
      videoUrl = await extractGeneric(html);
    }

    if (!videoUrl) {
      console.error('No video URL found, returning debug info');
      return res.status(404).json({
        error: 'No video URL found',
        embedUrl,
        pageTitle: html.match(/<title>(.*?)<\/title>/i)?.[1] || 'no title',
        snippet: html.substring(0, 1000)
      });
    }

    console.log(`Streaming: ${videoUrl}`);
    const videoStream = await axios.get(videoUrl, {
      responseType: 'stream',
      headers: { Referer: embedUrl }
    });

    res.set({
      'Content-Type': videoStream.headers['content-type'] || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=3600',
    });

    videoStream.data.pipe(res);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// Health check
app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
