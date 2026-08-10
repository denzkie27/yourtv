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

// ---------- NEW: Embed proxy (rewriting) ----------
app.get('/embed-proxy', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing source or id');

  const targetUrl = buildEmbedUrl(source, id, season, episode);
  if (!targetUrl) return res.status(400).send('Unsupported source');

  try {
    console.log(`Embed-proxy fetching: ${targetUrl}`);
    const response = await axios.get(targetUrl, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let html = response.data;
    const baseUrl = new URL(targetUrl);

    // Rewrite absolute URLs to go through our proxy
    html = html.replace(
      /(src|href)=["'](https?:\/\/[^"']+)["']/gi,
      (match, attr, url) => {
        try {
          const absoluteUrl = new URL(url, baseUrl).href;
          return `${attr}="/fetch-proxy?url=${encodeURIComponent(absoluteUrl)}"`;
        } catch (e) {
          return match;
        }
      }
    );

    // Also rewrite relative URLs to absolute
    html = html.replace(
      /(src|href)=["'](\/[^"']+)["']/gi,
      (match, attr, path) => {
        const absoluteUrl = new URL(path, baseUrl).href;
        return `${attr}="/fetch-proxy?url=${encodeURIComponent(absoluteUrl)}"`;
      }
    );

    // Inject a small script that signals when the player is ready
    html += `
      <script>
        (function() {
          function checkPlayer() {
            var video = document.querySelector('video');
            if (video && video.src) {
              window.parent.postMessage({ type: 'video-ready', src: video.src }, '*');
            } else {
              setTimeout(checkPlayer, 500);
            }
          }
          checkPlayer();
        })();
      </script>
    `;

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Embed proxy error:', err.message);
    res.status(500).send('Failed to load embed page');
  }
});

// Fetch-proxy to serve any resource (scripts, images, etc.)
app.get('/fetch-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    res.set('Content-Type', response.headers['content-type'] || 'application/octet-stream');
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send('Fetch error');
  }
});

// ---------- OLD /proxy (unchanged) ----------
app.get('/proxy', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).json({ error: 'Missing source or id' });

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).json({ error: 'Unsupported source' });

  try {
    console.log(`Fetching embed: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    let videoUrl = null;
    // For embed2 we have a dedicated extractor, otherwise generic
    if (source.includes('embed2')) {
      // your existing extract2embed logic here (from previous version)
      videoUrl = await extract2embed(html, embedUrl);
    } else {
      const $ = cheerio.load(html);
      videoUrl = $('video source').first().attr('src');
      if (!videoUrl) {
        const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
        if (linkMatch) videoUrl = linkMatch[0];
      }
    }

    if (!videoUrl) {
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
    res.set('Content-Type', videoStream.headers['content-type'] || 'video/mp4');
    videoStream.data.pipe(res);
  } catch (err) {
    res.status(500).json({ error: 'Proxy error', details: err.message });
  }
});

// 2embed extractor (keep from previous version)
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

app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
