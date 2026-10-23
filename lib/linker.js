'use strict';
/*
 * lib/linker.js — internal-linking ranker (Redesign Phase 2, spec 07 §2).
 * Additive companion to blogdb.related(): builds a cached candidate index from
 * blogdb.list() rows (LIST_COLUMNS projection — no article bodies), scores
 * candidates with IDF-weighted token overlap, tiers by language → category →
 * score, and fills gaps via flagship pool → same-category hash rotation →
 * global hash rotation. Deterministic per corpus state. No stored data changes.
 */
const crypto = require('crypto');
const blogdb = require('./blogdb');

const STOP = new Set(['gta', 'grand', 'theft', 'auto', 'vi', '6', 'the', 'a', 'an', 'and', 'or', 'of', 'for', 'in', 'on', 'to', 'is']);
const LANG_STOP = {
  en: ['the', 'is', 'and', 'of', 'to', 'in', 'for', 'with'],
  de: ['der', 'die', 'und', 'ist', 'für', 'mit', 'wann', 'nicht'],
  pt: ['que', 'para', 'com', 'uma', 'não', 'quando', 'os', 'as'],
  es: ['el', 'la', 'los', 'las', 'qué', 'para', 'con', 'una'],
  pl: ['jak', 'kiedy', 'nie', 'czy', 'dla', 'się', 'jest'],
  fr: ['le', 'la', 'les', 'des', 'est', 'pour', 'avec', 'dans'],
  nl: ['de', 'het', 'een', 'van', 'is', 'niet', 'voor', 'met'],
  it: ['il', 'lo', 'gli', 'le', 'per', 'con', 'una', 'non'],
  sv: ['och', 'det', 'att', 'för', 'med', 'inte', 'som', 'en'],
};
const FLAGSHIP = ['gta-6', 'gta-6-release-date', 'gta-6-map', 'gta-6-platforms', 'gta-6-system-requirements', 'gta-6-price', 'gta-6-trailer', 'gta-6-vice-city', 'gta-6-lucia', 'gta-6-jason'];

function cleanText(s) {
  return String(s || '').replace(/[\u200B\uFEFF]/g, '');
}
function stripTagsLite(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokenize(text) {
  const out = new Set();
  for (const raw of cleanText(text).toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || raw.length <= 2 || STOP.has(raw)) continue;
    out.add(raw);
  }
  return out;
}
function detectLangFromText(text) {
  const words = cleanText(text).toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const scored = [];
  for (const [lang, stops] of Object.entries(LANG_STOP)) {
    const set = new Set(stops);
    let n = 0;
    for (const w of words) if (set.has(w)) n++;
    scored.push([lang, n]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  if (scored[0][1] >= 3 && scored[0][1] > scored[1][1]) return scored[0][0];
  return 'en';
}

let cache = null;
let builtAt = 0;
const TTL = 5 * 60 * 1000;

function buildIndex() {
  const { blogs } = blogdb.list({ limit: 0 });
  const rows = blogs.map(b => {
    const keyword = cleanText(b.targetKeyword || '').replace(/\s+/g, ' ').trim();
    return {
      slug: b.slug,
      title: b.title || '',
      category: b.category || 'Guides',
      date: b.date || '',
      coverImage: b.coverImage || '',
      excerpt: b.excerpt || '',
      readTime: b.readTime || '',
      keyword,
      anchor: keyword || b.title || '',
      tokens: tokenize(`${b.targetKeyword || ''} ${b.title || ''} ${String(b.slug || '').replace(/-/g, ' ')}`),
      lang: detectLangFromText(`${b.excerpt || ''} ${b.title || ''} ${b.targetKeyword || ''}`),
    };
  });
  const bySlug = new Map(rows.map(r => [r.slug, r]));
  const df = new Map();
  for (const r of rows) for (const t of r.tokens) df.set(t, (df.get(t) || 0) + 1);
  const N = rows.length || 1;
  const idf = new Map();
  for (const [t, d] of df) idf.set(t, Math.log(N / d));
  const inv = new Map();
  rows.forEach((r, i) => {
    for (const t of r.tokens) {
      if (!inv.has(t)) inv.set(t, new Set());
      inv.get(t).add(i);
    }
  });
  cache = { rows, bySlug, idf, inv };
  builtAt = Date.now();
  return cache;
}

function getIndex() {
  if (!cache || Date.now() - builtAt > TTL) return buildIndex();
  return cache;
}

function invalidate() {
  cache = null;
  builtAt = 0;
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function toPick(c) {
  return {
    slug: c.slug, title: c.title, category: c.category, date: c.date,
    coverImage: c.coverImage, excerpt: c.excerpt, readTime: c.readTime,
    keyword: c.keyword, anchor: c.anchor, lang: c.lang,
  };
}

function relatedScored(blog, { count = 9, exclude = new Set() } = {}) {
  const idx = getIndex();
  const srcTokens = tokenize(`${blog.targetKeyword || ''} ${blog.title || ''} ${String(blog.slug || '').replace(/-/g, ' ')}`);
  const srcLang = detectLangFromText(`${stripTagsLite(blog.content).slice(0, 2000)} ${blog.title || ''} ${blog.targetKeyword || ''}`);
  const srcCat = blog.category || 'Guides';
  const blocked = new Set(exclude);
  blocked.add(blog.slug);

  const candIdx = new Set();
  for (const t of srcTokens) {
    const s = idx.inv.get(t);
    if (s) for (const i of s) candIdx.add(i);
  }
  const scored = [];
  for (const i of candIdx) {
    const c = idx.rows[i];
    if (blocked.has(c.slug)) continue;
    let score = 0;
    for (const t of c.tokens) if (srcTokens.has(t)) score += idx.idf.get(t) || 0;
    if (score > 0) scored.push({ c, score });
  }
  scored.sort((a, b) => {
    const langDiff = (b.c.lang === srcLang ? 1 : 0) - (a.c.lang === srcLang ? 1 : 0);
    if (langDiff) return langDiff;
    const catDiff = (b.c.category === srcCat ? 1 : 0) - (a.c.category === srcCat ? 1 : 0);
    if (catDiff) return catDiff;
    if (b.score !== a.score) return b.score - a.score;
    if (a.c.date !== b.c.date) return a.c.date < b.c.date ? 1 : -1;
    return a.c.slug < b.c.slug ? -1 : 1;
  });

  const picks = [];
  const usedAnchors = new Set();
  const tryPick = (c) => {
    if (!c || blocked.has(c.slug)) return;
    if (picks.some(p => p.slug === c.slug)) return;
    const anchorKey = String(c.anchor || '').toLowerCase();
    if (!anchorKey || usedAnchors.has(anchorKey)) return;
    usedAnchors.add(anchorKey);
    picks.push(toPick(c));
  };

  for (const s of scored) {
    if (picks.length >= count) break;
    tryPick(s.c);
  }
  // F1 — flagship pool (same-language flagships first, then pool order)
  if (picks.length < count) {
    const flags = FLAGSHIP.map(s => idx.bySlug.get(s)).filter(Boolean);
    flags.sort((a, b) => (b.lang === srcLang ? 1 : 0) - (a.lang === srcLang ? 1 : 0));
    for (const f of flags) {
      if (picks.length >= count) break;
      tryPick(f);
    }
  }
  // F2 — same-category hash-rotation spread fill
  if (picks.length < count) {
    const rest = idx.rows.filter(r => r.category === srcCat && !blocked.has(r.slug) && !picks.some(p => p.slug === r.slug));
    rest.sort((a, b) => {
      const ha = sha1(`${blog.slug}:${a.slug}`);
      const hb = sha1(`${blog.slug}:${b.slug}`);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    for (const c of rest) {
      if (picks.length >= count) break;
      tryPick(c);
    }
  }
  // F3 — global hash-rotation spread fill
  if (picks.length < count) {
    const rest = idx.rows.filter(r => !blocked.has(r.slug) && !picks.some(p => p.slug === r.slug));
    rest.sort((a, b) => {
      const ha = sha1(`${blog.slug}:${a.slug}`);
      const hb = sha1(`${blog.slug}:${b.slug}`);
      return ha < hb ? -1 : ha > hb ? 1 : 0;
    });
    for (const c of rest) {
      if (picks.length >= count) break;
      tryPick(c);
    }
  }
  return picks;
}

module.exports = { relatedScored, invalidate };
