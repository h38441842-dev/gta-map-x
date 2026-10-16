const express = require('express');
const compression = require('compression');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;
const HOST = '0.0.0.0';
const REMOTE_ASSET_ORIGIN = process.env.REMOTE_ASSET_ORIGIN || 'https://map.stateofleonida.net';
const GTADB_ORIGIN = process.env.GTADB_ORIGIN || 'https://map.gtadb.org';

app.use(compression());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  res.sendFile(path.join(__dirname, 'sitemap.xml'));
});

// 7. Master Admin Panel & Control API
app.use('/admin', express.static(path.join(__dirname, 'admin')));
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin', 'admin.html'));
});

app.post('/api/admin/login', (req, res) => {
  const passcode = req.body?.passcode || '';
  if (passcode === 'leonida2026') {
    return res.json({ success: true, token: 'authorized_master_2026' });
  }
  return res.status(401).json({ success: false, error: 'Invalid passcode' });
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
  const allBlogs = readJsonSafe('data/blogs.json', []);
  const { category, search, all } = req.query;

  let results = Array.isArray(allBlogs) ? allBlogs : [];

  // Filter drafts unless ?all=1 is specified (for admin use)
  if (all !== '1') {
    results = results.filter(b => b.status === 'published');
  }

  if (category && category !== 'all' && category !== 'All Stories') {
    results = results.filter(b => (b.category || '').toLowerCase() === category.toLowerCase());
  }

  if (search) {
    const q = search.toLowerCase();
    results = results.filter(b => 
      (b.title || '').toLowerCase().includes(q) ||
      (b.excerpt || '').toLowerCase().includes(q) ||
      (b.author || '').toLowerCase().includes(q)
    );
  }

  // Sort by date descending
  results.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

  res.json({ success: true, count: results.length, blogs: results });
});

app.get('/api/blogs/:idOrSlug', (req, res) => {
  const { idOrSlug } = req.params;
  const allBlogs = readJsonSafe('data/blogs.json', []);
  const blog = allBlogs.find(b => b.id === idOrSlug || b.slug === idOrSlug);

  if (!blog) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  res.json({ success: true, blog });
});

app.post('/api/admin/blogs', (req, res) => {
  const data = req.body || {};
  if (!data.title) {
    return res.status(400).json({ success: false, error: 'Article title is required' });
  }

  const allBlogs = readJsonSafe('data/blogs.json', []);
  const slug = (data.slug || data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || ('article-' + Date.now());
  const targetKeyword = (data.targetKeyword || '').trim();

  // Duplicate Keyword and Slug Protection
  if (!data.allowDuplicateKeyword) {
    if (targetKeyword) {
      const kwConflict = allBlogs.find(b => (b.targetKeyword || '').trim().toLowerCase() === targetKeyword.toLowerCase());
      if (kwConflict) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          error: `Duplicate Keyword Conflict: The keyword "${targetKeyword}" is already targeted by article "${kwConflict.title}". Duplicate targeting causes keyword cannibalization on Google Search.`
        });
      }
    }
    const slugConflict = allBlogs.find(b => (b.slug || '').toLowerCase() === slug.toLowerCase());
    if (slugConflict) {
      return res.status(409).json({
        success: false,
        isDuplicate: true,
        error: `Duplicate URL Slug Conflict: The slug "${slug}" is already in use by "${slugConflict.title}". Choose a unique URL slug.`
      });
    }
  }

  const newBlog = {
    id: 'blog_' + Date.now(),
    slug: slug,
    title: data.title.trim(),
    targetKeyword: targetKeyword,
    category: data.category || 'Cartography & Leaks',
    author: data.author || 'Vice Intelligence Cartographer',
    authorRole: data.authorRole || 'GIS Staff',
    date: data.date || new Date().toISOString().slice(0, 10),
    readTime: data.readTime || '4 min read',
    coverImage: data.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg',
    excerpt: data.excerpt || data.title,
    content: data.content || '<p>Article content pending...</p>',
    hotspotKey: data.hotspotKey || '',
    lat: data.lat !== undefined ? parseFloat(data.lat) : null,
    lng: data.lng !== undefined ? parseFloat(data.lng) : null,
    featured: Boolean(data.featured),
    status: data.status || 'published'
  };

  // If new post is marked featured, unfeature others
  if (newBlog.featured) {
    allBlogs.forEach(b => { b.featured = false; });
  }

  allBlogs.unshift(newBlog);

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'blogs.json'), JSON.stringify(allBlogs, null, 2));
    return res.json({ success: true, blog: newBlog });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/admin/blogs/:id', (req, res) => {
  const { id } = req.params;
  const data = req.body || {};
  const allBlogs = readJsonSafe('data/blogs.json', []);
  const index = allBlogs.findIndex(b => b.id === id);

  if (index === -1) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  const targetKeyword = (data.targetKeyword || '').trim();
  const slug = (data.slug || '').trim();

  // Duplicate Keyword and Slug Protection (excluding self)
  if (!data.allowDuplicateKeyword) {
    if (targetKeyword) {
      const kwConflict = allBlogs.find(b => b.id !== id && (b.targetKeyword || '').trim().toLowerCase() === targetKeyword.toLowerCase());
      if (kwConflict) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          error: `Duplicate Keyword Conflict: The keyword "${targetKeyword}" is already targeted by article "${kwConflict.title}".`
        });
      }
    }
    if (slug) {
      const slugConflict = allBlogs.find(b => b.id !== id && (b.slug || '').toLowerCase() === slug.toLowerCase());
      if (slugConflict) {
        return res.status(409).json({
          success: false,
          isDuplicate: true,
          error: `Duplicate URL Slug Conflict: The slug "${slug}" is already used by "${slugConflict.title}".`
        });
      }
    }
  }

  if (data.featured) {
    allBlogs.forEach(b => { b.featured = false; });
  }

  const existing = allBlogs[index];
  allBlogs[index] = {
    ...existing,
    title: data.title !== undefined ? data.title.trim() : existing.title,
    slug: data.slug !== undefined ? data.slug.trim() : existing.slug,
    targetKeyword: data.targetKeyword !== undefined ? data.targetKeyword.trim() : (existing.targetKeyword || ''),
    category: data.category !== undefined ? data.category : existing.category,
    author: data.author !== undefined ? data.author : existing.author,
    authorRole: data.authorRole !== undefined ? data.authorRole : existing.authorRole,
    date: data.date !== undefined ? data.date : existing.date,
    readTime: data.readTime !== undefined ? data.readTime : existing.readTime,
    coverImage: data.coverImage !== undefined ? data.coverImage : existing.coverImage,
    excerpt: data.excerpt !== undefined ? data.excerpt : existing.excerpt,
    content: data.content !== undefined ? data.content : existing.content,
    hotspotKey: data.hotspotKey !== undefined ? data.hotspotKey : existing.hotspotKey,
    lat: data.lat !== undefined ? parseFloat(data.lat) : existing.lat,
    lng: data.lng !== undefined ? parseFloat(data.lng) : existing.lng,
    featured: data.featured !== undefined ? Boolean(data.featured) : existing.featured,
    status: data.status !== undefined ? data.status : existing.status,
    updatedAt: new Date().toISOString()
  };

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'blogs.json'), JSON.stringify(allBlogs, null, 2));
    return res.json({ success: true, blog: allBlogs[index] });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/admin/blogs/:id', (req, res) => {
  const { id } = req.params;
  let allBlogs = readJsonSafe('data/blogs.json', []);
  const initialLen = allBlogs.length;
  allBlogs = allBlogs.filter(b => b.id !== id);

  if (allBlogs.length === initialLen) {
    return res.status(404).json({ success: false, error: 'Article not found' });
  }

  try {
    fs.writeFileSync(path.join(__dirname, 'data', 'blogs.json'), JSON.stringify(allBlogs, null, 2));
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 8. Serve static files from root
app.use(express.static(__dirname, { index: 'index.html' }));

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

// 8. SPA fallback for language routes (/en/, /de/, etc.)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, HOST, () => {
  console.log(`State of Leonida server listening on http://${HOST}:${PORT}`);
});
