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

// ---------- EXTRACTION LOGIC PER PROVIDER ----------
async function extractVSembed(html) {
  const $ = cheerio.load(html);
  let videoUrl = $('video source').first().attr('src');
  if (videoUrl) return videoUrl;

  const scriptMatch = html.match(/source\s*:\s*['"]([^'"]+)['"]/);
  if (scriptMatch) return scriptMatch[1];

  const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  if (linkMatch) return linkMatch[0];

  return null;
}

async function extractVidsrcme(html) {
  const $ = cheerio.load(html);
  const iframeSrc = $('iframe').first().attr('src');
  if (iframeSrc) {
    try {
      const resp = await axios.get(iframeSrc);
      return await extractGeneric(resp.data);
    } catch (e) { /* ignore */ }
  }
  const match = html.match(/file\s*:\s*['"]([^'"]+)['"]/);
  if (match) return match[1];
  return await extractGeneric(html);
}

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
      videoUrl = await extractVSembed(html);
    } else if (srcLower.includes('vidsrcme')) {
      videoUrl = await extractVidsrcme(html);
    } else {
      videoUrl = await extractGeneric(html);
    }

    if (!videoUrl) {
      // Return detailed error with a snippet of the HTML
      console.error('No video URL found in page, returning debug info');
      return res.status(404).json({
        error: 'No video URL found',
        embedUrl,
        pageTitle: html.match(/<title>(.*?)<\/title>/i)?.[1] || 'no title',
        snippet: html.substring(0, 1000)
      });
    }

    console.log(`Found: ${videoUrl}`);

    // Stream the video back to the client
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
