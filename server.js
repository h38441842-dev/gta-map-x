const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const blogdb = require('./lib/blogdb');

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
  const urls = [`${siteUrl}/`, ...published.map(b => `${siteUrl}/guides/${encodeURIComponent(b.slug)}`)];
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
    invalidateSitemapCache();
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

app.get('/api/blogs', (req, res) => {
  const { category, search, all, page, limit } = req.query;

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

  // SQLite: indexed WHERE + LIMIT/OFFSET — 1.7ms for 50 rows (was 316ms)
  const result = blogdb.list({
    search,
    category: (category === 'All Stories') ? 'all' : category,
    status: includeDrafts ? 'all' : 'published',
    page, limit: limit || 0,  // 0 = backwards-compat full list
    includeDrafts,
  });

  res.json({ success: true, count: result.blogs.length, total: result.total, page: result.page, totalPages: result.totalPages, blogs: result.blogs });
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
    invalidateSitemapCache();
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
    invalidateSitemapCache();
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
  invalidateSitemapCache();
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

  // Related articles (same category, exclude self, max 6) — SQLite indexed
  const related = blogdb.related(blog, 6);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: blog.title,
    description: stripTags(blog.excerpt || '').slice(0, 200),
    image: cover ? [cover] : undefined,
    datePublished: dateIso,
    dateModified: blog.updatedAt || dateIso,
    author: { '@type': 'Person', name: blog.author || 'GTA6mapx Editorial' },
    publisher: { '@type': 'Organization', name: 'GTA6mapx', url: siteUrl },
    mainEntityOfPage: { '@type': 'WebPage', '@id': canonical },
  };

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
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;margin:0;background:#0a0a12;color:#e8e8f0;line-height:1.7}
.wrap{max-width:780px;margin:0 auto;padding:2rem 1.25rem}
.crumb{font-size:.85rem;color:#888;margin-bottom:1rem}.crumb a{color:#ff50c5;text-decoration:none}
h1{font-size:2rem;line-height:1.3;margin:.5rem 0 1rem}
.meta{color:#999;font-size:.9rem;margin-bottom:1.5rem;display:flex;gap:1rem;flex-wrap:wrap}
.hero{width:100%;border-radius:12px;margin:1rem 0}
.article-body img{max-width:100%;height:auto;border-radius:8px}
.article-body h2{margin-top:2rem;color:#fff}.article-body h3{margin-top:1.5rem;color:#fff}
.article-body a{color:#ff50c5}.article-body blockquote{border-left:3px solid #ff50c5;padding-left:1rem;color:#bbb;margin:1.5rem 0}
.related{margin-top:3rem;border-top:1px solid #222;padding-top:1.5rem}
.related h2{font-size:1.2rem}.related ul{list-style:none;padding:0}.related li{margin:.6rem 0}.related a{color:#ff50c5;text-decoration:none}
.cta{margin-top:2rem;padding:1.5rem;background:#14141f;border-radius:12px;text-align:center}
.cta a{display:inline-block;background:#ff50c5;color:#fff;padding:.7rem 1.8rem;border-radius:8px;text-decoration:none;font-weight:600;margin-top:.8rem}
.cta-discord{margin-top:2rem;padding:1.5rem;background:#16182b;border:1px solid #5865F2;border-radius:12px;text-align:center}
.cta-discord p{color:#aab;margin:.4rem 0 0}
.cta-discord a{display:inline-block;background:#5865F2;color:#fff;padding:.7rem 1.8rem;border-radius:8px;text-decoration:none;font-weight:600;margin-top:.9rem}
</style>
</head>
<body>
<div class="wrap">
<nav class="crumb"><a href="/">GTA6mapx</a> &rsaquo; <a href="/#blog">Guides</a> &rsaquo; ${escAttr(blog.category || '')}</nav>
<h1>${escAttr(blog.title)}</h1>
<div class="meta"><span>By ${escAttr(blog.author || 'GTA6mapx Editorial')}</span><span>${escAttr(dateIso)}</span><span>${escAttr(blog.readTime || '')}</span><span>${escAttr(blog.category || '')}</span></div>
${cover ? `<img class="hero" src="${cover}" alt="${title}" loading="eager">` : ''}
<article class="article-body">${blog.content}</article>
${related.length ? `<section class="related"><h2>Related Guides</h2><ul>${related.map(r => `<li><a href="/guides/${escAttr(r.slug)}">${escAttr(r.title)}</a></li>`).join('')}</ul></section>` : ''}
<div class="cta-discord"><strong>💬 Join the GTA6mapx Discord</strong><p>Map discoveries, trailer breakdowns, weekly landmark hunts and the countdown to launch day — November 19, 2026. The first 100 members get the OG — Founding 100 role, forever.</p><a href="${discordUrl}" target="_blank" rel="noopener">Join the Discord Server</a></div>
<div class="cta"><strong>Explore the interactive GTA 6 map</strong><br><a href="/">Open GTA6mapx Map</a></div>
</div>
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
