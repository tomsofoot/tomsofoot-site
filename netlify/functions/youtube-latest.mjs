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

export async function handler() {
  if (!CHANNEL_ID) {
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        error: "La variable YOUTUBE_CHANNEL_ID est absente."
      })
    };
  }

  try {
    const feedUrl =
      `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

    const response = await fetch(feedUrl, {
      headers: {
        "User-Agent": "TomsoFoot/1.0"
      }
    });

    if (!response.ok) {
      throw new Error(
        `YouTube a répondu avec le statut ${response.status}`
      );
    }

    const xml = await response.text();
    const firstEntry = xml.match(/<entry>([\s\S]*?)<\/entry>/i)?.[1];

    if (!firstEntry) {
      return {
        statusCode: 404,
        headers: {
          "Content-Type": "application/json; charset=utf-8"
        },
        body: JSON.stringify({
          error: "Aucune vidéo publique trouvée."
        })
      };
    }

    const videoId = getTagContent(firstEntry, "yt:videoId");
    const title = getTagContent(firstEntry, "title");
    const publishedAt = getTagContent(firstEntry, "published");

    const descriptionMatch = firstEntry.match(
      /<media:description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/media:description>/i
    );

    const description = decodeXml(
      descriptionMatch?.[1]?.trim() || ""
    );

    if (!videoId || !title) {
      throw new Error(
        "Les informations principales de la vidéo sont absentes."
      );
    }

    const video = {
      id: videoId,
      title,
      description,
      publishedAt,
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

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        error: "Impossible de récupérer la dernière vidéo."
      })
    };
  }
}
