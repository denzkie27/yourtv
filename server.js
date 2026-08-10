const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ---------- BUILD EMBED URL ----------
function buildEmbedUrl(source, id, season, episode) {
  const s = source.toLowerCase();
  if (s.includes('vsembed_ru')) {
    return season ? `https://vsembed.ru/embed/tv/${id}/${season}/${episode}` : `https://vsembed.ru/embed/movie/${id}`;
  }
  if (s.includes('vsembed_su')) {
    return season ? `https://vsembed.su/embed/tv/${id}/${season}/${episode}` : `https://vsembed.su/embed/movie/${id}`;
  }
  if (s.includes('vidsrcme_ru')) {
    return season ? `https://vidsrcme.ru/embed/tv/${id}/${season}/${episode}` : `https://vidsrcme.ru/embed/movie/${id}`;
  }
  if (s.includes('vidsrcme_su')) {
    return season ? `https://vidsrcme.su/embed/tv/${id}/${season}/${episode}` : `https://vidsrcme.su/embed/movie/${id}`;
  }
  if (s.includes('embed2')) {
    return season ? `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}` : `https://www.2embed.cc/embed/${id}`;
  }
  return null;
}

// ---------- TRY KNOWN API ENDPOINTS ----------
async function tryApiEndpoints(domain, id, season, episode) {
  const endpoints = [];
  // vsembed known API
  if (domain.includes('vsembed')) {
    endpoints.push(`${domain}/api/source/${id}`);
    endpoints.push(`${domain}/api/movie/${id}`);
    if (season) endpoints.push(`${domain}/api/tv/${id}/${season}/${episode}`);
  }
  // vidsrcme known API
  if (domain.includes('vidsrcme')) {
    endpoints.push(`https://vidsrcme.ru/api/embed/movie/${id}`);
    endpoints.push(`https://vidsrcme.ru/api/embed/tv/${id}/${season}/${episode}`);
  }

  for (const url of endpoints) {
    try {
      console.log(`  Trying API: ${url}`);
      const { data } = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const json = typeof data === 'string' ? JSON.parse(data) : data;
      // Search for any string that looks like a media URL
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

// ---------- GENERIC PAGE SCRAPER ----------
async function scrapePage(html) {
  const $ = cheerio.load(html);
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;
  const match = html.match(/source\s*:\s*['"]([^'"]+)['"]/);
  if (match) return match[1];
  const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  return linkMatch ? linkMatch[0] : null;
}

// ---------- 2EMBED EXTRACTOR ----------
async function extract2embed(html, embedUrl) {
  const $ = cheerio.load(html);
  const iframeSrc = $('iframe').first().attr('src');
  if (iframeSrc) {
    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
    try {
      const iframeHtml = (await axios.get(iframeUrl)).data;
      const linkMatch = iframeHtml.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
      if (linkMatch) return linkMatch[0];
    } catch (e) {}
  }
  return null;
}

// ---------- ROUTES ----------

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

// /proxy – main extraction endpoint
app.get('/proxy', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).json({ error: 'Missing source or id' });

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).json({ error: 'Unsupported source' });

  try {
    // 1. Try known API endpoints first (fastest)
    const domain = new URL(embedUrl).origin;
    let videoUrl = await tryApiEndpoints(domain, id, season, episode);
    if (videoUrl) {
      return streamVideo(res, videoUrl, embedUrl);
    }

    // 2. Fall back to scraping the embed page
    console.log(`Scraping embed page: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (source.includes('embed2')) {
      videoUrl = await extract2embed(html, embedUrl);
    } else {
      videoUrl = await scrapePage(html);
    }

    if (!videoUrl) {
      return res.status(404).json({
        error: 'No video URL found',
        embedUrl,
        pageTitle: html.match(/<title>(.*?)<\/title>/i)?.[1] || 'no title',
        snippet: html.substring(0, 500)
      });
    }

    return streamVideo(res, videoUrl, embedUrl);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

async function streamVideo(res, videoUrl, referer) {
  console.log(`Streaming: ${videoUrl}`);
  const videoStream = await axios.get(videoUrl, {
    responseType: 'stream',
    headers: { Referer: referer }
  });
  res.set({
    'Content-Type': videoStream.headers['content-type'] || 'video/mp4',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=3600',
  });
  videoStream.data.pipe(res);
}

// Health check
app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
