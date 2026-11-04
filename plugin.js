// ============================================================
//  Plugin Cuevana3a para Zynora (v1.0.3) - VERSIÓN CORREGIDA
// ============================================================
const WEB = "https://cuevana3a.pro";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (/^https?:\/\//i.test(u)) return u;
  return u === "/" ? WEB + u : WEB + "/" + u;
}

function pedir(url, referer) {
  const h = { "User-Agent": UA, "Accept-Language": "es-419,es;q=0.9", "Accept": "text/html,application/xhtml+xml,*/*" };
  if (referer) h.Referer = referer;
  return zynora.fetch(url, { headers: h });
}

function limpiarTitulo(textoBruto) {
  let t = String(textoBruto || "").trim();
  let anio = "";
  
  t = t.replace(/^(?:PELÍCULA|SERIE|Pelicula|Serie)\s*/i, "");
  
  const mAnioInicio = t.match(/^(\d{4})\s*(.*)$/);
  if (mAnioInicio) {
    anio = mAnioInicio[1];
    t = mAnioInicio[2].trim();
  }
  
  t = t.replace(/^(?:PELÍCULA|SERIE|Pelicula|Serie)\s*/i, "");
  return { title: t, year: anio };
}

function leerTarjetas(html) {
  const out = [];
  for (const a of zynora.html.select(html, 'a[href*="/pelicula/"], a[href*="/serie/"]')) {
    const href = String(a.attrs.href || "");
    const isSerie = href.indexOf("/serie/") >= 0;
    const kind = isSerie ? "series" : "movie";
    
    const match = href.match(/\/(?:pelicula|serie)\/([^/?#]+)/);
    if (!match) continue;
    const idStr = match[1];
    
    const textoNodo = String(a.text || "").trim();
    if (!textoNodo) continue;
    
    const infoLimpia = limpiarTitulo(textoNodo);
    
    let poster = "";
    const img = zynora.html.select(a.html, "img")[0];
    if (img) {
      poster = img.attrs["data-src"] || img.attrs["src"] || "";
    }

    out.push({
      id: "c3-" + idStr,
      ref: abs(href),
      title: infoLimpia.title,
      kind: kind,
      year: infoLimpia.year,
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
  
  for (const a of zynora.html.select(html, 'a[href*="/episodio/"]')) {
    const url = abs(a.attrs.href);
    const texto = String(a.text || "").trim();
    
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
  
  if (ref.indexOf("/pelicula/") >= 0) {
    return { episodes: [{ ref: ref, season: 1, number: 1, title: "Ver Película" }] };
  }
  
  return { episodes: eps };
}

export async function resolve(ref) {
  const r = await pedir(ref, WEB + "/");
  if (!r.ok) throw zynora.error("not_found", "Contenido no disponible");
  const html = r.text();
  
  let embedUrl = "";
  for (const f of zynora.html.select(html, "iframe")) {
    const u = f.attrs["data-src"] || f.attrs.src || "";
    if (u && (u.indexOf("https://") === 0 || u.indexOf("//") === 0)) {
      embedUrl = abs(u);
      break;
    }
  }
  
  if (!embedUrl) {
    const m = html.match(/https?:\/\/[^\s"'<>]+(?:streamwish|fembed|voex|ok\.ru)[^\s"'<>]+/i);
    if (m) embedUrl = m[0];
  }
  
  if (!embedUrl) throw zynora.error("not_found", "No se encontró ningún servidor de video disponible");
  
  const rEmbed = await zynora.fetch(embedUrl, {
    headers: { "User-Agent": UA, "Referer": ref }
  });
  
  if (rEmbed.ok) {
    const txt = rEmbed.text();
    const mVideo = txt.match(/(https?:\/\/[^\s"'\\<>]+?\.mp4(?:\?[^\s"'\\<>.]*)?)/i) || txt.match(/(https?:\/\/[^\s"'\\<>]+?\.m3u8(?:\?[^\s"'\\<>.]*)?)/i);
    if (mVideo) {
      const salida = { url: mVideo[0], headers: { Referer: embedUrl, "User-Agent": UA } };
      if (mVideo[0].indexOf(".m3u8") >= 0) salida.mime = "application/x-mpegURL";
      else salida.mime = "video/mp4";
      return salida;
    }
  }
  
  return { url: embedUrl, headers: { Referer: ref, "User-Agent": UA } };
}
