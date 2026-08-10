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

// ---------- EMBED PROXY (improved) ----------
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

    // Insert <base> tag to help resolve relative URLs
    html = html.replace('<head>', `<head><base href="${baseUrl.origin}/">`);

    // Rewrite absolute URLs to go through our fetch-proxy
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

    // Rewrite relative URLs to absolute (using the base)
    html = html.replace(
      /(src|href)=["'](\/[^"']+)["']/gi,
      (match, attr, path) => {
        const absoluteUrl = new URL(path, baseUrl).href;
        return `${attr}="/fetch-proxy?url=${encodeURIComponent(absoluteUrl)}"`;
      }
    );

    // Inject script that waits for the player and posts the video URL
    const injectedScript = `
      <script>
        (function() {
          function findVideo() {
            var video = document.querySelector('video');
            if (video && video.src && video.src.startsWith('http')) {
              window.parent.postMessage({ type: 'video-ready', src: video.src }, '*');
              return true;
            }
            // Also check for source elements
            var source = document.querySelector('video source');
            if (source && source.src && source.src.startsWith('http')) {
              window.parent.postMessage({ type: 'video-ready', src: source.src }, '*');
              return true;
            }
            return false;
          }

          if (document.readyState === 'complete' || document.readyState === 'interactive') {
            // already loaded
            var attempts = 0;
            var timer = setInterval(function() {
              if (findVideo() || attempts > 30) { // 15 seconds max
                clearInterval(timer);
              }
              attempts++;
            }, 500);
          } else {
            window.addEventListener('load', function() {
              findVideo();
              var attempts = 0;
              var timer = setInterval(function() {
                if (findVideo() || attempts > 30) {
                  clearInterval(timer);
                }
                attempts++;
              }, 500);
            });
          }
        })();
      </script>
    `;

    html = html.replace('</body>', injectedScript + '</body>');

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('Embed proxy error:', err.message);
    res.status(500).send('Failed to load embed page');
  }
});

// ---------- FETCH PROXY (serve any resource) ----------
app.get('/fetch-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    // Allow CORS for any resource
    res.set('Access-Control-Allow-Origin', '*');
    response.data.pipe(res);
  } catch (err) {
    res.status(500).send('Fetch error');
  }
});

// ---------- DIRECT PROXY (fallback) ----------
app.get('/proxy', async (req, res) => {
  // ... (your existing /proxy code) ...
});

// ... other routes

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
