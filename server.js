const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
app.use(cors());

// ---------- HELPERS ----------
function buildEmbedUrl(source, id, season, episode) {
  // Normalize source names to lowercase key
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

// ---------- EXTRACTION LOGIC PER PROVIDER ----------
async function extractVSembed(html) {
  const $ = cheerio.load(html);
  // Most common: <video><source src="...">
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;

  // Try finding inside a script (e.g., var source = '...')
  const scriptMatch = html.match(/source\s*:\s*['"]([^'"]+)['"]/);
  if (scriptMatch) return scriptMatch[1];

  // Fallback: look for any .mp4/.m3u8/.mpd link in the page
  const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  if (linkMatch) return linkMatch[0];

  return null;
}

async function extractVidsrcme(html) {
  // Vidsrcme often stores the video URL in a data attribute or JavaScript object
  const $ = cheerio.load(html);
  // Check for <iframe> to another player
  const iframeSrc = $('iframe').first().attr('src');
  if (iframeSrc) {
    // Follow the iframe and try to extract from there (recursive)
    try {
      const resp = await axios.get(iframeSrc);
      return await extractGeneric(resp.data);
    } catch (e) { /* ignore */ }
  }
  // Look for common patterns in scripts
  const match = html.match(/file\s*:\s*['"]([^'"]+)['"]/);
  if (match) return match[1];
  // Fallback to generic
  return await extractGeneric(html);
}

async function extractGeneric(html) {
  const $ = cheerio.load(html);
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;
  // Scan scripts
  const scriptRegex = /['"](https?:\/\/[^"']+\.(?:mp4|m3u8|mpd)[^"']*)['"]/gi;
  const matches = html.match(scriptRegex);
  if (matches) return matches[0].replace(/['"]/g, '');
  return null;
}

// ---------- ROUTES ----------
app.get('/proxy', async (req, res) => {
  const { source, id, season, episode } = req.query;
  if (!source || !id) return res.status(400).send('Missing source or id');

  const embedUrl = buildEmbedUrl(source, id, season, episode);
  if (!embedUrl) return res.status(400).send('Unsupported source');

  try {
    console.log(`Fetching embed: ${embedUrl}`);
    const { data: html } = await axios.get(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    let videoUrl = null;
    const srcLower = source.toLowerCase();

    // Choose extractor based on source
    if (srcLower.includes('vsembed')) {
      videoUrl = await extractVSembed(html);
    } else if (srcLower.includes('vidsrcme')) {
      videoUrl = await extractVidsrcme(html);
    } else {
      videoUrl = await extractGeneric(html);
    }

    if (!videoUrl) {
      return res.status(404).send('No video URL found');
    }

    console.log(`Found: ${videoUrl}`);

    // Stream the video back to the client (proxied)
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
    res.status(500).send('Proxy error');
  }
});

// Health check
app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
