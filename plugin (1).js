// ============================================================
//  Plugin Cuevana3a para Zynora (v1.0.0)
// ============================================================
const WEB = "https://cuevana3a.pro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  return u[0] === "/" ? WEB + u : WEB + "/" + u;
}

function pedir(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es-419,es;q=0.9", "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) h.Referer = referer;
  return zynora.fetch(url, { headers: h });
}

function leerTarjetas(html) {
  const out = [];
  // Adaptar el selector según la estructura real de las tarjetas del sitio
  // Por ejemplo, buscando enlaces a /pelicula/ o /serie/
  for (const a of zynora.html.select(html, 'a[href*="/pelicula/"], a[href*="/serie/"]')) {
    const href = String(a.attrs.href || "");
    const isSerie = href.indexOf("/serie/") >= 0;
    const kind = isSerie ? "series" : "movie";
    
    // Extraer ID (slug o número) de la URL
    const match = href.match(/\/(?:pelicula|serie)\/([^/?#]+)/);
    if (!match) continue;
    const idStr = match[1];
    
    const t = String(a.text || "").trim();
    if (!t) continue;
    
    // Buscar imagen si está dentro o cerca
    let poster = "";
    const img = zynora.html.select(a.html, "img")[0];
    if (img) {
      poster = img.attrs["data-src"] || img.attrs["src"] || "";
    }

    out.push({
      id: "c3-" + idStr,
      ref: abs(href),
      title: t,
      kind: kind,
      year: "", // Llenar si es posible extraerlo del nodo
      poster: abs(poster)
    });
  }
  return out;
}

export async function search(q) {
  const queryText = encodeURIComponent(q.q);
  const r = await pedir(WEB + "/explorar?s=" + queryText);
  if (!r.ok) return [];
  return leerTarjetas(r.text());
}

export async function home() {
  const r = await pedir(WEB + "/");
  if (!r.ok) return [];
  const html = r.text();
  
  const tarjetas = leerTarjetas(html);
  
  // Separar en filas para la pestaña principal
  const pelis = tarjetas.filter(x => x.kind === "movie");
  const series = tarjetas.filter(x => x.kind === "series");
  
  const filas = [];
  if (pelis.length) filas.push({ id: "c3-movies", title: "Películas Recientes", items: pelis.slice(0, 20) });
  if (series.length) filas.push({ id: "c3-series", title: "Series Recientes", items: series.slice(0, 20) });
  
  return filas;
}

export async function episodes(ref) {
  const r = await pedir(ref, WEB + "/");
  if (!r.ok) throw zynora.error("not_found", "No se pudo cargar la ficha");
  const html = r.text();
  const eps = [];
  
  // Buscar los enlaces a los episodios del show
  // Generalmente siguen un patrón tipo /episodio/ o se listan en un contenedor de temporadas
  for (const a of zynora.html.select(html, 'a[href*="/episodio/"]')) {
    const url = abs(a.attrs.href);
    const texto = String(a.text || "").trim();
    
    // Intentar deducir temporada y capítulo del texto o URL (ej: "1x03" o "Capítulo 3")
    let season = 1;
    let number = 1;
    const m = texto.match(/(\d+)\s*[xX-]\s*(\d+)/) || url.match(/episodio\/.*-(\d+)-(\d+)/);
    if (m) {
      season = Number(m[1]);
      number = Number(m[2]);
    }
    
    eps.push({
      ref: url,
      season: season,
      number: number,
      title: texto
    });
  }
  
  // Si la referencia ya es una película, devolvemos un único episodio ficticio que representa la película completa
  if (ref.indexOf("/pelicula/") >= 0) {
    return { episodes: [{ ref: ref, season: 1, number: 1, title: "Ver Película" }] };
  }
  
  return { episodes: eps };
}

export async function resolve(ref) {
  const r = await pedir(ref, WEB + "/");
  if (!r.ok) throw zynora.error("not_found", "Contenido no disponible");
  const html = r.text();
  
  // 1. Buscar iframes embebidos o enlaces a reproductores habituales en Cuevana (Fembed, Streamwish, Voex, Ok.ru, etc.)
  let embedUrl = "";
  for (const f of zynora.html.select(html, "iframe")) {
    const u = f.attrs["data-src"] || f.attrs.src || "";
    if (u && (u.indexOf("https://") === 0 || u.indexOf("//") === 0)) {
      embedUrl = abs(u);
      break;
    }
  }
  
  if (!embedUrl) {
    // Buscar en expresiones regulares de la página si los reproductores se cargan mediante botones o pestañas alternas
    const m = html.match(/https?:\/\/[^\s"'<>]+(?:streamwish|fembed|voex|ok\.ru)[^\s"'<>]+/i);
    if (m) embedUrl = m[0];
  }
  
  if (!embedUrl) throw zynora.error("not_found", "No se encontró ningún servidor de video disponible");
  
  // Intentar obtener el video directo del embed usando un agente de PC
  const rEmbed = await zynora.fetch(embedUrl, {
    headers: { "User-Agent": UA, "Referer": ref }
  });
  
  if (rEmbed.ok) {
    const txt = rEmbed.text();
    // Reutilizar lógica genérica de extracción de archivos de video .mp4 o listas .m3u8 (HLS)
    const mVideo = txt.match(/(https?:\/\/[^\s"'\\<>]+?\.(?:mp4|m3u8)(?:\?[^\s"'\\<>]*)?)/i);
    if (mVideo) {
      const salida = { url: mVideo[0], headers: { Referer: embedUrl, "User-Agent": UA } };
      if (mVideo[0].indexOf(".m3u8") >= 0) salida.mime = "application/x-mpegURL";
      else salida.mime = "video/mp4";
      return salida;
    }
  }
  
  // Si no se puede extraer de forma nativa, se puede devolver la URL del iframe para que el reproductor interno la maneje si es compatible
  return { url: embedUrl, headers: { Referer: ref, "User-Agent": UA } };
}
