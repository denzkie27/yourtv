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
  if (s.includes('embed2')) {
    return season
      ? `https://www.2embed.cc/embedtv/${id}&s=${season}&e=${episode}`
      : `https://www.2embed.cc/embed/${id}`;
  }
  return null;
}

// Extract video from 2embed page
async function extract2embed(html, embedUrl) {
  const $ = cheerio.load(html);
  
  // 2embed usually has an iframe with the real player
  const iframeSrc = $('iframe').first().attr('src');
  if (iframeSrc) {
    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
    console.log(`  2embed iframe: ${iframeUrl}`);
    try {
      const iframeHtml = (await axios.get(iframeUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })).data;
      const $iframe = cheerio.load(iframeHtml);
      // Common video sources
      let videoUrl = $iframe('video source').first().attr('src');
      if (!videoUrl) {
        // Look for any m3u8 / mp4 / mpd link
        const linkMatch = iframeHtml.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
        if (linkMatch) videoUrl = linkMatch[0];
      }
      if (videoUrl) return videoUrl;
    } catch (e) { /* ignore */ }
  }

  // Fallback: direct regex on the main page
  const directMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
  return directMatch ? directMatch[0] : null;
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

    if (source.includes('embed2')) {
      videoUrl = await extract2embed(html, embedUrl);
    } else {
      // Keep existing extractors for other sources (vsembed, vidsrcme)
      const $ = cheerio.load(html);
      videoUrl = $('video source').first().attr('src');
      if (!videoUrl) {
        const scriptMatch = html.match(/source\s*:\s*['"]([^'"]+)['"]/);
        if (scriptMatch) videoUrl = scriptMatch[1];
      }
      if (!videoUrl) {
        const linkMatch = html.match(/(https?:\/\/[^"'\s]+\.(?:mp4|m3u8|mpd)[^"'\s]*)/i);
        if (linkMatch) videoUrl = linkMatch[0];
      }
    }

    if (!videoUrl) {
      console.error('No video URL found, returning debug info');
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

app.get('/', (req, res) => res.send('Video Ad Proxy is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
