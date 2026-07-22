const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

function decodeXml(value = "") {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function getTagContent(xml, tag) {
  const escapedTag = tag.replace(":", "\\:");
  const expression = new RegExp(
    `<${escapedTag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${escapedTag}>`,
    "i"
  );
  return decodeXml(xml.match(expression)?.[1]?.trim() || "");
}

function formatDuration(totalSeconds) {
  const s = Number(totalSeconds);
  if (!Number.isFinite(s) || s <= 0) return null;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = Math.floor(s % 60);
  const pad = (n) => String(n).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`;
}

// La duree n'est pas dans le flux RSS : on la recupere au mieux depuis la page video.
async function fetchDurationSeconds(videoId) {
  try {
    const response = await fetch(
      `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US&has_verified=1`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36",
          "Accept-Language": "en-US,en;q=0.9"
        }
      }
    );
    if (!response.ok) return null;
    const html = await response.text();

    const direct = html.match(/"lengthSeconds":\s*"(\d+)"/);
    if (direct) return Number(direct[1]);

    const ms = html.match(/"approxDurationMs":\s*"(\d+)"/);
    if (ms) return Math.round(Number(ms[1]) / 1000);

    const iso = html.match(/itemprop="duration"\s+content="(PT[0-9HMS]+)"/);
    if (iso) {
      const chunks = iso[1].match(/\d+[HMS]/g) || [];
      let total = 0;
      for (const chunk of chunks) {
        const n = parseInt(chunk, 10);
        if (chunk.endsWith("H")) total += n * 3600;
        else if (chunk.endsWith("M")) total += n * 60;
        else if (chunk.endsWith("S")) total += n;
      }
      return total || null;
    }
    return null;
  } catch (error) {
    return null;
  }
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  };
}

export async function handler() {
  if (!CHANNEL_ID) {
    return json(500, { error: "La variable YOUTUBE_CHANNEL_ID est absente." });
  }

  try {
    const feedUrl =
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

    const response = await fetch(feedUrl, {
      headers: { "User-Agent": "TomsoFoot/1.0" }
    });

    if (!response.ok) {
      throw new Error(`YouTube a répondu avec le statut ${response.status}`);
    }

    const xml = await response.text();
    const firstEntry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];

    if (!firstEntry) {
      return json(404, { error: "Aucune vidéo publique trouvée." });
    }

    const videoId = getTagContent(firstEntry, "yt:videoId");
    const title = getTagContent(firstEntry, "title");
    const publishedAt = getTagContent(firstEntry, "published");

    const descriptionMatch = firstEntry.match(
      /<media:description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/media:description>/i
    );
    const description = decodeXml(descriptionMatch?.[1]?.trim() || "");

    if (!videoId || !title) {
      throw new Error("Les informations principales de la vidéo sont absentes.");
    }

    const durationSeconds = await fetchDurationSeconds(videoId);
    const duration = formatDuration(durationSeconds);

    const video = {
      id: videoId,
      title,
      description,
      publishedAt,
      duration,
      durationSeconds: durationSeconds || null,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`,
      thumbnail: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      fallbackThumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control":
          "public, max-age=300, s-maxage=900, stale-while-revalidate=3600"
      },
      body: JSON.stringify(video)
    };
  } catch (error) {
    console.error("Erreur YouTube :", error);
    return json(500, { error: "Impossible de récupérer la dernière vidéo." });
  }
}
