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

    const iframeSrc = extractIframeSrc(html);
    if (!iframeSrc) {
      const directVideo = extractVideoFromPage(html);
      if (directVideo) return res.json({ videoUrl: directVideo });
      return res.status(404).json({
        error: 'No iframe or video found',
        snippet: html.substring(0, 1000)
      });
    }

    console.log(`[Extract] Found nested iframe: ${iframeSrc}`);
    const iframeUrl = iframeSrc.startsWith('http') ? iframeSrc : new URL(iframeSrc, embedUrl).href;
    const { data: iframeHtml } = await axios.get(iframeUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const videoUrl = extractVideoFromPage(iframeHtml);
    if (!videoUrl) {
      return res.status(404).json({
        error: 'No video found in nested iframe',
        iframeUrl,
        snippet: iframeHtml.substring(0, 1000)
      });
    }

    console.log(`[Extract] Success! Video URL: ${videoUrl}`);
    res.json({ videoUrl });
  } catch (err) {
    console.error('[Extract] Error:', err.message);
    res.status(500).json({ error: 'Extraction failed', details: err.message });
  }
});
