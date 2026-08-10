# Video Ad Proxy

A Node.js proxy that extracts the raw video URL from ad‑heavy third‑party players (Vsembed, VidSrcMe, etc.) and streams it directly – removing all pop‑ups, scripts, and ads.

## How to Deploy (Render)

1. **Fork/Clone this repository** to your own GitHub account.
2. Go to [Render.com](https://render.com) and create a new **Web Service**.
3. Connect your GitHub repository.
4. Set the following:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Deploy. You'll receive a URL like `https://video-ad-proxy.onrender.com`.

## Usage

Call the endpoint with:

`https://<your-app>.onrender.com/proxy?source=vsembed_ru&id=123&season=1&episode=1`

- `source`: one of `vsembed_ru`, `vsembed_su`, `vidsrcme_ru`, `vidsrcme_su`
- `id`: TMDB ID (or site ID)
- `season` & `episode` (optional, for TV series)

It returns the raw video stream (MP4/HLS/DASH) that you can feed directly into a `<video>` element.

## Maintenance

Extractors may break if the source sites change. You'll need to update the `extract*` functions accordingly. Contributions welcome!
