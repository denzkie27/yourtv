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

// ---------- NEW: /extract – follow the iframe chain ----------
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

    // 1. Look for the nested iframe (e.g., cloudorchestranova.com)
    const iframeSrc = extractIframeSrc(html);
    if (!iframeSrc) {
      // No nested iframe – try direct video extraction from this page
      const directVideo = extractVideoFromPage(html);
      if (directVideo) {
        return res.json({ videoUrl: directVideo });
      }
      return res.status(404).json({ error: 'No iframe or video found', snippet: html.substring(0, 500) });
    }

    console.log(`[Extract] Found nested iframe: ${iframeSrc}`);

    // 2. Fetch the nested iframe page
    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
    const { data: iframeHtml } = await axios.get(iframeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    // 3. Extract the video URL from the nested page
    const videoUrl = extractVideoFromPage(iframeHtml);
    if (!videoUrl) {
      return res.status(404).json({ error: 'No video found in nested iframe', snippet: iframeHtml.substring(0, 500) });
    }

    console.log(`[Extract] Success! Video URL: ${videoUrl}`);
    res.json({ videoUrl });
  } catch (err) {
    console.error('[Extract] Error:', err.message);
    res.status(500).json({ error: 'Extraction failed', details: err.message });
  }
});

// Keep old /proxy and /raw-html endpoints (unchanged)
app.get('/proxy', async (req, res) => {
  // ... your existing /proxy handler ...
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
