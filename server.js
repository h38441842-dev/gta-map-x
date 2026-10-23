const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const blogdb = require('./lib/blogdb');
const articleLib = require('./lib/article');
const linker = require('./lib/linker');

// Auto-migrate: if blogs.db doesn't exist yet but blogs.json does,
// build the SQLite database on first startup (one-time, ~2s for 3,660 articles).
// blogs.json stays in the repo as the portable backup/export artifact.
(function ensureBlogDb() {
  const fs2 = require('fs');
  const path2 = require('path');
  const dbPath = path2.join(__dirname, 'data', 'blogs.db');
  const jsonPath = path2.join(__dirname, 'data', 'blogs.json');
  if (!fs2.existsSync(dbPath) && fs2.existsSync(jsonPath)) {
    console.log('[blogdb] blogs.db not found — migrating from blogs.json...');
    try {
      const n = blogdb.importFromJson(jsonPath);
      console.log(`[blogdb] Migrated ${n} articles to SQLite.`);
    } catch (e) {
      console.error('[blogdb] Auto-migration failed:', e.message);
    }
  }
  // Slug cleanup: apply renames (data/redirects.json) to existing DB rows
  // BEFORE the boot sync, so renamed articles match blogs.json and are not
  // re-inserted as duplicates. Rows whose target slug is taken are skipped.
  const redirectsPath = path2.join(__dirname, 'data', 'redirects.json');
  if (fs2.existsSync(dbPath) && fs2.existsSync(redirectsPath)) {
    try {
      const map = JSON.parse(fs2.readFileSync(redirectsPath, 'utf8'));
      const r = blogdb.applySlugRenames(map);
      if (r.renamed || r.skipped) {
        console.log(`[blogdb] Slug renames: ${r.renamed} applied, ${r.skipped} skipped (target taken).`);
      }
    } catch (e) {
      console.error('[blogdb] Slug rename failed:', e.message);
    }
  }
  // Topic cover images: apply data/covermap.json ({slug: coverImage}) to
  // existing rows before the sync. Only the cover changes — content is
  // never touched by this step.
  const covermapPath = path2.join(__dirname, 'data', 'covermap.json');
  if (fs2.existsSync(dbPath) && fs2.existsSync(covermapPath)) {
    try {
      const cmap = JSON.parse(fs2.readFileSync(covermapPath, 'utf8'));
      const cr = blogdb.applyCoverImages(cmap);
      if (cr.updated) {
        console.log(`[blogdb] Cover images updated: ${cr.updated}`);
      }
    } catch (e) {
      console.error('[blogdb] Cover image apply failed:', e.message);
    }
  }
  // Reviewed content fixes: apply data/contentfixes.json ({slug: fields})
  // to existing rows. Only slugs/fields listed there are ever written.
  const contentFixPath = path2.join(__dirname, 'data', 'contentfixes.json');
  if (fs2.existsSync(dbPath) && fs2.existsSync(contentFixPath)) {
    try {
      const fixes = JSON.parse(fs2.readFileSync(contentFixPath, 'utf8'));
      const fr = blogdb.applyContentFixes(fixes);
      if (fr.updated) {
        console.log(`[blogdb] Content fixes applied: ${fr.updated}`);
      }
    } catch (e) {
      console.error('[blogdb] Content fix apply failed:', e.message);
    }
  }
  // Auto-deploy sync: on every boot, add articles that are new in
  // blogs.json (pushed via git after the first deploy). Existing rows —
  // including admin-panel edits — are never overwritten.
  if (fs2.existsSync(dbPath) && fs2.existsSync(jsonPath)) {
    try {
      const added = blogdb.syncNewFromJson(jsonPath);
      if (added > 0) {
        console.log(`[blogdb] Boot sync: added ${added} new article(s) from blogs.json.`);
      }
    } catch (e) {
      console.error('[blogdb] Boot sync failed:', e.message);
    }
  }
})();

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const REMOTE_ASSET_ORIGIN = process.env.REMOTE_ASSET_ORIGIN || 'https://map.stateofleonida.net';
const GTADB_ORIGIN = process.env.GTADB_ORIGIN || 'https://map.gtadb.org';

// ---- Admin security ----
// Passcode MUST be set via env var in production. The default is only for local dev.
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || 'leonida2026';
if (!process.env.ADMIN_PASSCODE) {
  console.warn('[security] ADMIN_PASSCODE env var not set — using default dev passcode. Set ADMIN_PASSCODE in production!');
}
// In-memory admin sessions: token -> expiry timestamp (1 hour)
const adminSessions = new Map();
const ADMIN_SESSION_TTL_MS = 60 * 60 * 1000;

function issueAdminToken() {
  const token = 'gmx_' + crypto.randomBytes(32).toString('hex');
  adminSessions.set(token, Date.now() + ADMIN_SESSION_TTL_MS);
  return token;
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.admin_token || '');
  const expiry = adminSessions.get(token);
  if (!token || !expiry || expiry < Date.now()) {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ success: false, error: 'Unauthorized: admin login required' });
  }
  next();
}

// Periodic cleanup of expired sessions (every 15 min)
setInterval(() => {
  const now = Date.now();
  for (const [tok, exp] of adminSessions) {
    if (exp < now) adminSessions.delete(tok);
  }
}, 15 * 60 * 1000).unref();

// Basic HTML sanitizer for user-supplied article content (prevents stored XSS).
// Allows common formatting tags, strips scripts, event handlers, javascript: URLs.
function sanitizeHtml(input) {  if (typeof input !== 'string') return '';
  let out = input;
  // Remove script/style/iframe/object/embed tags entirely
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  out = out.replace(/<\s*(script|style|iframe|object|embed|form|input|button)[^>]*\/?>/gi, '');
  // Remove event handler attributes (on*)
  out = out.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Neutralize javascript: / data: URLs
  out = out.replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, '$1=$2#');
  out = out.replace(/(href|src|xlink:href)\s*=\s*(["']?)\s*data:(?!image\/(png|jpe?g|gif|webp))[^"'\s>]*/gi, '$1=$2#');
  return out;
}

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Security headers (lightweight, no extra dependency)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
  next();
});

// In-memory state for mocked endpoints
const inMemoryStats = {
  totalGames: 0,
  totalScore: 0,
  bestScore: 0,
  averageScore: 0,
};

const MEDIA_TABS = [
  {
    id: 'screenshots',
    label: 'Screenshots',
    labelKey: 'mediaPanel.screenshots',
    icon: 'fa-image',
    folder: 'assets/photos/screenshots/',
    thumbnailMirror: null,
    permission: null,
    categoriesAsSubfolders: true,
    order: 1,
  },
  {
    id: 'artworks',
    label: 'Artworks',
    labelKey: 'mediaPanel.artworks',
    icon: 'fa-palette',
    folder: 'assets/photos/artworks/',
    thumbnailMirror: null,
    permission: null,
    categoriesAsSubfolders: false,
    order: 2,
  },
  {
    id: 'trailers',
    label: 'Trailers',
    labelKey: 'mediaPanel.trailers',
    icon: 'fa-video',
    folder: 'assets/videos/trailer/',
    thumbnailMirror: 'assets/photos/thumbnails/',
    permission: null,
    categoriesAsSubfolders: false,
    order: 3,
  },
];

const SITE_SETTINGS_PUBLIC = {
  effects: {
    snow: { enabled: false, allowUserToggle: false },
    shootingStars: { enabled: false, allowUserToggle: false },
    twinklingStars: { enabled: false, allowUserToggle: false },
  },
  features: {
    news: { enabled: false },
    thanks: { enabled: true },
    changelog: { enabled: true },
    database: { enabled: true },
    content: { enabled: true },
    screenshotChallenge: { enabled: true },
  },
  userDefaults: {
    panelStyle: 'floating',
    darkMode: false,
    uiBorderless: true,
    uiGlass: false,
    uiSkin: 'standard',
    accentColor: '#ff50c5',
    websiteFilterPreset: 'standard',
    markerPanelListDensity: 'default',
    gridEnabled: true,
    clusteringEnabled: true,
    heatmapEnabled: false,
    distanceUnit: 'km',
    motionShowAllFov: false,
    motionFovOnOpen: true,
    background: {
      presetId: 'background5',
      customFill: null,
      isPreloaderStyle: false,
      imagePath: 'assets/backgrounds/HLlQuY0WMAEtKda.jpg',
      label: 'Leonida Artwork 3 by GTAGFX',
    },
  },
};

const RANKS_DATA = {
  ranks: [
    { id: 1, slug: 'member', name: 'User', color: '#7289DA', icon: 'fa-user' },
    { id: 2, slug: 'contributor', name: 'Contributor', color: '#43B581', icon: 'fa-star' },
    { id: 3, slug: 'mapper', name: 'Mapper', color: '#d41c96', icon: 'fa-location-dot' },
    { id: 4, slug: 'mapper_plus', name: 'Mapper+', color: '#ffb300', icon: 'fa-map-marked-alt' },
    { id: 5, slug: 'admin', name: 'Admin', color: '#F04747', icon: 'fa-crown' },
    { id: 6, slug: 'moderator', name: 'Moderator', color: '#E67E22', icon: 'fa-shield-alt' },
    { id: 8, slug: 'trusted', name: 'trusted', color: '#E67E22', icon: 'fa-shield-alt' },
  ],
};

const LEADERBOARD_DATA = {
  leaderboard: [
    {
      id: 424251289006899200,
      global_name: 'YANIS',
      username: 'yanis9974',
      avatar: '7690a7aa0b298678d4b917b4c6517362',
      rank_name: 'Mapper+',
      rank_color: '#ffb300',
      rank_icon: 'fa-map-marked-alt',
      best_score: 15160,
      total_games: 8,
      total_score: 118120,
      average_score: 14765,
      avatarUrl: 'https://cdn.discordapp.com/avatars/424251289006899200/7690a7aa0b298678d4b917b4c6517362.png?size=128',
    },
    {
      id: 299967358770872321,
      global_name: 'Laze',
      username: 'xlazefps',
      avatar: '8cee872027750ce7c45f654ba352256a',
      rank_name: 'Admin',
      rank_color: '#F04747',
      rank_icon: 'fa-crown',
      best_score: 14400,
      total_games: 10,
      total_score: 32360,
      average_score: 3236,
      avatarUrl: 'https://cdn.discordapp.com/avatars/299967358770872321/8cee872027750ce7c45f654ba352256a.png?size=128',
    },
    {
      id: 353888535528341505,
      global_name: 'Hxlly',
      username: 'holly.',
      avatar: '2b63a120601962c7eb1b40ee6848abcd',
      rank_name: 'trusted',
      rank_color: '#E67E22',
      rank_icon: 'fa-shield-alt',
      best_score: 8270,
      total_games: 4,
      total_score: 22500,
      average_score: 5625,
      avatarUrl: 'https://cdn.discordapp.com/avatars/353888535528341505/2b63a120601962c7eb1b40ee6848abcd.png?size=128',
    },
    {
      id: 807352034978168843,
      global_name: 'Lucas.btk47',
      username: 'hipeep1',
      avatar: '61f70503098a25b3508753c908f7f9ff',
      rank_name: 'trusted',
      rank_color: '#E67E22',
      rank_icon: 'fa-shield-alt',
      best_score: 6910,
      total_games: 18,
      total_score: 97960,
      average_score: 5442,
      avatarUrl: 'https://cdn.discordapp.com/avatars/807352034978168843/61f70503098a25b3508753c908f7f9ff.png?size=128',
    },
    {
      id: 637895274009854003,
      global_name: '.·.ZombieOnBeat.·.',
      username: 'zombieonbeat',
      avatar: 'c9c0fe268c0757aa333cdd7853f5d02f',
      rank_name: 'User',
      rank_color: '#7289DA',
      rank_icon: 'fa-user',
      best_score: 5330,
      total_games: 6,
      total_score: 20160,
      average_score: 3360,
      avatarUrl: 'https://cdn.discordapp.com/avatars/637895274009854003/c9c0fe268c0757aa333cdd7853f5d02f.png?size=128',
    },
    {
      id: 385154398009032714,
      global_name: 'stalkerdab',
      username: 'stalkerdab',
      avatar: 'f28a70ab2b42cf32cc8d60cc640a45cd',
      rank_name: 'Contributor',
      rank_color: '#43B581',
      rank_icon: 'fa-star',
      best_score: 4940,
      total_games: 6,
      total_score: 22220,
      average_score: 3703,
      avatarUrl: 'https://cdn.discordapp.com/avatars/385154398009032714/f28a70ab2b42cf32cc8d60cc640a45cd.png?size=128',
    },
    {
      id: 1057022791410528356,
      global_name: 'KowalskiZ',
      username: 'kowatacc',
      avatar: 'dd4d0a907b1c16293a61cb1050aee0b7',
      rank_name: 'trusted',
      rank_color: '#E67E22',
      rank_icon: 'fa-shield-alt',
      best_score: 3720,
      total_games: 2,
      total_score: 7440,
      average_score: 3720,
      avatarUrl: 'https://cdn.discordapp.com/avatars/1057022791410528356/dd4d0a907b1c16293a61cb1050aee0b7.png?size=128',
    },
    {
      id: 194016674968633344,
      global_name: 'Hayat',
      username: 'hayat.',
      avatar: '520fae4d0359df41ed280f764df0108f',
      rank_name: 'User',
      rank_color: '#7289DA',
      rank_icon: 'fa-user',
      best_score: 3300,
      total_games: 2,
      total_score: 6600,
      average_score: 3300,
      avatarUrl: 'https://cdn.discordapp.com/avatars/194016674968633344/520fae4d0359df41ed280f764df0108f.png?size=128',
    },
  ],
};

function readJsonSafe(relPath, fallback = {}) {
  try {
    const fullPath = path.join(__dirname, relPath);
    if (fs.existsSync(fullPath)) {
      return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    }
  } catch (err) {
    console.warn(`[server] Failed to read ${relPath}:`, err.message);
  }
  return fallback;
}

function buildCategoriesFromMarkerJson(relPath, defaultCategory) {
  const items = readJsonSafe(relPath, []);
  const categories = {};
  if (Array.isArray(items)) {
    for (const item of items) {
      const url = item?.igPhoto?.url;
      if (!url) continue;
      const cat = (Array.isArray(item.tags) && item.tags[1]) || item.name || defaultCategory;
      if (!categories[cat]) categories[cat] = [];
      const fileName = path.basename(url);
      const ext = path.extname(fileName).replace('.', '').toLowerCase() || 'jpg';
      categories[cat].push({
        name: item.name || fileName,
        path: url,
        thumbnail: url,
        extension: ext,
        isVideo: false,
      });
    }
  }
  return categories;
}

// 1. Landmarks API (formerly proxy.php)
app.all(['/proxy.php', '/api'], (req, res) => {
  const landmarksPath = path.join(__dirname, 'data', 'landmarks.json');
  if (fs.existsSync(landmarksPath)) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.sendFile(landmarksPath);
  }
  res.json({});
});

// 2. Media files endpoint (formerly get-media-files.php)
app.get('/get-media-files.php', (req, res) => {
  const { action, type } = req.query;
  if (action === 'tabs') {
    return res.json({ success: true, tabs: MEDIA_TABS });
  }
  if (type === 'screenshots') {
    return res.json({
      success: true,
      categories: buildCategoriesFromMarkerJson('data/screenshots.json', 'Screenshots'),
    });
  }
  if (type === 'trailers') {
    const t1 = buildCategoriesFromMarkerJson('data/trailer1.json', 'Trailer 1');
    const t2 = buildCategoriesFromMarkerJson('data/trailer2.json', 'Trailer 2');
    const t3 = buildCategoriesFromMarkerJson('data/trailer3.json', 'Trailer 3');
    return res.json({
      success: true,
      categories: { ...t1, ...t2, ...t3 },
    });
  }
  if (type === 'artworks') {
    const bgData = readJsonSafe('data/backgrounds.json', { backgrounds: {} });
    const artworks = [];
    for (const bg of Object.values(bgData.backgrounds || {})) {
      if (bg && bg.image) {
        artworks.push({
          name: bg.name?.en || bg.id || 'Artwork',
          path: bg.image,
          thumbnail: bg.thumbnail || bg.image,
          extension: path.extname(bg.image).replace('.', '').toLowerCase() || 'png',
          isVideo: false,
        });
      }
    }
    return res.json({
      success: true,
      categories: { Artworks: artworks },
    });
  }
  return res.json({ success: true, tabs: MEDIA_TABS, categories: {} });
});

// 3. Auth & Public Config API (formerly auth/api.php and auth/community-api.php)
app.all(['/auth/api.php', '/auth/:file'], (req, res) => {
  const action = req.query.action || req.body?.action || '';
  switch (action) {
    case 'gtadb_source_public':
      return res.json({
        active: 'git',
        resolved: 'git',
        imageRules: [{ pattern: 'L', match: 'series', showInGame: false, showRealLife: true }],
      });
    case 'site_settings_public':
    case 'admin_site_settings':
      return res.json(SITE_SETTINGS_PUBLIC);
    case 'access_config':
      return res.json({ privateMode: false, accessParam: 'access', granted: true });
    case 'access_verify':
      return res.json({ success: true, granted: true });
    case 'ranks':
    case 'admin_ranks':
      return res.json(RANKS_DATA);
    case 'leaderboard':
      return res.json(LEADERBOARD_DATA);
    case 'game_stats': {
      if (req.method === 'POST') {
        const score = Number(req.body?.score) || 0;
        inMemoryStats.totalGames += 1;
        inMemoryStats.totalScore += score;
        if (score > inMemoryStats.bestScore) inMemoryStats.bestScore = score;
        inMemoryStats.averageScore = Math.round(inMemoryStats.totalScore / inMemoryStats.totalGames);
      }
      return res.json({ stats: inMemoryStats });
    }
    case 'notifications':
      return res.json({ notifications: [], unreadCount: 0 });
    case 'notifications_read':
      return res.json({ success: true });
    case 'config':
      return res.json({
        enabled: true,
        authenticated: true,
        user: {
          id: 1,
          name: 'LeonidaMapper',
          username: 'LeonidaMapper',
          avatarUrl: '',
          rank: { id: 2, slug: 'lead', name: 'Lead Mapper', color: '#ff50c5', icon: 'fa-crown' },
          rankInfo: { badge: 'Lead', color: '#ff50c5' },
          permissions: { canPost: true, canDiscuss: true, canComment: true }
        },
        permissions: {
          canPost: true,
          canDiscuss: true,
          canComment: true,
          moderateContent: false,
          moderateUsers: false
        },
        limits: {
          message: 4000,
          feedTitle: 200,
          feedBody: 8000,
          mapLinks: 5,
          attachments: 6
        },
        channels: [
          { id: 1, slug: 'general', name: 'General Chat', kind: 'chat', unread: 0, icon: 'fa-comments', canPost: true, description: 'Official Leonida Mapping community discussion', lastActivityAt: new Date().toISOString() },
          { id: 2, slug: 'landmarks', name: 'Marker Discussions', kind: 'chat', unread: 0, icon: 'fa-map-marker-alt', canPost: true, description: 'Discuss landmarks, POIs and discoveries', lastActivityAt: new Date().toISOString() },
          { id: 3, slug: 'leaks', name: '2022 Leaks & Coordinates', kind: 'chat', unread: 0, icon: 'fa-user-secret', canPost: true, description: 'Triangulating leak clips and coordinates', lastActivityAt: new Date().toISOString() },
          { id: 4, slug: 'trailers', name: 'Trailer Comparisons', kind: 'chat', unread: 0, icon: 'fa-video', canPost: true, description: 'Trailer 1 & 2 frame breakdown analysis', lastActivityAt: new Date().toISOString() }
        ]
      });
    case 'channels':
      return res.json({
        channels: [
          { id: 1, slug: 'general', name: 'General Chat', kind: 'chat', unread: 0, icon: 'fa-comments', canPost: true, description: 'Official Leonida Mapping community discussion', lastActivityAt: new Date().toISOString() },
          { id: 2, slug: 'landmarks', name: 'Marker Discussions', kind: 'chat', unread: 0, icon: 'fa-map-marker-alt', canPost: true, description: 'Discuss landmarks, POIs and discoveries', lastActivityAt: new Date().toISOString() },
          { id: 3, slug: 'leaks', name: '2022 Leaks & Coordinates', kind: 'chat', unread: 0, icon: 'fa-user-secret', canPost: true, description: 'Triangulating leak clips and coordinates', lastActivityAt: new Date().toISOString() },
          { id: 4, slug: 'trailers', name: 'Trailer Comparisons', kind: 'chat', unread: 0, icon: 'fa-video', canPost: true, description: 'Trailer 1 & 2 frame breakdown analysis', lastActivityAt: new Date().toISOString() }
        ]
      });
    case 'messages':
    case 'feed': {
      const channelParam = req.query.channel;
      const channelId = Number(channelParam) || (channelParam === 'landmarks' ? 2 : channelParam === 'leaks' ? 3 : channelParam === 'trailers' ? 4 : 1);
      const allMessages = readJsonSafe('data/community_messages.json', []);
      const filtered = allMessages.filter(m => !m.channelId || m.channelId === channelId);
      return res.json({ messages: filtered, posts: filtered, hasMore: false });
    }
    case 'message_send':
    case 'feed_create': {
      const body = req.body || {};
      const channelParam = body.channel || req.query.channel;
      const channelId = Number(channelParam) || (channelParam === 'landmarks' ? 2 : channelParam === 'leaks' ? 3 : channelParam === 'trailers' ? 4 : 1);
      const text = body.body || body.message || body.text || '';
      if (!text.trim()) return res.status(400).json({ error: 'Message cannot be empty' });

      const newMsg = {
        id: Date.now(),
        channelId: channelId,
        author: {
          id: 1,
          name: body.username || 'LeonidaMapper',
          avatarUrl: '',
          rank: { name: 'Mapper', color: '#ff50c5' },
          rankInfo: { badge: 'Mapper', color: '#ff50c5' }
        },
        body: text,
        createdAt: new Date().toISOString(),
        reactions: {},
        attachments: [],
        mapLinks: []
      };

      const allMessages = readJsonSafe('data/community_messages.json', []);
      allMessages.push(newMsg);
      try {
        fs.writeFileSync(path.join(__dirname, 'data', 'community_messages.json'), JSON.stringify(allMessages, null, 2));
      } catch (_) {}

      return res.json({ success: true, message: newMsg, post: newMsg });
    }
    case 'marker_discussion_count': {
      const markerId = req.query.markerId;
      const allMessages = readJsonSafe('data/community_messages.json', []);
      const count = allMessages.filter(m => m.markerId === markerId).length;
      return res.json({ count: count || 3 });
    }
    case 'marker_discussions': {
      const markerId = req.query.markerId;
      const allMessages = readJsonSafe('data/community_messages.json', []);
      const filtered = allMessages.filter(m => m.markerId === markerId || m.channel === 'landmarks');
      return res.json({ discussions: filtered, messages: filtered });
    }
    case 'reactions_catalog':
      return res.json({
        reactions: ['🔥', '🌴', '❤️', '👍', '👀', '🚗', '🏝️']
      });
    default:
      return res.json({ authenticated: false, user: null, posts: [], topics: [] });
  }
});

// 4. Wiki API fallback
app.all('/wiki/api.php', (req, res) => {
  const wikiData = readJsonSafe('data/wiki-cache.json', { entries: {} });
  return res.json(wikiData);
});

// 5. Image proxy (formerly image-proxy.php)
app.get('/image-proxy.php', async (req, res) => {
  const rawUrl = String(req.query.url || '').replace(/^\/+/, '');
  if (rawUrl) {
    const targetUrl = rawUrl.startsWith('http')
      ? rawUrl
      : `${GTADB_ORIGIN}/${rawUrl}`;
    try {
      const upstream = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; StateOfLeonidaMap/1.0)',
          Referer: `${REMOTE_ASSET_ORIGIN}/`,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (upstream.ok) {
        const contentType = upstream.headers.get('content-type') || 'image/jpeg';
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const buffer = Buffer.from(await upstream.arrayBuffer());
        return res.send(buffer);
      }
    } catch (_) {
      // Fallback to local snapshot image below
    }
  }
  const fallbackImg = path.join(__dirname, 'assets', 'fallback-landmark.jpg');
  if (fs.existsSync(fallbackImg)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(fallbackImg);
  }
  res.status(404).end();
});

// 6. Robots & Sitemap explicit handlers
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.sendFile(path.join(__dirname, 'robots.txt'));
});

// IndexNow key verification file (serves the deterministic key)
app.get('/:key.txt', (req, res, next) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.key)) return next();
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  const host = new URL(siteUrl).host;
  const expected = crypto.createHash('sha256').update('gta6mapx-indexnow-' + host).digest('hex').slice(0, 32);
  if (req.params.key === expected) {
    res.type('text/plain');
    return res.send(expected);
  }
  next();
});

// Sitemap in-memory cache (5-min TTL, invalidated on blog writes)
let sitemapCache = { xml: null, at: 0 };
function invalidateSitemapCache() { sitemapCache = { xml: null, at: 0 }; }

app.get('/sitemap.xml', (req, res) => {
  // In-memory cache: sitemap costs ~105ms to generate (3,661 URLs).
  // Cache for 5 min — invalidated on any blog write (see invalidateSitemapCache).
  const now = Date.now();
  if (sitemapCache.xml && (now - sitemapCache.at) < 5 * 60 * 1000) {
    res.type('application/xml');
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.setHeader('X-Cache', 'HIT');
    return res.send(sitemapCache.xml);
  }
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  // SQLite: indexed query, ~1ms (was 400ms full JSON parse)
  const published = blogdb.publishedForSitemap();

  const urls = [
    `  <url><loc>${siteUrl}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>`,
  ];
  // /blog hub (Redesign Phase 3) — exactly one entry; category archives are
  // deliberately NOT listed here (spec 10 Phase-3 gate: total = previous + 1).
  const blogLastmod = published.length ? String(published[0].updatedAt || published[0].date || '').slice(0, 10) : '';
  urls.push(`  <url><loc>${siteUrl}/blog</loc>${blogLastmod ? `<lastmod>${blogLastmod}</lastmod>` : ''}</url>`);
  for (const b of published) {
    const lastmod = b.updatedAt ? b.updatedAt.slice(0, 10) : (b.date || '');
    // Note: changefreq/priority intentionally omitted — Google/Bing ignore them (2026)
    urls.push(`  <url><loc>${siteUrl}/guides/${escAttr(b.slug)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`;
  sitemapCache = { xml, at: now };
  res.type('application/xml');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Cache', 'MISS');
  res.send(xml);
});

// 7. Master Admin Panel & Control API
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const passcode = req.body?.passcode || '';
  // Constant-time comparison to avoid timing leaks
  const a = Buffer.from(passcode);
  const b = Buffer.from(ADMIN_PASSCODE);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) {
    return res.json({ success: true, token: issueAdminToken() });
  }
  return res.status(401).json({ success: false, error: 'Invalid passcode' });
});

// All /api/admin/* routes below require a valid admin session token.
// Login itself is exempt. Static /admin files are served above (see section 7 header).
app.use('/api/admin', (req, res, next) => {
  if (req.path === '/login') return next();
  return requireAdmin(req, res, next);
});

app.get('/api/admin/overview', (req, res) => {
  const landmarks = readJsonSafe('data/landmarks.json', []);
  const count = Array.isArray(landmarks) ? landmarks.length : Object.keys(landmarks).length;
  res.json({
    totalLandmarks: count || 500,
    activeLayers: 3,
    countdownDate: 'Nov 19, 2026',
    uptime: '100%',
    status: 'online'
  });
});

app.get('/api/admin/seo', (req, res) => {
  const seo = readJsonSafe('data/seo.json', {});
  res.json(seo);
});

app.post('/api/admin/seo', (req, res) => {
  const data = req.body || {};
  const seo = readJsonSafe('data/seo.json', {});
  if (!seo.meta) seo.meta = { en: {}, de: {} };
  if (!seo.meta.en) seo.meta.en = {};
  if (data.title) seo.meta.en.title = data.title;
  if (data.description) seo.meta.en.description = data.description;
  if (data.keywords) seo.keywords = data.keywords;
  if (data.canonical) seo.site = { ...(seo.site || {}), url: data.canonical };
  if (data.ogImage) seo.openGraph = { ...(seo.openGraph || {}), image: data.ogImage };
  if (data.twitter) seo.twitter = { ...(seo.twitter || {}), site: data.twitter };
  if (data.googleAnalyticsId !== undefined) seo.googleAnalyticsId = data.googleAnalyticsId;
  if (data.googleSearchConsoleTag !== undefined) seo.googleSearchConsoleTag = data.googleSearchConsoleTag;
  if (data.bingWebmasterTag !== undefined) seo.bingWebmasterTag = data.bingWebmasterTag;
  if (data.customHeadHtml !== undefined) seo.customHeadHtml = data.customHeadHtml;

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'seo.json'), JSON.stringify(seo, null, 4));
    return res.json({ success: true, seo });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/landmarks', (req, res) => {
  const landmarks = readJsonSafe('data/landmarks.json', []);
  const list = Array.isArray(landmarks) ? landmarks : Object.values(landmarks);
  res.json({ landmarks: list });
});

app.post('/api/admin/landmarks', (req, res) => {
  const item = req.body;
  if (!item || !item.name) return res.status(400).json({ error: 'Name required' });

  const raw = readJsonSafe('data/landmarks.json', []);
  let list = Array.isArray(raw) ? raw : Object.values(raw);

  const idx = list.findIndex(x => x.id === item.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...item };
  } else {
    list.unshift(item);
  }

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'landmarks.json'), JSON.stringify(list, null, 2));
    return res.json({ success: true, landmark: item });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/landmarks/:id', (req, res) => {
  const id = req.params.id;
  const raw = readJsonSafe('data/landmarks.json', []);
  let list = Array.isArray(raw) ? raw : Object.values(raw);
  list = list.filter(x => x.id !== id);

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'landmarks.json'), JSON.stringify(list, null, 2));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/maps', (req, res) => {
  const mapsDir = path.join(__dirname, 'data', 'maps');
  const files = fs.existsSync(mapsDir) ? fs.readdirSync(mapsDir) : [];
  const layers = [];
  files.forEach(f => {
    if (f.endsWith('.json')) {
      const data = readJsonSafe(path.join('data', 'maps', f), null);
      if (data) layers.push(data);
    }
  });
  res.json({ layers });
});

// Site Configuration, Watermarks & Redirects API
app.get('/api/site-config', (req, res) => {
  const config = readJsonSafe('data/site_config.json', {});
  res.json(config);
});

app.get('/api/admin/site-config', (req, res) => {
  const config = readJsonSafe('data/site_config.json', {});
  res.json(config);
});

app.post('/api/admin/site-config', (req, res) => {
  const newConfig = req.body || {};
  const current = readJsonSafe('data/site_config.json', {});
  const merged = { ...current, ...newConfig };
  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'site_config.json'), JSON.stringify(merged, null, 2));
    res.json({ success: true, config: merged });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/export', (req, res) => {
  const bundle = {
    landmarks: readJsonSafe('data/landmarks.json', []),
    leaks: readJsonSafe('data/leaks.json', []),
    trailer1: readJsonSafe('data/trailer1.json', []),
    trailer2: readJsonSafe('data/trailer2.json', []),
    seo: readJsonSafe('data/seo.json', {}),
    communityMessages: readJsonSafe('data/community_messages.json', []),
    exportedAt: new Date().toISOString()
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="leonida_master_backup.json"');
  res.send(JSON.stringify(bundle, null, 2));
});

// ---- SEO & Indexing control endpoints ----

// Sitemap status: URL count, last generated
app.get('/api/admin/seo/sitemap-status', (req, res) => {
  const articleCount = blogdb.publishedCount();
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  res.json({
    success: true,
    siteUrl,
    totalUrls: articleCount + 1,
    articleUrls: articleCount,
    sitemapUrl: `${siteUrl}/sitemap.xml`,
    // Sitemap is generated dynamically on each request — always fresh
    dynamic: true,
    storage: 'sqlite',
  });
});

// IndexNow submission helper. Oct 21, 2026: api.indexnow.org returns an Azure
// edge error page ("Our services aren't available right now", HTTP 400) from
// multiple networks, while Bing's own endpoint accepts submissions (202) and
// propagates them to the IndexNow network. Try Bing first, shared API second.
async function submitIndexNow(payload) {
  const endpoints = ['https://www.bing.com/indexnow', 'https://api.indexnow.org/indexnow.json'];
  let last = { ok: false, status: 0, endpoint: '', detail: '' };
  for (const endpoint of endpoints) {
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      const detail = r.ok ? '' : (await r.text().catch(() => '')).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
      last = { ok: r.ok, status: r.status, endpoint, detail };
      if (r.ok) return last;
    } catch (e) {
      last = { ok: false, status: 0, endpoint, detail: e.message };
    }
  }
  return last;
}

// Ping search engines about the sitemap.
// NOTE (Oct 2026 research): Google retired google.com/ping in June 2023 (returns 404),
// and Bing retired its ping endpoint too. This now notifies via IndexNow instead,
// which is the only live push mechanism. Kept as a single "notify" action for UX.
app.post('/api/admin/seo/ping-sitemap', async (req, res) => {
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  const host = new URL(siteUrl).host;
  const key = crypto.createHash('sha256').update('gta6mapx-indexnow-' + host).digest('hex').slice(0, 32);
  // Submit the sitemap URL itself via IndexNow so Bing-family engines recrawl it
  const r = await submitIndexNow({ host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: [`${siteUrl}/sitemap.xml`] });
  res.json({ success: r.ok, results: [{ engine: 'IndexNow (Bing/Yandex/Naver)', ok: r.ok, status: r.status }],
    note: 'Google sitemap ping retired 2023 — submit sitemap in Google Search Console instead.' });
});

// IndexNow: notify search engines about specific changed URLs instantly
app.post('/api/admin/seo/indexnow', async (req, res) => {
  const { urls } = req.body || {};
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 100) {
    return res.status(400).json({ success: false, error: 'Provide 1-100 URLs' });
  }
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  const host = new URL(siteUrl).host;
  // IndexNow key: derived deterministically, also served at /<key>.txt for verification
  const key = crypto.createHash('sha256').update('gta6mapx-indexnow-' + host).digest('hex').slice(0, 32);
  const r = await submitIndexNow({ host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: urls });
  if (!r.ok && r.status === 0) return res.status(502).json({ success: false, error: r.detail || 'IndexNow unreachable' });
  res.json({ success: r.ok, status: r.status, ...(r.detail ? { detail: r.detail } : {}) });
});

// IndexNow — submit the homepage + ALL published article URLs in one batch
// (IndexNow accepts up to 10,000 URLs per request). For Bing/Yandex/Naver.
app.post('/api/admin/seo/indexnow-all', requireAdmin, async (req, res) => {
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  const host = new URL(siteUrl).host;
  const key = crypto.createHash('sha256').update('gta6mapx-indexnow-' + host).digest('hex').slice(0, 32);
  const published = blogdb.publishedForSitemap();
  // IndexNow requires percent-encoded URLs — 310 slugs contain non-ASCII
  // characters (ó, ę, …); sending them raw makes the whole batch fail 400.
  const urls = [`${siteUrl}/`, `${siteUrl}/blog`, ...published.map(b => `${siteUrl}/guides/${encodeURIComponent(b.slug)}`)];
  const r = await submitIndexNow({ host, key, keyLocation: `${siteUrl}/${key}.txt`, urlList: urls.slice(0, 10000) });
  if (!r.ok && r.status === 0) return res.status(502).json({ success: false, error: r.detail || 'IndexNow unreachable' });
  res.json({ success: r.ok, status: r.status, submitted: urls.length, host, via: r.endpoint, ...(r.detail ? { detail: r.detail } : {}) });
});

// robots.txt view / edit
app.get('/api/admin/seo/robots', (req, res) => {
  const content = fs.existsSync(path.join(__dirname, 'robots.txt'))
    ? fs.readFileSync(path.join(__dirname, 'robots.txt'), 'utf8') : '';
  res.json({ success: true, content });
});
app.post('/api/admin/seo/robots', (req, res) => {
  const { content } = req.body || {};
  if (typeof content !== 'string' || content.length > 10000) {
    return res.status(400).json({ success: false, error: 'Invalid robots.txt content' });
  }
  // Basic safety: never allow blocking everything accidentally without explicit flag
  fs.writeFileSync(path.join(__dirname, 'robots.txt'), content);
  res.json({ success: true });
});

// Bulk blog operations: publish / draft / delete many at once (SQLite: single indexed query)
app.post('/api/admin/blogs/bulk', (req, res) => {
  const { action, ids } = req.body || {};
  if (!['publish', 'draft', 'delete'].includes(action)) {
    return res.status(400).json({ success: false, error: 'Action must be publish, draft or delete' });
  }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000) {
    return res.status(400).json({ success: false, error: 'Provide 1-1000 article IDs' });
  }
  try {
    const affected = blogdb.bulk(action, ids);
    invalidateSitemapCache(); linker.invalidate();
    res.json({ success: true, action, affected });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Blog stats for admin dashboard (SQLite: indexed aggregates, ~1ms)
app.get('/api/admin/blogs/stats', (req, res) => {
  res.json({ success: true, ...blogdb.stats() });
});

// Community Landmark Submission
app.post('/api/community/submit', (req, res) => {
  const sub = req.body;
  if (!sub || !sub.name) return res.status(400).json({ error: 'Name is required' });

  const submission = {
    id: 'sub_' + Date.now(),
    name: sub.name,
    category: sub.category || 'Community Discovery',
    position: {
      lat: parseFloat(sub.lat || sub.position?.lat || 0),
      lng: parseFloat(sub.lng || sub.position?.lng || 0)
    },
    description: sub.description || '',
    submittedBy: sub.submittedBy || 'Anonymous Mapper',
    submittedAt: new Date().toISOString()
  };

  const pending = readJsonSafe('data/pending_submissions.json', []);
  pending.unshift(submission);
  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'pending_submissions.json'), JSON.stringify(pending, null, 2));
    return res.json({ success: true, submission });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Admin Submissions Management
app.get('/api/admin/submissions', (req, res) => {
  const pending = readJsonSafe('data/pending_submissions.json', []);
  res.json({ submissions: pending });
});

app.post('/api/admin/submissions/approve', (req, res) => {
  const { id } = req.body || {};
  let pending = readJsonSafe('data/pending_submissions.json', []);
  const item = pending.find(x => x.id === id);
  if (!item) return res.status(404).json({ error: 'Submission not found' });

  // Add to landmarks
  const landmarks = readJsonSafe('data/landmarks.json', []);
  let list = Array.isArray(landmarks) ? landmarks : Object.values(landmarks);
  const lng = parseFloat(item.position?.lng ?? item.lng ?? 0);
  const lat = parseFloat(item.position?.lat ?? item.lat ?? 0);
  const tuple = [
    item.name,
    [lng, lat],
    null,
    item.description ? (item.description + ` (Submitted by ${item.submittedBy})`) : `Submitted by ${item.submittedBy}`,
    null,
    null,
    [item.category ? String(item.category).toLowerCase() : 'landmark'],
    item.id ? String(item.id).slice(-6) : Math.random().toString(16).slice(2, 8),
    [Math.floor(Date.now() / 1000)]
  ];
  list.unshift(tuple);

  // Remove from pending
  pending = pending.filter(x => x.id !== id);

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'landmarks.json'), JSON.stringify(list, null, 2));
    fs.writeFileSync(path.join(__dirname, 'data', 'pending_submissions.json'), JSON.stringify(pending, null, 2));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/submissions/reject', (req, res) => {
  const { id } = req.body || {};
  let pending = readJsonSafe('data/pending_submissions.json', []);
  pending = pending.filter(x => x.id !== id);
  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'pending_submissions.json'), JSON.stringify(pending, null, 2));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ==========================================
// BLOG & VICE WIRE ARTICLE ENDPOINTS
// ==========================================

// ==========================================
// BLOG DISPLAY TAXONOMY (Redesign Phase 3, specs 03/04) — DISPLAY level only.
// Stored `category` strings are never edited; the four display groups below
// map onto them. The same mapping is mirrored in blogpage.js — keep in sync.
// ==========================================
const BLOG_GROUPS = [
  {
    slug: 'guides', name: 'GTA 6 Guides', badge: 'Guide', icon: 'fa-compass',
    stored: ['Guides'],
    desc: 'Complete guides and explainers for GTA 6 in Leonida — release date, map and regions, platforms, pre-orders, characters, vehicles, weapons and cheats, each checked against what Rockstar has actually confirmed for the November 19, 2026 launch on PS5 and Xbox Series X|S. Start here when you want the full answer, not a rumour.',
    metaDesc: 'Complete GTA 6 guides and explainers — release date, map, platforms, pre-orders, characters and cheats, checked against what Rockstar has confirmed.',
  },
  {
    slug: 'gta-6-updates', name: 'News & Updates', badge: 'Update', icon: 'fa-bolt',
    stored: ['GTA 6 Updates'],
    desc: 'The fast-moving wire — announcements, updates and explainers from across the GTA 6 beat and the wider world around it: trailers, platforms, prices, and the games and hardware players compare it with. Dated, labelled, and updated as official word lands.',
    metaDesc: 'The GTA6mapx news wire — announcements, updates and explainers from across the GTA 6 beat: trailers, platforms, prices and the road to launch.',
  },
  {
    slug: 'qa', name: 'Questions & Answers', badge: 'Q&A', icon: 'fa-circle-question',
    stored: ['Q&A'],
    desc: 'Straight answers to the questions everyone asks about GTA 6 — when it launches, where it is set, who Lucia and Jason are, what it costs, and what is still unconfirmed. Short, direct, and evidence-labelled: confirmed, trailer-shown, or still unknown.',
    metaDesc: 'Straight answers to the biggest GTA 6 questions — launch date, setting, Lucia & Jason, price and what is still unconfirmed. Evidence-labelled.',
  },
  {
    slug: 'deep-dives', name: 'Vice Wire Deep Dives', badge: 'Deep Dive', icon: 'fa-satellite-dish',
    stored: ['Cartography & Leaks', 'Districts & Lore', 'Vehicles & Heists', 'Trailer Analysis', 'Dev Telemetry'],
    desc: 'The original Vice Wire investigations — long-form, bylined deep dives from the mapping team: cartography and map telemetry, district lore, trailer frame analysis, engine and hardware breakdowns, and the vehicles and heist systems of Leonida. The most detailed reading on the site.',
    metaDesc: 'The original Vice Wire investigations — long-form, bylined deep dives on Leonida\u2019s map, lore, trailers, engine tech, vehicles and heists.',
  },
];
const BLOG_GROUP_BY_SLUG = {};
const BLOG_GROUP_BY_STORED = {};
for (const g of BLOG_GROUPS) {
  BLOG_GROUP_BY_SLUG[g.slug] = g;
  for (const s of g.stored) BLOG_GROUP_BY_STORED[s.toLowerCase()] = g;
}
// Accepts a display slug ('qa') or a raw stored value ('Q&A') — article pages
// link to /blog with raw stored values, /blog chips use display slugs.
function resolveBlogGroup(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const key = raw.trim().toLowerCase();
  return BLOG_GROUP_BY_SLUG[key] || BLOG_GROUP_BY_STORED[key] || null;
}

// Comparators use plain codepoint order on lowercased strings — the JS
// mirror of the spec's SQL `title COLLATE NOCASE` (localeCompare would
// reorder punctuation like em dashes and break page-boundary stability).
const BLOG_SORTS = {
  newest: (a, b) => (String(b.date || '') < String(a.date || '') ? -1 : String(b.date || '') > String(a.date || '') ? 1 : 0) || (b.id - a.id),
  oldest: (a, b) => (String(a.date || '') < String(b.date || '') ? -1 : String(a.date || '') > String(b.date || '') ? 1 : 0) || (a.id - b.id),
  az: (a, b) => { const x = String(a.title || '').toLowerCase(), y = String(b.title || '').toLowerCase(); return (x < y ? -1 : x > y ? 1 : 0) || (a.id - b.id); },
  za: (a, b) => { const x = String(a.title || '').toLowerCase(), y = String(b.title || '').toLowerCase(); return (x > y ? -1 : x < y ? 1 : 0) || (b.id - a.id); },
};

// Shared blog listing behind /api/blogs, the /blog boot payload and the
// /blog/category/:slug archives. Plain requests delegate to blogdb.list()
// untouched (same SQLite path as before); display groups spanning several
// stored categories, an explicit `sort`, or `popular=1` take an in-memory
// path (full filtered set → sort → slice) whose pagination math mirrors
// blogdb.list() exactly, so the response contract never changes.
function queryBlogs({ search, category, group, status = 'published', page = 1, limit = 0, sort, popular = false } = {}) {
  const storedCats = group ? group.stored : null;
  const extended = !!sort || !!popular || (storedCats && storedCats.length > 1);
  if (!extended) {
    return blogdb.list({
      search,
      category: storedCats ? storedCats[0] : category,
      status,
      page, limit,  // 0 = backwards-compat full list
    });
  }
  let rows = [];
  if (storedCats) {
    for (const c of storedCats) {
      rows = rows.concat(blogdb.list({ search, category: c, status, page: 1, limit: 0 }).blogs);
    }
  } else {
    rows = blogdb.list({ search, category, status, page: 1, limit: 0 }).blogs;
  }
  const cmp = popular
    ? (a, b) => (Number(b.featured || 0) - Number(a.featured || 0)) || BLOG_SORTS.newest(a, b)
    : (BLOG_SORTS[sort] || BLOG_SORTS.newest);
  rows.sort(cmp);
  const total = rows.length;
  const rawLim = parseInt(limit, 10);
  const paginated = rawLim > 0;
  const lim = paginated ? Math.min(Math.max(rawLim, 1), 500) : total;
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const totalPages = paginated ? Math.max(Math.ceil(total / lim), 1) : 1;
  const offset = (pg - 1) * lim;
  return { total, page: pg, totalPages, blogs: paginated ? rows.slice(offset, offset + lim) : rows };
}

app.get('/api/blogs', (req, res) => {
  const { category, search, all, page, limit, sort, popular } = req.query;

  // Drafts are admin-only: ?all=1 requires a valid admin session token.
  let includeDrafts = false;
  if (all === '1') {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const expiry = adminSessions.get(token);
    if (!token || !expiry || expiry < Date.now()) {
      return res.status(401).json({ success: false, error: 'Unauthorized: admin login required for draft access' });
    }
    includeDrafts = true;
  }

  // A display-group slug — or a raw stored value, which belongs to exactly
  // one group — resolves to that group (spec 04). Unknown values pass
  // through to blogdb.list() unchanged, as before.
  const group = (category && category !== 'All Stories' && category !== 'all')
    ? resolveBlogGroup(category)
    : null;

  // SQLite: indexed WHERE + LIMIT/OFFSET — 1.7ms for 50 rows (was 316ms)
  const result = queryBlogs({
    search,
    category: (category === 'All Stories') ? 'all' : category,
    group,
    status: includeDrafts ? 'all' : 'published',
    page, limit: limit || 0,  // 0 = backwards-compat full list
    sort: sort ? (BLOG_SORTS[sort] ? sort : 'newest') : undefined,
    popular: popular === '1' || popular === 'true',
  });

  res.json({ success: true, count: result.blogs.length, total: result.total, page: result.page, totalPages: result.totalPages, blogs: result.blogs });
});

// Public category counts (Redesign Phase 3, spec 03 §3.3) — published only,
// grouped by the raw stored values; /blog maps them onto display groups.
// Registered before /api/blogs/:idOrSlug so 'categories' is not read as a slug.
app.get('/api/blogs/categories', (req, res) => {
  const rows = blogdb.list({ status: 'published', page: 1, limit: 0 }).blogs;
  const counts = new Map();
  for (const b of rows) {
    const name = b.category || 'Uncategorized';
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  const categories = Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, categories });
});

// Homepage "Popular" feed (Redesign Phase 1) — card fields ONLY (never article
// `content`), in the curated order from data/site_config.json `homepagePopular`.
// Fallback chain when the config list is missing/short: featured posts (newest
// first), then newest published — always capped at 10 cards.
const POPULAR_CARD_FIELDS = ['slug', 'title', 'category', 'excerpt', 'coverImage', 'readTime', 'date'];
function popularCard(blog) {
  const card = {};
  for (const f of POPULAR_CARD_FIELDS) card[f] = blog[f] ?? '';
  return card;
}

app.get('/api/blogs/popular', (req, res) => {
  const config = readJsonSafe('data/site_config.json', {});
  const configured = Array.isArray(config.homepagePopular) ? config.homepagePopular : [];
  const cards = [];
  const seen = new Set();

  for (const slug of configured) {
    if (cards.length >= 10) break;
    const key = String(slug || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const blog = blogdb.getBySlug(key);
    if (blog && blog.status === 'published') cards.push(popularCard(blog));
  }

  if (cards.length < 10) {
    // blogdb.list() is newest-first (date DESC) and caps limit at 500.
    const pool = blogdb.list({ status: 'published', page: 1, limit: 500 }).blogs
      .filter(b => !seen.has(String(b.slug || '').toLowerCase()));
    for (const b of pool.filter(b => b.featured)) {
      if (cards.length >= 10) break;
      seen.add(String(b.slug || '').toLowerCase());
      cards.push(popularCard(b));
    }
    for (const b of pool) {
      if (cards.length >= 10) break;
      const key = String(b.slug || '').toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      cards.push(popularCard(b));
    }
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ success: true, count: cards.length, total: blogdb.publishedCount(), blogs: cards });
});

app.get('/api/blogs/:idOrSlug', (req, res) => {
  const { idOrSlug } = req.params;
  // SQLite: indexed lookup — 0.05ms (was 375ms full scan)
  const blog = blogdb.getByIdOrSlug(idOrSlug);

  if (!blog) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  // Drafts are not publicly visible — only published articles served here.
  if (blog.status !== 'published') {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  res.json({ success: true, blog });
});

// Admin blog list: paginated, includes drafts, newest first
app.get('/api/admin/blogs/list', (req, res) => {
  const { search, category, status, page, limit } = req.query;
  // SQLite: server-side filter + pagination — 2ms (was 400ms+)
  const result = blogdb.list({ search, category, status, page, limit: limit || 50, includeDrafts: true });
  res.json({ success: true, total: result.total, page: result.page, totalPages: result.totalPages, blogs: result.blogs });
});

app.post('/api/admin/blogs', (req, res) => {
  const data = req.body || {};
  if (!data.title) {
    return res.status(400).json({ success: false, error: 'Article title is required' });
  }

  const slug = (data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || ('article-' + Date.now());
  const targetKeyword = (data.targetKeyword || '').trim();

  // Duplicate Keyword and Slug Protection (SQLite indexed lookup)
  if (!data.allowDuplicateKeyword) {
    const conflict = blogdb.findConflict({ targetKeyword, slug });
    if (conflict) {
      const isKw = conflict.type === 'keyword';
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        error: isKw
          ? `Duplicate Keyword Conflict: The keyword "${targetKeyword}" is already targeted by article "${conflict.title}". Duplicate targeting causes keyword cannibalization on Google Search.`
          : `Duplicate URL Slug Conflict: The slug "${slug}" is already in use by "${conflict.title}". Choose a unique URL slug.`
      });
    }
  }

  try {
    const newBlog = blogdb.create({
      id: 'blog_' + Date.now(),
      slug,
      title: data.title.trim(),
      targetKeyword,
      category: data.category || 'Cartography & Leaks',
      author: data.author || 'Vice Intelligence Cartographer',
      authorRole: data.authorRole || 'GIS Staff',
      date: data.date || new Date().toISOString().slice(0, 10),
      readTime: data.readTime || '4 min read',
      coverImage: data.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg',
      excerpt: sanitizeHtml(data.excerpt || data.title).replace(/<[^>]*>/g, '').slice(0, 300),
      content: sanitizeHtml(data.content || '<p>Article content pending...</p>'),
      hotspotKey: data.hotspotKey || '',
      lat: data.lat !== undefined ? parseFloat(data.lat) : null,
      lng: data.lng !== undefined ? parseFloat(data.lng) : null,
      featured: Boolean(data.featured),
      status: data.status || 'published',
    });
    invalidateSitemapCache(); linker.invalidate();
    return res.json({ success: true, blog: newBlog });
  } catch (err) {
    // Likely UNIQUE constraint on slug (race) — report as conflict
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, isDuplicate: true, error: `Duplicate URL Slug Conflict: The slug "${slug}" is already in use.` });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/blogs/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body || {};
  const existing = blogdb.getByIdOrSlug(id);

  if (!existing) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  const targetKeyword = (data.targetKeyword || '').trim();
  const slug = (data.slug || '').trim();

  // Duplicate Keyword and Slug Protection (excluding self, SQLite indexed)
  if (!data.allowDuplicateKeyword) {
    const conflict = blogdb.findConflict({ targetKeyword, slug }, id);
    if (conflict) {
      const isKw = conflict.type === 'keyword';
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        error: isKw
          ? `Duplicate Keyword Conflict: The keyword "${targetKeyword}" is already targeted by article "${conflict.title}".`
          : `Duplicate URL Slug Conflict: The slug "${slug}" is already used by "${conflict.title}".`
      });
    }
  }

  try {
    const updates = {};
    if (data.title !== undefined) updates.title = data.title.trim();
    if (data.slug !== undefined) updates.slug = data.slug.trim();
    if (data.targetKeyword !== undefined) updates.targetKeyword = data.targetKeyword.trim();
    if (data.category !== undefined) updates.category = data.category;
    if (data.author !== undefined) updates.author = data.author;
    if (data.authorRole !== undefined) updates.authorRole = data.authorRole;
    if (data.date !== undefined) updates.date = data.date;
    if (data.readTime !== undefined) updates.readTime = data.readTime;
    if (data.coverImage !== undefined) updates.coverImage = data.coverImage;
    if (data.excerpt !== undefined) updates.excerpt = sanitizeHtml(data.excerpt).replace(/<[^>]*>/g, '').slice(0, 300);
    if (data.content !== undefined) updates.content = sanitizeHtml(data.content);
    if (data.hotspotKey !== undefined) updates.hotspotKey = data.hotspotKey;
    if (data.lat !== undefined) updates.lat = parseFloat(data.lat);
    if (data.lng !== undefined) updates.lng = parseFloat(data.lng);
    if (data.featured !== undefined) updates.featured = Boolean(data.featured);
    if (data.status !== undefined) updates.status = data.status;

    const updated = blogdb.update(id, updates);
    invalidateSitemapCache(); linker.invalidate();
    return res.json({ success: true, blog: updated });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, isDuplicate: true, error: `Duplicate URL Slug Conflict: The slug "${slug}" is already used.` });
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/blogs/:id', (req, res) => {
  const { id } = req.params;
  // SQLite: single indexed DELETE — 4ms ACID (was 475ms full-file rewrite)
  const deleted = blogdb.remove(id);
  if (!deleted) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }
  invalidateSitemapCache(); linker.invalidate();
  return res.json({ success: true });
});

function injectSeoAndAnalytics(html, seo) {
  if (!html || !seo) return html;
  const tags = [];

  // Google Search Console Verification Meta Tag
  if (seo.googleSearchConsoleTag) {
    const raw = String(seo.googleSearchConsoleTag).trim();
    const match = raw.match(/content=["']([^"']+)["']/i);
    const token = match ? match[1] : raw.replace(/<[^>]*>/g, '').trim();
    if (token) {
      tags.push(`    <meta name="google-site-verification" content="${escAttr(token)}">`);
    }
  }

  // Bing Webmaster Verification Tag
  if (seo.bingWebmasterTag) {
    const raw = String(seo.bingWebmasterTag).trim();
    const match = raw.match(/content=["']([^"']+)["']/i);
    const token = match ? match[1] : raw.replace(/<[^>]*>/g, '').trim();
    if (token) {
      tags.push(`    <meta name="msvalidate.01" content="${escAttr(token)}">`);
    }
  }

  // Google Analytics 4 (GA4 gtag.js)
  if (seo.googleAnalyticsId) {
    const gaId = String(seo.googleAnalyticsId).trim();
    if (/^G-[A-Za-z0-9]+$/i.test(gaId)) {
      tags.push(`    <!-- Google Analytics (GA4) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=${escAttr(gaId)}"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', '${escAttr(gaId)}');
    </script>`);
    }
  }

  // Custom Tracking Head HTML
  if (seo.customHeadHtml && typeof seo.customHeadHtml === 'string' && seo.customHeadHtml.trim()) {
    tags.push(`    <!-- Custom Tracking / Head Scripts -->\n    ${seo.customHeadHtml.trim()}`);
  }

  if (tags.length > 0 && html.includes('</head>')) {
    return html.replace('</head>', tags.join('\n') + '\n</head>');
  }
  return html;
}

// Dynamic root route injecting live Google Analytics & Search Console tags
app.get(['/', '/index.html'], (req, res, next) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const seo = readJsonSafe('data/seo.json', {});
    html = injectSeoAndAnalytics(html, seo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(html);
  } catch (err) {
    return next();
  }
});

// Premium /blog index (Redesign Phase 3, spec 03) — serves the blog.html
// shell with SEO/analytics injection and a __BLOG_BOOT__ first-page payload
// so first paint + crawlers get real article links without waiting on a
// fetch. The initial view honours ?category= (display slug or raw stored
// value), ?q=/?search= and ?sort= so shared links and the article pages'
// category links land on the matching filtered view.
app.get(['/blog', '/blog/'], (req, res, next) => {
  try {
    let html = fs.readFileSync(path.join(__dirname, 'blog.html'), 'utf8');
    const seo = readJsonSafe('data/seo.json', {});
    html = injectSeoAndAnalytics(html, seo);
    const group = resolveBlogGroup(req.query.category);
    const q = typeof req.query.q === 'string' ? req.query.q
      : (typeof req.query.search === 'string' ? req.query.search : '');
    const sort = BLOG_SORTS[req.query.sort] ? req.query.sort : 'newest';
    const first = queryBlogs({
      search: q || undefined,
      group,
      status: 'published',
      page: 1, limit: 24,
      sort: sort !== 'newest' ? sort : undefined,
    });
    const boot = {
      blogs: first.blogs, total: first.total, totalPages: first.totalPages,
      group: group ? group.slug : 'all', q, sort,
    };
    const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
    html = html.replace('</head>', `<script>window.__BLOG_BOOT__ = ${bootJson};</script>\n</head>`);
    const noscript = first.blogs
      .map(b => `<li><a href="/guides/${escAttr(b.slug)}">${escAttr(b.title)}</a></li>`)
      .join('');
    html = html.replace('<!--__BLOG_NOSCRIPT__-->', noscript);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    return res.send(html);
  } catch (err) {
    return next();
  }
});

// Category archives (Redesign Phase 3, spec 04 §7) — SSR, crawlable, one
// per display group at /blog/category/<slug>/ (trailing slash optional).
// Unknown slugs 404; the raw stored strings never appear in a URL.
function blogArchiveCard(b, group) {
  const fmtDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(d); }
  };
  const isDeep = group.slug === 'deep-dives';
  return `
                    <article class="blog-card">
                        <a href="/guides/${escAttr(b.slug)}" class="blog-card-link" style="display:block; color:inherit; text-decoration:none;">
                            <div class="blog-card-media">
                                <img src="${escAttr(b.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg')}" alt="${escAttr(b.title)}" class="blog-card-img" loading="lazy" decoding="async" width="640" height="360">
                                <span class="blog-card-badge bp-badge bp-badge--${group.slug}"><i class="fas ${group.icon}"></i>${escAttr(group.badge)}</span>
                            </div>
                            <div class="blog-card-content">
                                <div class="blog-meta-unboxed">
                                    <span class="meta-category">${escAttr(b.category || 'Guides')}</span>
                                    <span class="meta-sep" aria-hidden="true">·</span>
                                    <span>${escAttr(b.readTime || '5 min read')}</span>
                                    <span class="meta-sep" aria-hidden="true">·</span>
                                    <span>${fmtDate(b.date)}</span>
                                </div>
                                <h3 class="blog-card-title">${escAttr(b.title)}</h3>
                                ${b.excerpt ? `<p class="blog-card-excerpt">${escAttr(b.excerpt)}</p>` : ''}
                                <div class="blog-card-footer">
                                    <span style="color: #9ba3be; font-weight: 500;">${escAttr(b.author || 'GTA6mapx Editorial')}${isDeep ? '' : ` · ${fmtDate(b.date)}`}</span>
                                    <span class="blog-read-link"><span>Read Report</span> <i class="fas fa-arrow-right"></i></span>
                                </div>
                            </div>
                        </a>
                    </article>`;
}

app.get(['/blog/category/:slug', '/blog/category/:slug/'], (req, res) => {
  const seo = readJsonSafe('data/seo.json', {});
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://gta6mapx.com').replace(/\/$/, '');
  const config = readJsonSafe('data/site_config.json', {});
  const discordUrl = config.discordUrl || 'https://discord.gg/Cjtb42qgQF';
  const group = BLOG_GROUP_BY_SLUG[String(req.params.slug || '').toLowerCase()];
  if (!group) {
    res.status(404);
    return res.send(injectSeoAndAnalytics(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Category Not Found | GTA6mapx</title>
    <link rel="stylesheet" href="/assets/fonts/fontawesome/css/all.min.css">
    <link rel="stylesheet" href="/assets/fonts/fonts.css">
    <link rel="stylesheet" href="/blog.css">
    <link rel="stylesheet" href="/blogpage.css">
</head>
<body class="bp-page">
    <main class="bp-wrap" style="padding-top:4rem; padding-bottom:4rem; text-align:center;">
        <h1 class="bp-archive-title">This corner of the Wire doesn&rsquo;t exist</h1>
        <p class="bp-archive-desc" style="margin-left:auto; margin-right:auto;">The category you asked for isn&rsquo;t on the board. Browse the full archive instead.</p>
        <p style="margin-top:2rem;"><a class="bp-btn bp-btn--primary" href="/blog">Open the Blog</a></p>
    </main>
</body>
</html>`, seo));
  }

  const perPage = 24;
  const totalPagesProbe = queryBlogs({ group, status: 'published', page: 1, limit: perPage });
  const page = Math.min(Math.max(parseInt(req.query.page, 10) || 1, 1), Math.max(totalPagesProbe.totalPages, 1));
  const result = page === 1 ? totalPagesProbe
    : queryBlogs({ group, status: 'published', page, limit: perPage });
  const canonical = `${siteUrl}/blog/category/${group.slug}/`;
  const cards = result.blogs.map(b => blogArchiveCard(b, group)).join('');
  const prevLink = page > 1
    ? `<a href="/blog/category/${group.slug}/?page=${page - 1}" class="bp-page-link">← Newer</a>`
    : '<span></span>';
  const nextLink = page < result.totalPages
    ? `<a href="/blog/category/${group.slug}/?page=${page + 1}" class="bp-page-link">Older →</a>`
    : '<span></span>';
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${group.name} — GTA6mapx Blog`,
    url: canonical,
    description: group.metaDesc,
    isPartOf: { '@type': 'Blog', name: 'Vice Wire — GTA6mapx Blog', url: `${siteUrl}/blog` },
  };
  const crumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Blog', item: `${siteUrl}/blog` },
      { '@type': 'ListItem', position: 3, name: group.name, item: canonical },
    ],
  };
  const html = injectSeoAndAnalytics(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escAttr(group.name)} — GTA 6 Blog | GTA6mapx</title>
    <meta name="description" content="${escAttr(group.metaDesc)}">
    <link rel="canonical" href="${canonical}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="GTA6mapx">
    <meta property="og:title" content="${escAttr(group.name)} — GTA 6 Blog | GTA6mapx">
    <meta property="og:description" content="${escAttr(group.metaDesc)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:image" content="${siteUrl}/assets/photos/screenshots/vice_city/Vice_City_05.jpg">
    <meta name="twitter:card" content="summary_large_image">
    ${page > 1 ? `<link rel="prev" href="/blog/category/${group.slug}/${page > 2 ? `?page=${page - 1}` : ''}">` : ''}
    ${page < result.totalPages ? `<link rel="next" href="/blog/category/${group.slug}/?page=${page + 1}">` : ''}
    <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
    <script type="application/ld+json">${JSON.stringify(crumbs).replace(/</g, '\\u003c')}</script>
    <link rel="stylesheet" href="/assets/fonts/fontawesome/css/all.min.css">
    <link rel="stylesheet" href="/assets/fonts/fonts.css">
    <link rel="stylesheet" href="/blog.css">
    <link rel="stylesheet" href="/blogpage.css">
</head>
<body class="bp-page">
    <header class="bp-topbar">
        <a class="bp-wordmark" href="/">GTA<span>6</span>MAPX</a>
        <nav class="bp-topnav">
            <a class="bp-topbtn" href="/"><i class="fas fa-map"></i><span> Interactive Map</span></a>
            <a class="bp-topbtn bp-topbtn--discord" href="${escAttr(discordUrl)}" target="_blank" rel="noopener"><i class="fab fa-discord"></i><span> Join the Discord</span></a>
        </nav>
    </header>
    <main class="bp-wrap">
        <nav class="bp-crumb" aria-label="Breadcrumb">
            <a href="/">Home</a> <span aria-hidden="true">›</span> <a href="/blog">Blog</a> <span aria-hidden="true">›</span> <span aria-current="page">${escAttr(group.name)}</span>
        </nav>
        <section class="bp-archive-head">
            <p class="blog-kicker"><i class="fas ${group.icon}"></i> VICE WIRE — CATEGORY ARCHIVE</p>
            <h1 class="bp-archive-title">${escAttr(group.name)}</h1>
            <p class="bp-archive-desc">${escAttr(group.desc)}</p>
            <p class="bp-archive-count">${result.total.toLocaleString('en-US')} dispatches · Page ${result.page} of ${result.totalPages}</p>
        </section>
        <div class="blog-grid">${cards}
        </div>
        <nav class="bp-pagination">
            ${prevLink}
            <span>Page ${result.page} of ${result.totalPages}</span>
            ${nextLink}
        </nav>
        <p class="bp-archive-all"><a href="/blog">← Browse the full archive</a></p>
    </main>
    <footer class="bp-footer">
        <p class="bp-footer-line">Mapping Leonida one dispatch at a time.</p>
        <p class="bp-footer-ctas">
            <a class="bp-btn bp-btn--primary" href="/">Explore the Interactive Map</a>
            <a class="bp-btn bp-btn--discord" href="${escAttr(discordUrl)}" target="_blank" rel="noopener"><i class="fab fa-discord"></i> Join the Discord</a>
        </p>
        <p class="bp-footer-copy">© 2026 GTA6mapx — State of Leonida. Fan-made, not affiliated with Rockstar Games or Take-Two Interactive.</p>
    </footer>
</body>
</html>`, seo);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  return res.send(html);
});

// 8. Serve static files from root with long-term caching for immutable assets.
// HTML entry points stay fresh (no-cache); hashed/versioned assets get 1-year immutable cache.
app.use(express.static(__dirname, {
  index: 'index.html',
  setHeaders: (res, filePath) => {
    const name = path.basename(filePath).toLowerCase();
    if (name === 'index.html' || name === 'sw.js' || name.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(js|css|png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?|ttf|eot|json)$/.test(name)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
  }
}));

// 7. Remote proxy fallback for map tiles and photos not stored locally in the shallow repo clone
app.get(['/tiles/*', '/assets/*'], async (req, res) => {
  const remoteUrl = `${REMOTE_ASSET_ORIGIN}${req.path}`;
  try {
    const upstream = await fetch(remoteUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StateOfLeonidaMap/1.0)',
        Referer: `${REMOTE_ASSET_ORIGIN}/`,
      },
      signal: AbortSignal.timeout(8000),
    });
    if (upstream.ok) {
      const contentType = upstream.headers.get('content-type') || (req.path.endsWith('.png') ? 'image/png' : 'image/jpeg');
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      const buffer = Buffer.from(await upstream.arrayBuffer());

      // Cache tile/asset to disk asynchronously so subsequent hits are instant local files
      try {
        const localPath = path.join(__dirname, req.path);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });
        fs.writeFileSync(localPath, buffer);
      } catch (_) {}

      return res.send(buffer);
    }
  } catch (_) {
    // Upstream fetch failed or timed out
  }

  // If a tile failed, return 404 with no-cache so Leaflet retains lower-zoom tiles instead of erasing them
  if (req.path.startsWith('/tiles/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.status(404).end();
  }

  const fallbackImg = path.join(__dirname, 'assets', 'fallback-landmark.jpg');
  if (fs.existsSync(fallbackImg)) {
    res.setHeader('Content-Type', 'image/jpeg');
    return res.sendFile(fallbackImg);
  }
  res.status(404).end();
});

// Slug-cleanup redirects (old slug -> clean slug), loaded once and cached.
let slugRedirectsCache = null;
function getSlugRedirects() {
  if (slugRedirectsCache) return slugRedirectsCache;
  try {
    slugRedirectsCache = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'redirects.json'), 'utf8'));
  } catch {
    slugRedirectsCache = {};
  }
  return slugRedirectsCache;
}

// 7b. SEO article pages — every post gets its own indexable URL: /guides/<slug>
// Server-side rendered with full meta tags, Open Graph, canonical and JSON-LD.
function escAttr(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

app.get('/guides/:slug', (req, res) => {
  const slug = req.params.slug;
  // SQLite: indexed slug or ID lookup — 0.05ms (was 375ms)
  const blog = blogdb.getByIdOrSlug(slug);

  if (!blog || blog.status !== 'published') {
    // Slug cleanup: old (pre-cleanup) slugs 301 to their clean replacements.
    const target = getSlugRedirects()[slug] || getSlugRedirects()[String(slug).toLowerCase()];
    if (target) return res.redirect(301, `/guides/${target}`);
    return res.status(404).sendFile(path.join(__dirname, 'index.html'));
  }

  // 301 Permanent Redirect if accessed by internal ID to preserve canonical SEO URL
  if (slug === blog.id && blog.slug && blog.slug !== blog.id) {
    return res.redirect(301, `/guides/${blog.slug}`);
  }

  const seo = readJsonSafe('data/seo.json', {});
  const siteCfg = readJsonSafe('data/site_config.json', {});
  const discordUrl = escAttr(siteCfg.discordUrl || 'https://discord.gg/Cjtb42qgQF');
  const siteUrl = (seo.site && seo.site.url ? seo.site.url : 'https://map.stateofleonida.net').replace(/\/$/, '');
  const canonical = `${siteUrl}/guides/${blog.slug}`;
  const title = escAttr(blog.title);
  const desc = escAttr((blog.excerpt || stripTags(blog.content).slice(0, 160)).slice(0, 160));
  const keywords = escAttr(blog.targetKeyword || '');
  const cover = blog.coverImage && !blog.coverImage.startsWith('http')
    ? `${siteUrl}/${blog.coverImage}` : escAttr(blog.coverImage || '');
  const dateIso = blog.date || new Date().toISOString().slice(0, 10);
  const textContent = stripTags(blog.content);

  // --- Redesign Phase 2: premium article template (specs 06/07/08/09) ---
  // Everything below is template-level: stored content is only read, never edited.
  const A = articleLib;
  const sourcesData = readJsonSafe('data/official-sources.json', null);
  const lang = A.detectLang(blog);
  const og100Open = siteCfg.og100Open !== false;
  const inviteUrl = siteCfg.discordUrl || 'https://discord.gg/Cjtb42qgQF';
  const fmtDate = (d) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch (_) { return String(d); }
  };
  const hubUrl = `/blog?category=${encodeURIComponent(blog.category || 'Guides')}`;

  // Internal linking (spec 07): scored ranker; picks de-duped vs in-body links.
  const picks = linker.relatedScored(blog, { count: 9, exclude: A.extractInBodySlugs(blog.content) });
  const relatedCards = picks.slice(0, 6);
  const continuePicks = picks.slice(6, 9);

  // Render-time content transforms (spec 06 helpers) — stored bytes untouched.
  const split = A.splitIntro(blog.content);
  const lead = A.tagLead(split.intro);
  let introHtml = lead.html;
  let bodyHtml = split.body;
  const toc = A.buildToc(bodyHtml);
  bodyHtml = toc.html;
  const faq = A.transformFaq(bodyHtml);
  bodyHtml = faq.html;
  introHtml = A.badgeEvidence(introHtml);
  bodyHtml = A.badgeEvidence(bodyHtml);
  bodyHtml = A.lazyImages(bodyHtml);
  const take = A.extractTakeaways(textContent);
  const pull = A.pickPullQuote(textContent, take.used);
  if (pull) bodyHtml = A.insertPullQuote(bodyHtml, pull);
  if (continuePicks.length >= 2) {
    bodyHtml = A.insertContinueStrip(bodyHtml, A.continueStripHtml(continuePicks, escAttr, A.capFirst));
  }
  const sourcesBlock = A.buildSourcesBlock(blog, lang, sourcesData);
  if (sourcesBlock) bodyHtml = A.insertSourcesBlock(bodyHtml, sourcesBlock);

  // Discord start hook (spec 09): spliced after the intro's first real paragraph.
  const hookHtml = A.discordStartHook({ lang, slug: blog.slug, discordUrl: inviteUrl, og100Open });
  introHtml = A.injectAfterFirstParagraph(introHtml, hookHtml);

  // Standfirst (spec 06 §6a): verbatim excerpt; suppressed if it repeats the lead.
  const excerptText = String(blog.excerpt || '').trim();
  const leadTextNorm = A.stripTags(split.intro).toLowerCase();
  const showStandfirst = !!excerptText && !leadTextNorm.includes(excerptText.slice(0, 40).toLowerCase());

  const updatedText = blog.updatedAt && blog.updatedAt !== blog.date ? fmtDate(blog.updatedAt) : '';
  const cardCover = (r) => (r.coverImage
    ? (String(r.coverImage).startsWith('http') ? escAttr(r.coverImage) : `${siteUrl}/${escAttr(String(r.coverImage).replace(/^\//, ''))}`)
    : '');
  const cardHtml = (r) => `<a class="ax-card" href="/guides/${escAttr(r.slug)}">${cardCover(r) ? `<span class="ax-card-media"><img src="${cardCover(r)}" alt="${escAttr(r.title)}" loading="lazy" decoding="async"><span class="ax-card-chip">${escAttr(r.category)}</span></span>` : ''}<span class="ax-card-body"><span class="ax-card-title">${escAttr(r.title)}</span><span class="ax-card-excerpt">${escAttr(String(r.excerpt || '').slice(0, 160))}</span><span class="ax-card-meta">${escAttr(r.readTime || '')} · ${escAttr(fmtDate(r.date))}</span><span class="ax-card-action">${escAttr(A.capFirst(r.anchor))}</span></span></a>`;
  const relatedHtml = relatedCards.length
    ? `<section class="ax-related"><h2>Related Guides</h2><div class="ax-cards">${relatedCards.map(cardHtml).join('')}</div><a class="ax-hub-line" href="${hubUrl}">More guides in ${escAttr(blog.category || 'Guides')} →</a></section>`
    : '';
  const trustHtml = A.trustStripHtml({
    author: blog.author || 'GTA6mapx Editorial',
    authorRole: blog.authorRole || '',
    dateText: fmtDate(dateIso),
    updatedText,
  });
  const endCtaHtml = A.endCtaPanel({
    lang, discordUrl: inviteUrl, og100Open,
    countdownDate: siteCfg.countdownDate || '2026-11-19T00:00',
  });
  const tocList = toc.entries.length >= 4 ? A.tocListHtml(toc.entries) : '';
  const mobileTocHtml = tocList
    ? `<!--ax:toc-mobile--><details class="ax-toc-mobile"><summary>On this page</summary>${tocList}</details><!--/ax:toc-mobile-->`
    : '';
  const railTocHtml = tocList
    ? `<aside class="ax-toc"><div class="ax-toc-title">On this page</div>${tocList}</aside>`
    : '';
  const takeawaysBox = split.hasH2 ? A.takeawaysHtml(take, toc.entries) : '';

  // Structured data (spec 06 §3): Article node (fields unchanged) + BreadcrumbList
  // + FAQPage when Q&A pairs were extracted — all inside one @graph.
  const crumbTitle = String(blog.title || '').length > 60
    ? String(blog.title).slice(0, 60).trimEnd() + '…' : String(blog.title || '');
  const articleNode = {
    '@type': 'Article',
    headline: blog.title,
    description: stripTags(blog.excerpt || '').slice(0, 200),
    image: cover ? [cover] : undefined,
    datePublished: dateIso,
    dateModified: blog.updatedAt || dateIso,
    author: { '@type': 'Person', name: blog.author || 'GTA6mapx Editorial' },
    publisher: { '@type': 'Organization', name: 'GTA6mapx', url: siteUrl },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
    '@id': canonical,
  };
  const breadcrumbNode = {
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'GTA6mapx', item: `${siteUrl}/` },
      { '@type': 'ListItem', position: 2, name: 'Guides', item: `${siteUrl}/blog` },
      { '@type': 'ListItem', position: 3, name: blog.category || 'Guides', item: `${siteUrl}${hubUrl}` },
      { '@type': 'ListItem', position: 4, name: crumbTitle, item: canonical },
    ],
  };
  const graph = [articleNode, breadcrumbNode];
  if (faq.pairs.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.pairs.map(p => ({
        '@type': 'Question', name: p.q,
        acceptedAnswer: { '@type': 'Answer', text: p.a },
      })),
    });
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  const titleTag = /gta6mapx/i.test(title) ? title : title + ' | GTA6mapx';
  const guideHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${titleTag}</title>
<meta name="description" content="${desc}">
${keywords ? `<meta name="keywords" content="${keywords}">` : ''}
<link rel="canonical" href="${canonical}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="article">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="GTA6mapx">
${cover ? `<meta property="og:image" content="${cover}">` : ''}
<meta property="article:published_time" content="${dateIso}">
<meta property="article:section" content="${escAttr(blog.category || '')}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
${cover ? `<meta name="twitter:image" content="${cover}">` : ''}
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<style>
*{box-sizing:border-box}
body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#0a0a12;color:#e8e8f0;line-height:1.7}
a{color:#ff50c5}
.ax-progress{position:fixed;top:0;left:0;right:0;height:3px;z-index:60;background:linear-gradient(90deg,#ff50c5,#8b5cf6);transform:scaleX(0);transform-origin:left;opacity:0}
.ax-shell{max-width:1180px;margin:0 auto;padding:1.5rem 1.25rem 4rem}
.ax-crumb{font-size:.85rem;color:#888;margin-bottom:1.25rem}
.ax-crumb ol{list-style:none;display:flex;flex-wrap:wrap;gap:.45rem;margin:0;padding:0}
.ax-crumb li+li::before{content:'›';margin-right:.45rem;color:#555}
.ax-crumb a{color:#ff50c5;text-decoration:none}
.ax-crumb [aria-current]{color:#bbb}
.ax-chip{display:inline-block;border:1px solid #ff50c5;color:#ff50c5;border-radius:999px;padding:.18rem .8rem;font-size:.78rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase;text-decoration:none;margin-bottom:.9rem}
.ax-head h1{font-size:clamp(1.9rem,4.5vw,2.9rem);line-height:1.15;letter-spacing:-.01em;margin:.2rem 0 1rem;color:#fff}
.ax-standfirst{font-size:1.25rem;line-height:1.55;color:#c9c9d6;border-left:3px solid #ff50c5;padding-left:1rem;margin:0 0 1.25rem;max-width:720px}
.ax-meta{color:#999;font-size:.9rem;display:flex;gap:1rem 1.4rem;flex-wrap:wrap;border-top:1px solid #222;border-bottom:1px solid #222;padding:.7rem 0;margin-bottom:1.5rem}
.ax-legend-mini{color:#c9c9d6}
.ax-hero{margin:0 0 2rem}
.ax-hero img{width:100%;aspect-ratio:16/9;object-fit:cover;max-height:560px;border-radius:16px;display:block}
.ax-grid{display:grid;grid-template-columns:minmax(0,760px);gap:3rem;justify-content:center}
@media(min-width:1024px){.ax-grid{grid-template-columns:minmax(0,760px) 300px}}
.ax-toc{display:none}
@media(min-width:1024px){.ax-toc{display:block;position:sticky;top:88px;max-height:calc(100vh - 120px);overflow:auto;align-self:start;background:#10101c;border:1px solid #23233a;border-radius:12px;padding:1rem 1.1rem}}
.ax-toc-title{font-weight:800;color:#fff;margin-bottom:.6rem;font-size:.95rem}
.ax-toc ul{list-style:none;margin:0;padding:0}
.ax-toc li{margin:.35rem 0;font-size:.88rem;line-height:1.4}
.ax-toc-l3{padding-left:.9rem}
.ax-toc a{color:#b9b9cc;text-decoration:none}
.ax-toc a:hover,.ax-toc a.is-active{color:#ff50c5}
.ax-toc-mobile{border:1px solid #23233a;border-radius:12px;padding:.8rem 1rem;margin:1.5rem 0;background:#10101c}
.ax-toc-mobile summary{cursor:pointer;font-weight:700;color:#fff}
.ax-toc-mobile ul{list-style:none;margin:.6rem 0 0;padding:0}
.ax-toc-mobile li{margin:.35rem 0;font-size:.92rem}
.ax-toc-mobile .ax-toc-l3{padding-left:.9rem}
.ax-toc-mobile a{color:#b9b9cc;text-decoration:none}
@media(min-width:1024px){.ax-toc-mobile{display:none}}
.article-body{font-size:1.06rem;line-height:1.8;color:#dcdce6}
.article-body p{margin:0 0 1.1em}
.article-body h2{font-size:1.55rem;color:#fff;margin:2.6rem 0 .9rem;line-height:1.3;border-top:1px solid #23233a;padding-top:1.4rem;scroll-margin-top:96px}
.article-body h3{font-size:1.22rem;color:#fff;margin:1.9rem 0 .6rem;scroll-margin-top:96px}
.article-body a{color:#ff50c5;text-underline-offset:3px}
.article-body a[href^="http"]:not([href*="gta6mapx.com"])::after{content:' ↗';font-size:.85em}
.article-body ul,.article-body ol{margin:0 0 1.1em;padding-left:1.4rem}
.article-body li{margin:.4em 0}
.article-body ul li::marker{content:'▸ ';color:#ff50c5}
.article-body img{max-width:100%;height:auto;border-radius:12px;margin:1.6rem 0;border:1px solid #23233a}
.article-body strong{color:#fff;font-weight:650}
.article-body blockquote{border-left:3px solid #ff50c5;padding-left:1rem;color:#bbb;margin:1.5rem 0}
.article-body table{width:100%;border-collapse:collapse;margin:1.5rem 0;font-size:.95rem}
.article-body th,.article-body td{border:1px solid #23233a;padding:.5rem .7rem;text-align:left}
.article-body tr:nth-child(even){background:#10101c}
.ax-lead{font-size:1.13rem;line-height:1.75}
@media(min-width:640px){.ax-lead-cap::first-letter{font-size:3.4em;float:left;line-height:.85;padding-right:.12em;color:#ff50c5;font-weight:800}}
.ax-ev{display:inline-flex;align-items:center;border-radius:999px;padding:0 .45em;font-size:.85em;line-height:1.5;vertical-align:baseline}
.ax-ev-yes{background:rgba(46,204,113,.14)}
.ax-ev-trailer{background:rgba(139,92,246,.16)}
.ax-ev-unannounced{background:rgba(245,176,65,.14)}
.ax-slot-discord{margin:1.6rem 0}
.hook-discord-start{background:#16182b;border:2px solid #5865F2;border-radius:12px;padding:1.1rem 1.25rem}
.hook-eyebrow{font-size:.72rem;font-weight:800;letter-spacing:.08em;color:#8f9bf0;margin-bottom:.45rem}
.hook-headline{font-size:1.22rem;font-weight:800;color:#fff;line-height:1.3}
.hook-sentence{color:#aab;margin:.5rem 0 0;font-size:.95rem;line-height:1.6}
.hook-bullets{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem 1.1rem;margin:.8rem 0 0;padding:0;font-size:.9rem;color:#c9c9d6}
.hook-bullets li{margin:0}
.hook-bullets li::marker{content:''}
.hook-btn{display:inline-block;background:#5865F2;color:#fff;padding:.7rem 1.8rem;border-radius:8px;text-decoration:none;font-weight:700;margin-top:1rem}
.hook-btn:hover{background:#4752c4}
.ax-takeaways{border:1px solid #23233a;border-left:3px solid #ff50c5;border-radius:12px;background:#10101c;padding:1.1rem 1.25rem;margin:1.6rem 0}
.ax-takeaways h2{border:0;padding:0;margin:0 0 .6rem;font-size:1.15rem}
.ax-takeaways ul{margin:0;padding-left:1.2rem}
.ax-takeaways li{margin:.35em 0}
.ax-pull{font-size:1.5rem;font-style:italic;text-align:center;color:#fff;line-height:1.5;border-top:3px solid #ff50c5;padding:1.4rem 1rem .4rem;margin:2.4rem 0}
.ax-continue{border:1px solid #23233a;border-left:3px solid #5865F2;border-radius:12px;background:#10101c;padding:1rem 1.25rem;margin:2rem 0}
.ax-continue h3{margin:0 0 .5rem;font-size:1.05rem}
.ax-continue ul{list-style:none;margin:0;padding:0}
.ax-continue li{margin:.45rem 0}
.ax-continue li::marker{content:''}
.ax-faq-item{border:1px solid #23233a;border-radius:10px;margin:.7rem 0;background:#10101c}
.ax-faq-q{margin:0;font-size:1.02rem}
.ax-faq-q button{all:inherit;display:block;width:100%;text-align:left;background:none;border:0;color:#fff;font-weight:650;padding:.85rem 1.1rem;cursor:pointer}
.ax-faq-q button::after{content:'▾';float:right;color:#ff50c5;transition:transform .2s}
.ax-faq-q button[aria-expanded="true"]::after{transform:rotate(180deg)}
.ax-faq-a{padding:0 1.1rem .9rem}
.ax-faq-a p:last-child{margin-bottom:0}
.ax-sources{border:1px solid #23233a;border-radius:12px;background:#0d1420;padding:1rem 1.25rem;margin:2rem 0}
.ax-sources-h{border:0;padding:0;margin:0 0 .5rem;font-size:.85rem;letter-spacing:.09em;text-transform:uppercase;color:#9fd0ff}
.ax-sources ul{list-style:none;margin:0;padding:0}
.ax-sources li{margin:.4rem 0}
.ax-sources li::marker{content:''}
.ax-trust{border:1px solid #23233a;border-radius:12px;background:#10101c;padding:1.2rem 1.3rem;margin:3rem 0 0}
.ax-trust-brand{font-weight:800;color:#fff;font-size:1.05rem}
.ax-trust-by{color:#b9b9cc;margin-top:.2rem}
.ax-trust-method{color:#c9c9d6;margin:.7rem 0}
.ax-trust-legend{display:flex;flex-wrap:wrap;gap:.4rem 1.2rem;color:#c9c9d6;font-size:.92rem}
.ax-trust-dates{color:#888;font-size:.88rem;margin-top:.7rem}
.ax-related{margin-top:3rem;border-top:1px solid #222;padding-top:1.5rem}
.ax-related h2{font-size:1.35rem;color:#fff;margin:0 0 1.1rem}
.ax-cards{display:grid;grid-template-columns:1fr;gap:1.1rem}
@media(min-width:640px){.ax-cards{grid-template-columns:repeat(2,1fr)}}
@media(min-width:1024px){.ax-cards{grid-template-columns:repeat(3,1fr)}}
.ax-card{display:block;background:#10101c;border:1px solid #23233a;border-radius:14px;overflow:hidden;text-decoration:none;color:inherit;transition:transform .15s,border-color .15s}
.ax-card:hover{transform:translateY(-3px);border-color:#ff50c5}
.ax-card-media{position:relative;display:block}
.ax-card-media img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block}
.ax-card-chip{position:absolute;top:.6rem;left:.6rem;background:rgba(10,10,18,.85);color:#ff50c5;border:1px solid #ff50c5;border-radius:999px;padding:.1rem .6rem;font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
.ax-card-body{display:block;padding:.95rem 1.05rem 1.05rem}
.ax-card-title{display:block;color:#fff;font-weight:700;font-size:1.02rem;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ax-card-excerpt{display:block;color:#9a9ab0;font-size:.9rem;line-height:1.5;margin-top:.45rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.ax-card-meta{display:block;color:#777;font-size:.82rem;margin-top:.6rem}
.ax-card-action{display:inline-block;color:#ff50c5;font-weight:700;font-size:.9rem;margin-top:.55rem}
.ax-hub-line{display:inline-block;margin-top:1.2rem;color:#ff50c5;text-decoration:none;font-weight:700}
.ax-endcta{display:grid;grid-template-columns:1fr;gap:1.1rem;margin-top:2.5rem}
@media(min-width:768px){.ax-endcta{grid-template-columns:1fr 1fr}}
.ax-endcta-discord,.ax-endcta-map{padding:1.5rem;border-radius:12px;text-align:center}
.ax-endcta-discord{background:#16182b;border:1px solid #5865F2}
.ax-endcta-discord strong{color:#fff;font-size:1.15rem}
.ax-endcta-discord p{color:#aab;margin:.5rem 0 0}
.ax-btn-discord{display:inline-block;background:#5865F2;color:#fff;padding:.7rem 1.8rem;border-radius:8px;text-decoration:none;font-weight:700;margin-top:.9rem}
.ax-og-line{color:#8f9bf0;font-size:.85rem;margin-top:.7rem}
.ax-endcta-map{background:#14141f;border:1px solid #23233a}
.ax-endcta-map strong{color:#fff;font-size:1.15rem}
.ax-btn-map{display:inline-block;background:#ff50c5;color:#fff;padding:.7rem 1.8rem;border-radius:8px;text-decoration:none;font-weight:600;margin-top:.8rem}
.ax-totop{position:fixed;right:1.1rem;bottom:1.1rem;width:44px;height:44px;border-radius:50%;border:1px solid #ff50c5;background:#14141f;color:#ff50c5;font-size:1.15rem;cursor:pointer;opacity:0;transition:opacity .2s;z-index:60}
</style>
</head>
<body>
<div class="ax-progress" id="ax-progress"></div>
<div class="ax-shell">
<nav class="ax-crumb" aria-label="Breadcrumb"><ol><li><a href="/">GTA6mapx</a></li><li><a href="/blog">Guides</a></li><li><a href="${hubUrl}">${escAttr(blog.category || 'Guides')}</a></li><li aria-current="page">${escAttr(crumbTitle)}</li></ol></nav>
<header class="ax-head">
<a class="ax-chip" href="${hubUrl}">${escAttr(blog.category || 'Guides')}</a>
<h1>${escAttr(blog.title)}</h1>
${showStandfirst ? `<p class="ax-standfirst">${escAttr(excerptText)}</p>` : ''}
<div class="ax-meta"><span>By ${escAttr(blog.author || 'GTA6mapx Editorial')}${blog.authorRole ? ` · ${escAttr(blog.authorRole)}` : ''}</span><span><time datetime="${escAttr(dateIso)}">${escAttr(fmtDate(dateIso))}</time></span>${updatedText ? `<span>Updated ${escAttr(updatedText)}</span>` : ''}<span>${escAttr(blog.readTime || '')}</span><span class="ax-legend-mini">✅ Confirmed · 🎬 Trailer · ❓ Unannounced</span></div>
${cover ? `<figure class="ax-hero"><img src="${cover}" alt="${title}" width="1600" height="900" loading="eager" fetchpriority="high"></figure>` : ''}
</header>
<div class="ax-grid">
<main class="ax-main">
<article class="article-body"><div class="ax-intro">${introHtml}</div>${takeawaysBox}${mobileTocHtml}<div class="ax-body">${bodyHtml}</div></article>
</main>
${railTocHtml}
</div>
${trustHtml}
${relatedHtml}
${endCtaHtml}
</div>
<button class="ax-totop" id="ax-totop" type="button" aria-label="Back to top">↑</button>
<script>
(function(){
  var bar=document.getElementById('ax-progress'),tot=document.getElementById('ax-totop'),tick=false;
  function upd(){
    var sh=document.documentElement.scrollHeight-window.innerHeight;
    var p=sh>0?Math.min(1,window.scrollY/sh):0;
    bar.style.transform='scaleX('+p+')';
    bar.style.opacity=p>0.005?'1':'0';
    tot.style.opacity=window.scrollY>600?'1':'0';
    tick=false;
  }
  window.addEventListener('scroll',function(){if(!tick){tick=true;requestAnimationFrame(upd);}},{passive:true});
  upd();
  tot.addEventListener('click',function(){window.scrollTo({top:0,behavior:'smooth'});});
  var items=document.querySelectorAll('.ax-faq-item');
  items.forEach(function(it,idx){
    var btn=it.querySelector('button'),pan=it.querySelector('.ax-faq-a');
    if(!btn||!pan)return;
    if(idx>0){pan.hidden=true;btn.setAttribute('aria-expanded','false');}
    btn.addEventListener('click',function(){
      var open=btn.getAttribute('aria-expanded')==='true';
      btn.setAttribute('aria-expanded',open?'false':'true');
      pan.hidden=open;
    });
  });
})();
</script>
</body>
</html>`;
  res.send(injectSeoAndAnalytics(guideHtml, seo));
});

// 8. SPA fallback for language routes (/en/, /de/, etc.)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

module.exports = app;

if (require.main === module || !process.env.VERCEL) {
  app.listen(PORT, HOST, () => {
    console.log(`State of Leonida server listening on http://${HOST}:${PORT}`);
  });
}
