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

// ---------- EMBED PROXY ----------
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

    // Enhanced injected script with error reporting and parent messaging
    const injectedScript = `
      <script>
        (function() {
          function postDebug(msg, isError) {
            window.parent.postMessage({ type: 'debug', message: msg, error: !!isError }, '*');
          }
          // Catch global errors
          window.onerror = function(message, source, lineno, colno, error) {
            postDebug('JS error: ' + message + ' at ' + source + ':' + lineno, true);
          };
          postDebug('Script loaded');

          function findVideo() {
            var video = document.querySelector('video');
            if (video && video.src && video.src.startsWith('http')) {
              postDebug('Found video element: ' + video.src);
              window.parent.postMessage({ type: 'video-ready', src: video.src }, '*');
              return true;
            }
            var source = document.querySelector('video source');
            if (source && source.src && source.src.startsWith('http')) {
              postDebug('Found video source: ' + source.src);
              window.parent.postMessage({ type: 'video-ready', src: source.src }, '*');
              return true;
            }
            // Also check for any iframes that might contain the player
            var iframes = document.querySelectorAll('iframe');
            postDebug('Found ' + iframes.length + ' iframes on page');
            return false;
          }

          function waitForVideo() {
            if (findVideo()) return;
            setTimeout(waitForVideo, 800);
          }

          if (document.readyState === 'complete') {
            postDebug('Document already complete');
            waitForVideo();
          } else {
            window.addEventListener('load', function() {
              postDebug('Document loaded');
              waitForVideo();
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

// ---------- FETCH PROXY ----------
app.get('/fetch-proxy', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send('Missing url');

  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const contentType = response.headers['content-type'] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.set('Access-Control-Allow-Origin', '*');
    response.data.pipe(res);
  } catch (err) {
    console.error('Fetch proxy error for', url, err.message);
    res.status(502).send('Resource fetch failed');
  }
});

// ---------- DIRECT PROXY (unchanged) ----------
app.get('/proxy', async (req, res) => {
  // ... keep your existing /proxy code ...
});

app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
