const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

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

// Extract the first iframe src from HTML
function extractIframeSrc(html) {
  const $ = cheerio.load(html);
  return $('iframe').first().attr('src') || null;
}

// Extract video URL from a page (generic)
function extractVideoFromPage(html) {
  const $ = cheerio.load(html);
  let src = $('video').attr('src');
  if (src && src.startsWith('http')) return src;
  src = $('video source').first().attr('src');
  if (src && src.startsWith('http')) return src;
  const match = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  if (match) return match[0];
  return null;
}

// ---------- DEEP EXTRACTION (vsembed → cloudorchestranova → video) ----------
app.get('/extract-deep', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).json({ error: 'Missing params' });

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).json({ error: 'Unsupported source' });

  try {
    console.log(`[Deep] Step 1 – fetch embed: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    // 1. Find the nested iframe (cloudorchestranova.com)
    const iframeSrc = extractIframeSrc(html);
    if (!iframeSrc) {
      return res.status(404).json({ error: 'No nested iframe found', snippet: html.substring(0, 500) });
    }

    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
    console.log(`[Deep] Step 2 – fetch nested iframe: ${iframeUrl}`);

    // 2. Fetch the nested iframe page
    const { data: iframeHtml } = await axios.get(iframeUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': embedUrl   // important: pretend we came from the embed page
      }
    });

    // 3. Extract video URL
    const videoUrl = extractVideoFromPage(iframeHtml);
    if (!videoUrl) {
      return res.status(404).json({ error: 'No video found in nested iframe', snippet: iframeHtml.substring(0, 500) });
    }

    console.log(`[Deep] Success! Video URL: ${videoUrl}`);
    res.json({ videoUrl });
  } catch (err) {
    console.error('[Deep] Error:', err.message);
    res.status(500).json({ error: 'Deep extraction failed', details: err.message });
  }
});

// ---------- AD‑FREE EMBED (fallback, with CSP) ----------
app.get('/embed-view', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing params');

  const targetUrl = buildEmbedUrl(source, id, season, episode);
  if (!targetUrl) return res.status(400).send('Unsupported source');

  try {
    console.log(`[AdFree] Fetching: ${targetUrl}`);
    const response = await axios.get(targetUrl, {
      responseType: 'text',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    let html = response.data;
    const baseUrl = new URL(targetUrl);
    html = html.replace('<head>', `<head><base href="${baseUrl.origin}/">`);

    // CSP – allow only essential domains
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vsembed.ru https://*.vsembed.ru https://cloudorchestranova.com https://cdn.jsdelivr.net",
      "style-src 'self' 'unsafe-inline' https://vsembed.ru https://fonts.googleapis.com",
      "img-src 'self' data: https://vsembed.ru https://*.vsembed.ru https://cloudorchestranova.com",
      "frame-src 'self' https://vsembed.ru https://cloudorchestranova.com",
      "connect-src 'self' https://vsembed.ru https://cloudorchestranova.com",
      "font-src 'self' https://fonts.gstatic.com",
    ].join('; ');

    res.set('Content-Security-Policy', csp);
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[AdFree] Error:', err.message);
    res.status(502).send('Failed to load embed page');
  }
});

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

app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
