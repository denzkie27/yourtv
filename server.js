const express = require('express');
const axios = require('axios');
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

// ---------- SPY EMBED (no ad removal, just reporting) ----------
app.get('/embed-view', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing params');

  const targetUrl = buildEmbedUrl(source, id, season, episode);
  if (!targetUrl) return res.status(400).send('Unsupported source');

  try {
    console.log(`[Spy] Fetching: ${targetUrl}`);
    const response = await axios.get(targetUrl, {
      responseType: 'text',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let html = response.data;
    const baseUrl = new URL(targetUrl);

    // Insert <base> to keep relative URLs working
    html = html.replace('<head>', `<head><base href="${baseUrl.origin}/">`);

    // Inject spy script
    const spyScript = `
      <script>
        (function() {
          function report(tag, url) {
            try {
              const domain = new URL(url, document.baseURI).hostname;
              window.parent.postMessage({ type: 'ad-spy', tag: tag, domain: domain, url: url }, '*');
            } catch(e) {}
          }
          // Observe new elements added to the DOM
          const observer = new MutationObserver(function(mutations) {
            mutations.forEach(function(mutation) {
              mutation.addedNodes.forEach(function(node) {
                if (node.nodeType === 1) {
                  // Check the element itself
                  if (node.tagName === 'SCRIPT' && node.src) report('script', node.src);
                  if (node.tagName === 'IFRAME' && node.src) report('iframe', node.src);
                  if (node.tagName === 'IMG' && node.src) report('img', node.src);
                  if (node.tagName === 'LINK' && node.href && node.rel === 'stylesheet') report('css', node.href);
                  // Also check children
                  node.querySelectorAll('script[src], iframe[src], img[src], link[rel="stylesheet"]').forEach(function(el) {
                    if (el.tagName === 'SCRIPT' || el.tagName === 'IFRAME' || el.tagName === 'IMG') report(el.tagName.toLowerCase(), el.src);
                    if (el.tagName === 'LINK') report('css', el.href);
                  });
                }
              });
            });
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });

          // Report already loaded elements
          document.querySelectorAll('script[src], iframe[src], img[src], link[rel="stylesheet"]').forEach(function(el) {
            if (el.tagName === 'SCRIPT' || el.tagName === 'IFRAME' || el.tagName === 'IMG') report(el.tagName.toLowerCase(), el.src);
            if (el.tagName === 'LINK') report('css', el.href);
          });

          window.addEventListener('load', function() {
            window.parent.postMessage({ type: 'ad-spy-done' }, '*');
          });
        })();
      </script>
    `;

    html = html.replace('</body>', spyScript + '</body>');

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    console.error('[Spy] Error:', err.message);
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
