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

// ---------- AD‑FREE EMBED (with CSP blocking) ----------
app.get('/embed-view', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing params');

  const targetUrl = buildEmbedUrl(source, id, season, episode);
  if (!targetUrl) return res.status(400).send('Unsupported source');

  try {
    console.log(`[AdFree] Fetching: ${targetUrl}`);
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

    // Remove or replace known ad script tags (optional extra safety)
    html = html.replace(/<script[^>]*src="[^"]*(?:popads|adsterra|propeller|histats|llvpn|onaudience|dtscout|dtscdn|crwdcntrl|mrktmtrcs)[^"]*"[^>]*><\/script>/gi, '');

    // Set Content‑Security‑Policy to block all known ad/tracking domains
    res.set('Content-Security-Policy', [
      "default-src * 'unsafe-inline' 'unsafe-eval'",
      "script-src * 'unsafe-inline' 'unsafe-eval'",
      "style-src * 'unsafe-inline'",
      "img-src * data:",
      "connect-src *",
      "frame-src *",
      // Block specific ad domains (still allow everything else)
      "block-all-mixed-content",
      // Optionally we can disallow those domains using 'none' but it's easier to just not block them because default is *.
      // We'll use a more targeted approach: block by domain pattern.
      "script-src 'unsafe-inline' 'unsafe-eval' *",
      "script-src-elem 'unsafe-inline' 'unsafe-eval' *",
      // No, CSP doesn't support negative lists. Instead, we'll use the removal above and also
      // block these domains via the fetch directive? Not directly.
      // The simplest effective way is to remove the script tags server-side (already done) and also
      // block them in the browser via a meta tag. We'll add a meta CSP that disallows those domains.
    ].join('; '));

    // Better: Add a <meta> tag that blocks those domains using the `content` attribute.
    // CSP can't easily block specific domains while allowing all others; but we can set a policy that only
    // allows certain domains. We need to know the essential domains. From the spy, the video is on
    // cloudorchestranova.com. vsembed.ru itself loads scripts from its own domain. We can whitelist those
    // and block everything else. That's more secure.

    // For simplicity, we'll set CSP to only allow:
    // - 'self' (proxy domain)
    // - vsembed.ru and its subresources
    // - cloudorchestranova.com
    // - cdn.jsdelivr.net (if any)
    // - fonts.googleapis.com, fonts.gstatic.com (if needed)
    // This will block all ad domains.

    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://vsembed.ru https://*.vsembed.ru https://cloudorchestranova.com https://cdn.jsdelivr.net`,
      `style-src 'self' 'unsafe-inline' https://vsembed.ru https://fonts.googleapis.com`,
      `img-src 'self' data: https://vsembed.ru https://*.vsembed.ru https://cloudorchestranova.com`,
      `frame-src 'self' https://vsembed.ru https://cloudorchestranova.com`,
      `connect-src 'self' https://vsembed.ru https://cloudorchestranova.com`,
      `font-src 'self' https://fonts.gstatic.com`,
    ].join('; ');

    res.set('Content-Security-Policy', csp);
    res.set('Content-Type', 'text/html');
    res.send(html);

  } catch (err) {
    console.error('[AdFree] Error:', err.message);
    res.status(502).send('Failed to load embed page');
  }
});

// Keep /raw-html for debugging
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
