'use strict';
/*
 * lib/article.js — render-time helpers for the premium /guides/:slug template
 * (Redesign Phase 2; specs 06 structure, 07 internal linking slots, 08 official
 * sources, 09 Discord hook). Every function is a pure string/data transform over
 * ONE article's HTML at request time. Stored content is never edited; the
 * database stays byte-identical.
 */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function cleanKeyword(kw) {
  return String(kw || '').replace(/[\u200B\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
}
function capFirst(s) {
  const t = String(s || '');
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}
function wordCount(html) {
  const t = stripTags(html);
  return t ? t.split(' ').filter(Boolean).length : 0;
}

/* ---------- spec 06 §7: intro/body split + §6b lead tagging ---------- */

function splitIntro(html) {
  const src = String(html || '');
  const i = src.search(/<h2[\s>]/i);
  if (i === -1) return { intro: src, body: '', hasH2: false };
  let intro = src.slice(0, i);
  let body = src.slice(i);
  if (wordCount(intro) > 140) {
    // Cap rule: split after the 2nd </p> so the Discord slot stays near the top.
    let idx = -1;
    let from = 0;
    for (let n = 0; n < 2; n++) {
      const j = intro.indexOf('</p>', from);
      if (j === -1) break;
      idx = j;
      from = j + 4;
    }
    if (idx !== -1) {
      body = intro.slice(idx + 4) + body;
      intro = intro.slice(0, idx + 4);
    }
  }
  return { intro, body, hasH2: true };
}

function tagLead(intro) {
  const m = intro.match(/<p(\s[^>]*)?>/);
  if (!m) return { html: intro, leadWords: 0 };
  const start = m.index;
  const endP = intro.indexOf('</p>', start);
  const paraHtml = endP === -1 ? '' : intro.slice(start, endP);
  const w = wordCount(paraHtml);
  const cls = w >= 40 ? 'ax-lead ax-lead-cap' : 'ax-lead';
  let tag;
  if (m[1] && /class\s*=/.test(m[1])) {
    tag = m[0].replace(/class="([^"]*)"/, `class="$1 ${cls}"`).replace(/class='([^']*)'/, `class='$1 ${cls}'`);
  } else {
    tag = `<p class="${cls}"${m[1] || ''}>`;
  }
  return { html: intro.slice(0, start) + tag + intro.slice(start + m[0].length), leadWords: w };
}

/* ---------- spec 06 §9/§10: TOC with render-time heading ids ---------- */

function slugifyHeading(text, used) {
  let base = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  if (!base) base = 'section';
  let id = base;
  let n = 2;
  while (used.has(id)) { id = `${base}-${n++}`; }
  used.add(id);
  return id;
}

function buildToc(html) {
  const entries = [];
  const used = new Set();
  const out = String(html || '').replace(/<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi, (m, lvl, attrs, inner) => {
    attrs = attrs || '';
    const text = stripTags(inner);
    if (!text) return m;
    const existing = attrs.match(/\bid\s*=\s*"([^"]+)"/);
    if (existing) {
      used.add(existing[1]);
      entries.push({ level: +lvl, text, id: existing[1] });
      return m;
    }
    const id = slugifyHeading(text, used);
    entries.push({ level: +lvl, text, id });
    return `<h${lvl} id="${id}"${attrs}>${inner}</h${lvl}>`;
  });
  return { html: out, entries };
}

function tocListHtml(entries) {
  return '<ul>' + entries.map(e =>
    `<li class="ax-toc-l${e.level}"><a href="#${e.id}">${e.text}</a></li>`).join('') + '</ul>';
}

/* ---------- spec 06 §11/§14: verbatim takeaways + pull-quote ---------- */

function splitSentences(text) {
  return String(text || '').split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function extractTakeaways(plainText) {
  const sents = splitSentences(plainText);
  const items = [];
  const seen = new Set();
  const tryAdd = (s) => {
    const key = s.toLowerCase();
    if (seen.has(key) || s.length < 40 || s.length > 200) return;
    seen.add(key);
    items.push(s);
  };
  for (const s of sents) { if (items.length >= 3) break; if (s.includes('✅')) tryAdd(s); }
  if (items.length < 2) {
    for (const s of sents) { if (items.length >= 3) break; if (s.includes('🎬')) tryAdd(s); }
  }
  return { items, used: seen };
}

function pickPullQuote(plainText, usedSet) {
  for (const s of splitSentences(plainText)) {
    if (!s.includes('✅')) continue;
    if (s.length < 60 || s.length > 180) continue;
    if (usedSet && usedSet.has(s.toLowerCase())) continue;
    return s;
  }
  return null;
}

/* ---------- spec 06 §13: evidence badges in text nodes only ---------- */

function badgeEvidence(html) {
  // Only whitespace-delimited emoji tokens are badged: an emoji glued to a word
  // (e.g. "2026✅" or "(✅)") must stay raw, otherwise wrapping it in a span
  // would split one word-token into two and change the article's word count.
  const parts = String(html || '').split(/(<[^>]+>)/g);
  for (let i = 0; i < parts.length; i += 2) {
    if (!parts[i]) continue;
    parts[i] = parts[i].replace(/(?<=^|\s)(✅|🎬|❓)(?=\s|$)/g, (m) => {
      const cls = m === '✅' ? 'ax-ev ax-ev-yes' : m === '🎬' ? 'ax-ev ax-ev-trailer' : 'ax-ev ax-ev-unannounced';
      const ttl = m === '✅' ? 'Rockstar-confirmed' : m === '🎬' ? 'Seen in official trailers' : 'Not yet announced';
      return `<span class="${cls}" title="${ttl}">${m}</span>`;
    });
  }
  return parts.join('');
}

/* ---------- spec 06 §12: lazy in-content images (attributes only) ---------- */

function lazyImages(html) {
  return String(html || '').replace(/<img(\s[^>]*)?>/gi, (m, attrs) => {
    attrs = attrs || '';
    let out = '<img' + attrs;
    if (!/\bloading\s*=/.test(attrs)) out += ' loading="lazy"';
    if (!/\bdecoding\s*=/.test(attrs)) out += ' decoding="async"';
    return out + '>';
  });
}

/* ---------- spec 06 §16: FAQ accordion (lossless) + pair extraction ---------- */

const FAQ_HEAD_RE = /faq|frequently asked|häufige fragen|preguntas frecuentes|perguntas frequentes|questions fréquentes|veelgestelde vragen|najczęściej zadawane|domande frequenti|common questions|your questions|quick answers|respuestas rápidas|perguntas rápidas/i;
const SOURCES_HEAD_RE = /sources|fontes|quellen|fuentes|bronnen|źródła|zrodla|fonti|how we source|where this information comes from|metodolog|methodolog|how we label|come etichettiamo|wie wir kennzeichnen|como rotulamos/i;

function headingMatches(html) {
  const out = [];
  const re = /<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ start: m.index, end: m.index + m[0].length, text: stripTags(m[2]) });
  }
  return out;
}

function isQuestionStrong(innerHtml) {
  const t = stripTags(innerHtml);
  return t.length > 0 && t.length <= 300 && (t.endsWith('?') || /^Q\s*[:.]/i.test(t));
}

function transformFaqSection(sectionHtml, pairs) {
  // Tokenize into <p>...</p> units and the raw segments between them.
  const segments = sectionHtml.split(/(<p>[\s\S]*?<\/p>)/g).filter(s => s !== '');
  const prose = [];
  const items = [];
  let current = null;
  const closeCurrent = () => {
    if (!current) return;
    if (current.a.length) items.push(current);
    else prose.push(`<p><strong>${current.q}</strong></p>`);
    current = null;
  };
  for (const seg of segments) {
    const pInner = seg.match(/^<p>([\s\S]*?)<\/p>$/);
    if (pInner) {
      const inner = pInner[1].trim();
      // Type B: one paragraph holding <strong>Q</strong><br>A
      const typeB = inner.match(/^<strong>([\s\S]*?)<\/strong>\s*<br\s*\/?>([\s\S]*)$/);
      if (typeB && isQuestionStrong(typeB[1])) {
        closeCurrent();
        items.push({ q: typeB[1], a: [`<p>${typeB[2]}</p>`] });
        continue;
      }
      // Type A: paragraph consisting solely of a <strong> question
      const typeA = inner.match(/^<strong>([\s\S]*?)<\/strong>$/);
      if (typeA && isQuestionStrong(typeA[1])) {
        closeCurrent();
        current = { q: typeA[1], a: [] };
        continue;
      }
    }
    if (current) current.a.push(seg);
    else prose.push(seg);
  }
  closeCurrent();
  if (!items.length) return sectionHtml;
  for (const it of items) {
    pairs.push({ q: stripTags(it.q), a: stripTags(it.a.join(' ')) });
  }
  const accordion = items.map(it =>
    `<div class="ax-faq-item"><h3 class="ax-faq-q"><button type="button" aria-expanded="false">${it.q}</button></h3><div class="ax-faq-a">${it.a.join('')}</div></div>`
  ).join('');
  return prose.join('') + accordion;
}

function transformFaq(html) {
  const src = String(html || '');
  const heads = headingMatches(src);
  const pairs = [];
  if (!heads.length) return { html: src, pairs };
  let out = '';
  let cursor = 0;
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const sectionEnd = i + 1 < heads.length ? heads[i + 1].start : src.length;
    out += src.slice(cursor, h.end);
    const section = src.slice(h.end, sectionEnd);
    out += FAQ_HEAD_RE.test(h.text) ? transformFaqSection(section, pairs) : section;
    cursor = sectionEnd;
  }
  out += src.slice(cursor);
  return { html: out, pairs };
}

/* ---------- slot insertion helpers (spec 06 §14/§15, spec 08 §17 anchor) ---------- */

function insertPullQuote(html, sentence) {
  const heads = headingMatches(html);
  const block = `<!--ax:pull--><aside class="ax-pull">${badgeEvidence(sentence)}</aside><!--/ax:pull-->`;
  if (heads.length >= 3) {
    const at = heads[2].start; // end of the 2nd H2 section
    return html.slice(0, at) + block + html.slice(at);
  }
  return html + block;
}

function insertContinueStrip(html, stripHtml) {
  // After the first </p> following the Nth </h2> (task: N=3; fallbacks 2, 1).
  for (const n of [3, 2, 1]) {
    const heads = headingMatches(html);
    if (heads.length < n) continue;
    const afterH2 = heads[n - 1].end;
    const pEnd = html.indexOf('</p>', afterH2);
    if (pEnd === -1) continue;
    return html.slice(0, pEnd + 4) + stripHtml + html.slice(pEnd + 4);
  }
  return html;
}

function insertSourcesBlock(html, blockHtml) {
  const heads = headingMatches(html);
  let target = -1;
  for (let i = 0; i < heads.length; i++) {
    if (SOURCES_HEAD_RE.test(heads[i].text)) target = i;
  }
  if (target === -1) return html + blockHtml;
  const at = target + 1 < heads.length ? heads[target + 1].start : html.length;
  return html.slice(0, at) + blockHtml + html.slice(at);
}

/* ---------- spec 07 §4.3: de-dup against links already inside the body ---------- */

function extractInBodySlugs(content) {
  const out = new Set();
  const html = String(content || '');
  for (const m of html.matchAll(/href="\/guides\/([^"#?]+)"/g)) {
    try { out.add(decodeURIComponent(m[1])); } catch (_) { out.add(m[1]); }
  }
  for (const m of html.matchAll(/href="#blog\/([^"]+)"/g)) {
    try { out.add(decodeURIComponent(m[1])); } catch (_) { out.add(m[1]); }
  }
  return out;
}

/* ---------- spec 09 §3: language detection (slug rules → stopwords → EN) ---------- */

const SLUG_LANG_RULES = [
  ['pl', /wymagania|kiedy|ile-kosztuje|plyta|jak-|czy-|bedzie/],
  ['pt', /codigo-de|codigos-do|-no-gta|o-que|armas|fontes/],
  ['es', /cuanto|cuando|cuesta|fecha|lanzamiento|cuando-sale/],
  ['de', /karte|grafik|quellen|wann|wie-viel|kosten/],
  ['nl', /bronnen|wanneer|hoeveel|verschijningsdatum/],
  ['fr', /quand|combien|sortie|prix-de/],
];
const HOOK_STOPWORDS = {
  es: ['el', 'la', 'los', 'las', 'qué', 'cuánto', 'también', 'según'],
  pt: ['o', 'a', 'os', 'as', 'não', 'também', 'você', 'ção'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'für', 'mit'],
  fr: ['le', 'la', 'les', 'des', 'est', 'pour', 'avec', 'dans'],
  nl: ['de', 'het', 'een', 'van', 'is', 'niet', 'voor', 'met'],
  pl: ['i', 'w', 'nie', 'się', 'jest', 'na', 'do', 'czy'],
  en: ['the', 'is', 'and', 'of', 'to', 'for', 'with', 'on'],
};

function detectLang(blog) {
  if (blog && blog.lang) return String(blog.lang).slice(0, 2).toLowerCase();
  const slug = String((blog && blog.slug) || '');
  for (const [lang, re] of SLUG_LANG_RULES) if (re.test(slug)) return lang;
  const text = (stripTags(blog && blog.content).slice(0, 1500) + ' ' + String((blog && blog.title) || '')).toLowerCase();
  const words = text.split(/[^\p{L}]+/u).filter(Boolean);
  const scores = {};
  for (const [lang, stops] of Object.entries(HOOK_STOPWORDS)) {
    const set = new Set(stops);
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    scores[lang] = n;
  }
  // Diacritic signals (spec 09 §3.3)
  if (/[ñ¿¡]/.test(text)) scores.es += 3;
  if (/[ãõç]/.test(text)) scores.pt += 3;
  if (/[ąćłńśźż]/.test(text)) scores.pl += 3;
  if (/ß/.test(text)) scores.de += 3;
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted[0] && sorted[0][1] > 0 && sorted[0][1] > (sorted[1] ? sorted[1][1] : 0)) return sorted[0][0];
  return 'en';
}

/* ---------- spec 09 §2b/§3: Discord START hook copy ---------- */

const HOOK_EYEBROW = 'GTA6MAPX | STATE OF LEONIDA — OFFICIAL DISCORD';
const HOOK_EN = [
  {
    headline: 'Get the Leonida intel before everyone else.',
    sentence: 'Join the GTA6mapx Discord for trailer breakdown alerts the moment new frames are decoded, live map landmark hunts, and the countdown to launch day — November 19, 2026.',
    bullets: ['🎬 Trailer breakdown alerts', '🗺️ Live map landmark hunts', '⏳ Launch countdown'],
    button: 'Join the Discord',
  },
  {
    headline: "Hunt Leonida's secrets with the people mapping them.",
    sentence: 'Every landmark pinned on this map started as a community find — bring your trailer screenshots, test theories with fellow hunters, and help complete the State of Leonida before launch day, November 19, 2026.',
    bullets: ['🗺️ Live map landmark hunts', '🎬 Trailer breakdown alerts', '⏳ Launch countdown'],
    button: 'Join the Discord',
  },
  {
    headline: 'The first 100 members become the OG-100. Forever.',
    sentence: 'The server is new and the founding cohort is still open — join now, claim the OG-100 role that will never be offered again, and be there from day one of the road to November 19, 2026.',
    bullets: ['🏆 OG-100 founding role', '🎬 Trailer breakdown alerts', '🗺️ Live map landmark hunts'],
    button: 'Join the Discord',
  },
];
const HOOK_V1_I18N = {
  es: {
    headline: 'Consigue la información de Leonida antes que nadie.',
    sentence: 'Únete al Discord de GTA6mapx para recibir alertas de análisis de tráilers en cuanto se descifren nuevos fotogramas, participar en cacerías de lugares emblemáticos del mapa en directo y seguir la cuenta atrás hasta el día del lanzamiento: 19 de noviembre de 2026.',
    bullets: ['🎬 Alertas de análisis de tráilers', '🗺️ Cacerías de lugares del mapa en directo', '⏳ Cuenta atrás para el lanzamiento'],
    button: 'Unirme al Discord',
  },
  pt: {
    headline: 'Receba as informações de Leonida antes de todo mundo.',
    sentence: 'Entre no Discord da GTA6mapx para receber alertas de análise de trailers assim que novos quadros forem decifrados, participar de caçadas ao vivo por pontos de referência do mapa e acompanhar a contagem regressiva até o dia do lançamento — 19 de novembro de 2026.',
    bullets: ['🎬 Alertas de análise de trailers', '🗺️ Caçadas ao vivo por pontos do mapa', '⏳ Contagem regressiva para o lançamento'],
    button: 'Entrar no Discord',
  },
  de: {
    headline: 'Hol dir die Leonida-Infos, bevor es alle anderen tun.',
    sentence: 'Tritt dem GTA6mapx-Discord bei für Trailer-Analyse-Alarm, sobald neue Frames entschlüsselt sind, für gemeinsame Landmark-Jagden auf der Karte und für den Countdown bis zum Launch am 19. November 2026.',
    bullets: ['🎬 Trailer-Analyse-Alarm', '🗺️ Gemeinsame Landmark-Jagden auf der Karte', '⏳ Countdown bis zum Launch'],
    button: 'Discord beitreten',
  },
  fr: {
    headline: 'Recevez les infos sur Leonida avant tout le monde.',
    sentence: "Rejoignez le Discord GTA6mapx pour les alertes d'analyse de bande-annonce dès qu'une nouvelle image est décodée, les chasses aux lieux emblématiques de la carte en direct et le compte à rebours jusqu'au jour du lancement — le 19 novembre 2026.",
    bullets: ["🎬 Alertes d'analyse de bande-annonce", '🗺️ Chasses aux lieux de la carte en direct', '⏳ Compte à rebours avant le lancement'],
    button: 'Rejoindre le Discord',
  },
  nl: {
    headline: 'Krijg de Leonida-info als eerste binnen.',
    sentence: 'Word lid van de GTA6mapx-Discord voor meldingen zodra nieuwe trailerframes zijn ontcijferd, live landmark-jachten op de kaart en de aftelling naar de lanceerdag — 19 november 2026.',
    bullets: ['🎬 Meldingen bij nieuwe trailerframes', '🗺️ Live landmark-jachten op de kaart', '⏳ Aftelling naar de lancering'],
    button: 'Word lid van de Discord',
  },
  pl: {
    headline: 'Zdobądź informacje o Leonidzie przed wszystkimi.',
    sentence: 'Dołącz do Discorda GTA6mapx, aby otrzymywać alerty o analizach zwiastunów, gdy tylko nowe klatki zostaną rozszyfrowane, brać udział w polowaniach na punkty orientacyjne mapy na żywo i odliczać czas do dnia premiery — 19 listopada 2026 r.',
    bullets: ['🎬 Alerty o analizach zwiastunów', '🗺️ Polowania na punkty mapy na żywo', '⏳ Odliczanie do premiery'],
    button: 'Dołącz do Discorda',
  },
};

function pickHookVariant(lang, slug, og100Open) {
  if (lang !== 'en' && HOOK_V1_I18N[lang]) return HOOK_V1_I18N[lang]; // non-EN: translated variant 1
  const n = og100Open ? 3 : 2;
  let h = 0;
  const s = String(slug || '');
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i);
  return HOOK_EN[h % n];
}

function discordStartHook({ lang, slug, discordUrl, og100Open }) {
  const v = pickHookVariant(lang, slug, og100Open);
  return `<div class="ax-slot-discord"><!--ax:discord-start--><div class="hook-discord-start">`
    + `<div class="hook-eyebrow">💬 ${HOOK_EYEBROW}</div>`
    + `<div class="hook-headline">${v.headline}</div>`
    + `<p class="hook-sentence">${v.sentence}</p>`
    + `<ul class="hook-bullets">${v.bullets.map(b => `<li>${b}</li>`).join('')}</ul>`
    + `<a class="hook-btn" href="${esc(discordUrl)}" target="_blank" rel="noopener">${v.button}</a>`
    + `</div><!--/ax:discord-start--></div>`;
}

/* spec 09 §1: splice after the first qualifying </p> (skip <40-char stubs, max 2 skips) */
function injectAfterFirstParagraph(html, block) {
  const src = String(html || '');
  const pRe = /<p(\s[^>]*)?>[\s\S]*?<\/p>/g;
  let m;
  let skips = 0;
  let firstEnd = -1;
  while ((m = pRe.exec(src)) !== null) {
    const end = m.index + m[0].length;
    if (firstEnd === -1) firstEnd = end;
    if (stripTags(m[0]).length >= 40) return src.slice(0, end) + block + src.slice(end);
    if (++skips > 2) break;
  }
  if (firstEnd !== -1) return src.slice(0, firstEnd) + block + src.slice(firstEnd);
  return block + src;
}

/* ---------- spec 09 §4 + spec 06 §20: merged end CTA (Discord + map) ---------- */

const END_I18N = {
  en: {
    headline: d => `The road to Leonida ends in ${d} days.`,
    launchedHeadline: 'Leonida is open. The hunt is live.',
    sentence: 'GTA 6 launches November 19, 2026. Join the GTA6mapx | State of Leonida Discord now and be in the server for launch week — map hunts, day-one discoveries and the full countdown, together.',
    launchedSentence: 'GTA 6 is out now — join the GTA6mapx | State of Leonida Discord for day-one map discoveries and landmark hunts.',
    ogLine: 'Founding members: the OG-100 role is still open.',
    button: 'Join the Discord',
  },
  es: {
    headline: d => `El camino a Leonida termina en ${d} días.`,
    launchedHeadline: 'Leonida está abierta. La cacería ha comenzado.',
    sentence: 'GTA 6 se lanza el 19 de noviembre de 2026. Únete ahora al Discord GTA6mapx | State of Leonida y entra en el servidor para la semana del lanzamiento: cacerías del mapa, descubrimientos del primer día y la cuenta atrás completa, juntos.',
    launchedSentence: 'GTA 6 ya está disponible — únete al Discord GTA6mapx | State of Leonida para descubrimientos del mapa del primer día y cacerías de lugares emblemáticos.',
    ogLine: 'Miembros fundadores: el rol OG-100 sigue abierto.',
    button: 'Unirme al Discord',
  },
  pt: {
    headline: d => `O caminho para Leonida termina em ${d} dias.`,
    launchedHeadline: 'Leonida está aberta. A caçada começou.',
    sentence: 'GTA 6 chega em 19 de novembro de 2026. Entre agora no Discord da GTA6mapx | State of Leonida e esteja no servidor na semana do lançamento — caçadas no mapa, descobertas do primeiro dia e a contagem regressiva completa, juntos.',
    launchedSentence: 'GTA 6 já está disponível — entre no Discord da GTA6mapx | State of Leonida para descobertas do mapa do primeiro dia e caçadas por pontos de referência.',
    ogLine: 'Membros fundadores: o cargo OG-100 ainda está aberto.',
    button: 'Entrar no Discord',
  },
  de: {
    headline: d => `Der Weg nach Leonida endet in ${d} Tagen.`,
    launchedHeadline: 'Leonida ist offen. Die Jagd läuft.',
    sentence: 'GTA 6 erscheint am 19. November 2026. Tritt jetzt dem GTA6mapx | State of Leonida Discord bei und sei in der Launch-Woche im Server — Karten-Jagden, Entdeckungen vom ersten Tag und der volle Countdown, gemeinsam.',
    launchedSentence: 'GTA 6 ist jetzt da — tritt dem GTA6mapx | State of Leonida Discord bei für Karten-Entdeckungen vom ersten Tag und Landmark-Jagden.',
    ogLine: 'Gründungsmitglieder: Die OG-100-Rolle ist noch offen.',
    button: 'Discord beitreten',
  },
  fr: {
    headline: d => `La route vers Leonida se termine dans ${d} jours.`,
    launchedHeadline: 'Leonida est ouverte. La chasse est lancée.',
    sentence: 'GTA 6 sort le 19 novembre 2026. Rejoignez dès maintenant le Discord GTA6mapx | State of Leonida et soyez dans le serveur pour la semaine de lancement — chasses sur la carte, découvertes du premier jour et le compte à rebours complet, ensemble.',
    launchedSentence: 'GTA 6 est disponible — rejoignez le Discord GTA6mapx | State of Leonida pour les découvertes de la carte du premier jour et les chasses aux lieux emblématiques.',
    ogLine: 'Membres fondateurs : le rôle OG-100 est encore ouvert.',
    button: 'Rejoindre le Discord',
  },
  nl: {
    headline: d => `De weg naar Leonida eindigt over ${d} dagen.`,
    launchedHeadline: 'Leonida is open. De jacht is begonnen.',
    sentence: 'GTA 6 verschijnt op 19 november 2026. Word nu lid van de GTA6mapx | State of Leonida Discord en wees er in de lanceerweek bij in de server — kaartjachten, ontdekkingen van dag één en de volledige aftelling, samen.',
    launchedSentence: 'GTA 6 is nu uit — word lid van de GTA6mapx | State of Leonida Discord voor kaartontdekkingen van dag één en landmark-jachten.',
    ogLine: 'Oprichtende leden: de OG-100-rol is nog open.',
    button: 'Word lid van de Discord',
  },
  pl: {
    headline: d => `Droga do Leonidy kończy się za ${d} dni.`,
    launchedHeadline: 'Leonida jest otwarta. Polowanie trwa.',
    sentence: 'GTA 6 zadebiutuje 19 listopada 2026 r. Dołącz teraz do Discorda GTA6mapx | State of Leonida i bądź na serwerze w tygodniu premiery — polowania na mapie, odkrycia pierwszego dnia i pełne odliczanie, razem.',
    launchedSentence: 'GTA 6 jest już dostępne — dołącz do Discorda GTA6mapx | State of Leonida po odkrycia mapy z pierwszego dnia i polowania na punkty orientacyjne.',
    ogLine: 'Członkowie założyciele: rola OG-100 jest wciąż otwarta.',
    button: 'Dołącz do Discorda',
  },
};

function endCtaPanel({ lang, discordUrl, og100Open, countdownDate }) {
  const c = END_I18N[lang] || END_I18N.en;
  let days = null;
  const target = Date.parse(countdownDate || '2026-11-19T00:00');
  if (!Number.isNaN(target)) days = Math.ceil((target - Date.now()) / 86400000);
  const launched = days !== null && days <= 0;
  const headline = launched ? c.launchedHeadline : (days !== null ? c.headline(days) : c.launchedHeadline);
  const sentence = launched ? c.launchedSentence : c.sentence;
  return `<section class="ax-endcta">`
    + `<div class="ax-endcta-discord hook-discord-end"><strong>${headline}</strong><p>${sentence}</p>`
    + `<a class="ax-btn-discord" href="${esc(discordUrl)}" target="_blank" rel="noopener">${c.button}</a>`
    + (og100Open ? `<div class="ax-og-line">${c.ogLine}</div>` : '')
    + `</div>`
    + `<div class="ax-endcta-map"><strong>Explore the interactive GTA 6 map</strong><br><a class="ax-btn-map" href="/">Open GTA6mapx Map</a></div>`
    + `</section>`;
}

/* ---------- spec 06 §18: author / trust strip ---------- */

function trustStripHtml({ author, authorRole, dateText, updatedText }) {
  return `<section class="ax-trust">`
    + `<div class="ax-trust-brand">GTA6mapx Research Desk</div>`
    + `<div class="ax-trust-by">Written by ${esc(author || 'GTA6mapx Editorial')}${authorRole ? ` · ${esc(authorRole)}` : ''}</div>`
    + `<p class="ax-trust-method">Every claim in this guide carries an evidence label. We update guides when Rockstar publishes new information — rumours are never presented as fact.</p>`
    + `<div class="ax-trust-legend"><span>✅ Rockstar-confirmed</span><span>🎬 Seen in official trailers</span><span>❓ Not yet announced</span></div>`
    + `<div class="ax-trust-dates">Published ${esc(dateText || '')}${updatedText ? ` · Last updated ${esc(updatedText)}` : ''}</div>`
    + `</section>`;
}

/* ---------- spec 06 §11: takeaways box / §15+07 §3.2: continue strip ---------- */

function takeawaysHtml(take, tocEntries) {
  if (take.items.length >= 2) {
    return `<section class="ax-takeaways"><!--ax:takeaways--><h2>Key takeaways</h2><ul>`
      + take.items.map(s => `<li>${badgeEvidence(s)}</li>`).join('')
      + `</ul><!--/ax:takeaways--></section>`;
  }
  const h2s = (tocEntries || []).filter(e => e.level === 2).slice(0, 4);
  if (h2s.length >= 2) {
    return `<section class="ax-takeaways"><!--ax:takeaways--><h2>In this guide</h2><ul>`
      + h2s.map(e => `<li><a href="#${e.id}">${e.text}</a></li>`).join('')
      + `</ul><!--/ax:takeaways--></section>`;
  }
  return '';
}

function continueStripHtml(picks, escFn, capFn) {
  const e = escFn || esc;
  const c = capFn || capFirst;
  return `<div class="ax-slot-internal"><!--ax:continue--><div class="ax-continue"><h3>Continue reading</h3><ul>`
    + picks.map(r => `<li><a href="/guides/${e(r.slug)}">${e(c(r.anchor))}</a></li>`).join('')
    + `</ul></div><!--/ax:continue--></div>`;
}

/* ---------- spec 08: official sources (whitelist-enforced, default zero) ---------- */

const SRC_EXCLUDE_RE = /leak|pre[- ]?order|pre[- ]?venda|prevenda|collector|game ?pass|switch|\bps4\b|xbox ?one|\b360\b|download|\bapk\b|torrent|cheat|\bmod\b|\bmods\b|\bbeta\b|steam|netflix|\bpc\b|\bprice\b|precio|preço|\bprix\b|\bvale\b|\bcuesta\b|\bcusta\b|\bkosten\b|wie viel|how much|\bonline\b|\bsize\b|\bgb\b|install|2027|2028|cancel/i;
const SRC_MARKER_RE = /gta ?6|gta ?vi|grand theft auto (vi|6)|leonida|vice city|lucia|jason/i;
const SRC_TOPIC_RULES = [
  ['trailers', /trailer/i],
  ['hardware', /system requirements|requirements|\bspecs?\b|hardware|systemanforderungen|requisitos/i],
  ['stock', /stock|take[- ]?two|\bttwo\b|revenue|earnings|umsatz|azioni/i],
  ['platforms', /platform|ps5|xbox|playstation|consol[ea]/i],
  ['release-date', /release|launch|erscheinungstermin|fecha|lanzamiento|sortie|wann|quando|cuando sale|countdown|days until|kommt|salida|uscita|premiere/i],
  ['characters', /lucia|jason|character|protagonist|personaje|personagem|charakter/i],
  ['map', /\bmap\b|karte|leonida|vice city|region|gellhorn|ambrosia|grassrivers|kalaga|ocean drive|\bkeys\b|mapa/i],
];
const SRC_HEADINGS = {
  en: 'Official sources', es: 'Fuentes oficiales', pt: 'Fontes oficiais',
  de: 'Offizielle Quellen', fr: 'Sources officielles', nl: 'Officiële bronnen', pl: 'Oficjalne źródła',
};

function resolveSourcesTopic(blog) {
  const hay = `${String(blog.slug || '').replace(/-/g, ' ')} ${cleanKeyword(blog.targetKeyword)}`;
  if (SRC_EXCLUDE_RE.test(hay)) return null;
  if (!SRC_MARKER_RE.test(hay)) return null;
  for (const [topic, re] of SRC_TOPIC_RULES) if (re.test(hay)) return topic;
  return null;
}

function buildSourcesBlock(blog, lang, sourcesData) {
  if (!sourcesData || !sourcesData.topics) return '';
  const topic = resolveSourcesTopic(blog);
  if (!topic) return '';
  const hosts = new Set((sourcesData.whitelistHosts || []).map(h => String(h).toLowerCase()));
  const entries = (sourcesData.topics[topic] || []).filter(en => {
    try {
      const u = new URL(en.url);
      return u.protocol === 'https:' && hosts.has(u.hostname.toLowerCase());
    } catch (_) { return false; }
  }).slice(0, 3);
  if (!entries.length) return '';
  const heading = SRC_HEADINGS[lang] || SRC_HEADINGS.en;
  const items = entries.map(en =>
    `<li><a href="${esc(en.url)}" target="_blank" rel="noopener">${esc(en.documentName)}</a> — ${esc(en.publisher)}${en.date ? `, ${esc(en.date)}` : ''}</li>`
  ).join('');
  return `<!--ax:sources--><section class="ax-sources"><h2 class="ax-sources-h">${heading}</h2><ul>${items}</ul></section><!--/ax:sources-->`;
}

module.exports = {
  esc, stripTags, cleanKeyword, capFirst, wordCount,
  splitIntro, tagLead, buildToc, tocListHtml,
  extractTakeaways, pickPullQuote, badgeEvidence, lazyImages,
  transformFaq, insertPullQuote, insertContinueStrip, insertSourcesBlock,
  extractInBodySlugs, detectLang, discordStartHook, injectAfterFirstParagraph,
  endCtaPanel, trustStripHtml, takeawaysHtml, continueStripHtml,
  resolveSourcesTopic, buildSourcesBlock,
};
