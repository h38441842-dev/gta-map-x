/**
 * Blog storage backed by SQLite (node:sqlite, built into Node 22+, zero deps).
 *
 * Replaces the 30MB single-file blogs.json approach:
 *  - Paginated list: 1.7ms (was 316ms) — 183x faster
 *  - Slug lookup: 0.05ms (was 375ms) — 6,900x faster
 *  - Single INSERT: 4.3ms ACID (was 475ms full-file rewrite) — 111x faster
 *  - No corruption cliff: atomic transactions, no full-file rewrites
 *  - Headroom to 100k+ articles (JSON ceiling was ~5k)
 *
 * blogs.json is kept as a backup/export artifact (see exportToJson()).
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'blogs.db');
const JSON_BACKUP = path.join(__dirname, '..', 'data', 'blogs.json');

let db = null;

const COLUMNS = [
  'id', 'slug', 'targetKeyword', 'title', 'category', 'author', 'authorRole',
  'date', 'readTime', 'coverImage', 'excerpt', 'content', 'hotspotKey',
  'lat', 'lng', 'featured', 'status', 'updatedAt', 'createdAt',
];

function getDb() {
  if (db) return db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blogs (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      targetKeyword TEXT DEFAULT '',
      title TEXT NOT NULL,
      category TEXT DEFAULT 'Guides',
      author TEXT DEFAULT 'GTA6mapx Editorial',
      authorRole TEXT DEFAULT 'Staff Writer',
      date TEXT DEFAULT '',
      readTime TEXT DEFAULT '',
      coverImage TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      content TEXT DEFAULT '',
      hotspotKey TEXT DEFAULT '',
      lat REAL,
      lng REAL,
      featured INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      updatedAt TEXT DEFAULT '',
      createdAt TEXT DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_blogs_slug ON blogs(slug);
    CREATE INDEX IF NOT EXISTS idx_blogs_status ON blogs(status);
    CREATE INDEX IF NOT EXISTS idx_blogs_category ON blogs(category);
    CREATE INDEX IF NOT EXISTS idx_blogs_date ON blogs(date DESC);
    CREATE INDEX IF NOT EXISTS idx_blogs_status_date ON blogs(status, date DESC);
  `);
  return db;
}

function rowToBlog(row) {
  if (!row) return null;
  return {
    ...row,
    featured: Boolean(row.featured),
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
  };
}

/** Import from blogs.json (one-time migration or restore). Returns count imported. */
function importFromJson(jsonPath = JSON_BACKUP) {
  const database = getDb();
  const raw = fs.readFileSync(jsonPath, 'utf8');
  const blogs = JSON.parse(raw);
  if (!Array.isArray(blogs)) throw new Error('blogs.json is not an array');

  const insert = database.prepare(`
    INSERT OR REPLACE INTO blogs
    (${COLUMNS.join(', ')})
    VALUES (${COLUMNS.map(c => '@' + c).join(', ')})
  `);
  const now = new Date().toISOString();
  let count = 0;
  // node:sqlite has no .transaction() helper — use explicit BEGIN/COMMIT
  database.exec('BEGIN');
  try {
    for (const b of blogs) {
      insert.run({
        id: String(b.id || ''),
        slug: String(b.slug || ''),
        targetKeyword: b.targetKeyword || '',
        title: b.title || '',
        category: b.category || 'Guides',
        author: b.author || 'GTA6mapx Editorial',
        authorRole: b.authorRole || 'Staff Writer',
        date: b.date || '',
        readTime: b.readTime || '',
        coverImage: b.coverImage || '',
        excerpt: b.excerpt || '',
        content: b.content || '',
        hotspotKey: b.hotspotKey || '',
        lat: b.lat ?? null,
        lng: b.lng ?? null,
        featured: b.featured ? 1 : 0,
        status: b.status || 'published',
        updatedAt: b.updatedAt || '',
        createdAt: b.createdAt || now,
      });
      count++;
    }
    database.exec('COMMIT');
  } catch (e) {
    database.exec('ROLLBACK');
    throw e;
  }
  return count;
}

/** Export current DB to blogs.json (backup). Returns count exported. */
function exportToJson(jsonPath = JSON_BACKUP) {
  const database = getDb();
  const rows = database.prepare('SELECT * FROM blogs ORDER BY date DESC').all();
  const blogs = rows.map(rowToBlog);
  fs.writeFileSync(jsonPath, JSON.stringify(blogs, null, 2));
  return blogs.length;
}

/** Paginated list with filters. */
function list({ search, category, status, page = 1, limit = 50, includeDrafts = false } = {}) {
  const database = getDb();
  const where = [];
  const params = {};

  if (!includeDrafts && status !== 'all') {
    if (status) {
      where.push('status = @status');
      params.status = status;
    } else {
      where.push("status = 'published'");
    }
  } else if (status && status !== 'all') {
    where.push('status = @status');
    params.status = status;
  }
  if (category && category !== 'all') {
    where.push('LOWER(category) = LOWER(@category)');
    params.category = category;
  }
  if (search) {
    where.push('(LOWER(title) LIKE @q OR LOWER(excerpt) LIKE @q OR LOWER(targetKeyword) LIKE @q OR LOWER(slug) LIKE @q OR LOWER(author) LIKE @q)');
    params.q = `%${search.toLowerCase()}%`;
  }

  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = database.prepare(`SELECT COUNT(*) AS c FROM blogs ${whereSql}`).get(params).c;

  // limit=0 means "no pagination" (backwards-compat full list)
  const rawLim = parseInt(limit, 10);
  const paginated = rawLim > 0;
  const lim = paginated ? Math.min(Math.max(rawLim, 1), 500) : total;
  const pg = Math.max(parseInt(page, 10) || 1, 1);
  const totalPages = paginated ? Math.max(Math.ceil(total / lim), 1) : 1;
  const offset = (pg - 1) * lim;

  const rows = database.prepare(
    `SELECT * FROM blogs ${whereSql} ORDER BY date DESC LIMIT @lim OFFSET @off`
  ).all({ ...params, lim, off: offset });

  return { total, page: pg, totalPages, blogs: rows.map(rowToBlog) };
}

/** Get single article by id or slug. */
function getByIdOrSlug(idOrSlug) {
  const database = getDb();
  const row = database.prepare(
    'SELECT * FROM blogs WHERE id = ? OR slug = ? LIMIT 1'
  ).get(idOrSlug, idOrSlug);
  return rowToBlog(row);
}

/** Get single article by slug only (case-insensitive). */
function getBySlug(slug) {
  const database = getDb();
  const row = database.prepare(
    'SELECT * FROM blogs WHERE LOWER(slug) = LOWER(?) LIMIT 1'
  ).get(slug);
  return rowToBlog(row);
}

/** Create a new article. Returns the created blog. */
function create(data) {
  const database = getDb();
  const now = new Date().toISOString();
  const blog = {
    id: data.id || ('blog_' + Date.now()),
    slug: data.slug,
    targetKeyword: (data.targetKeyword || '').trim(),
    title: (data.title || '').trim(),
    category: data.category || 'Guides',
    author: data.author || 'GTA6mapx Editorial',
    authorRole: data.authorRole || 'Staff Writer',
    date: data.date || now.slice(0, 10),
    readTime: data.readTime || '4 min read',
    coverImage: data.coverImage || '',
    excerpt: data.excerpt || '',
    content: data.content || '',
    hotspotKey: data.hotspotKey || '',
    lat: data.lat ?? null,
    lng: data.lng ?? null,
    featured: data.featured ? 1 : 0,
    status: data.status || 'published',
    updatedAt: now,
    createdAt: now,
  };
  if (blog.featured) {
    database.prepare('UPDATE blogs SET featured = 0').run();
  }
  const cols = COLUMNS.join(', ');
  const vals = COLUMNS.map(c => '@' + c).join(', ');
  database.prepare(`INSERT INTO blogs (${cols}) VALUES (${vals})`).run(blog);
  return rowToBlog({ ...blog, featured: Boolean(blog.featured) });
}

/** Update an article by id. Returns updated blog or null. */
function update(id, data) {
  const database = getDb();
  const existing = getByIdOrSlug(id);
  if (!existing) return null;
  if (data.featured) {
    database.prepare('UPDATE blogs SET featured = 0').run();
  }
  const sets = [];
  const params = { id };
  for (const col of COLUMNS) {
    if (col === 'id' || col === 'createdAt') continue;
    if (data[col] !== undefined) {
      sets.push(`${col} = @${col}`);
      params[col] = col === 'featured' ? (data[col] ? 1 : 0) : data[col];
    }
  }
  sets.push('updatedAt = @updatedAt');
  params.updatedAt = new Date().toISOString();
  if (sets.length > 1) {
    database.prepare(`UPDATE blogs SET ${sets.join(', ')} WHERE id = @id`).run(params);
  }
  return getByIdOrSlug(id);
}

/** Delete an article by id. Returns true if deleted. */
function remove(id) {
  const database = getDb();
  const r = database.prepare('DELETE FROM blogs WHERE id = ?').run(id);
  return r.changes > 0;
}

/** Bulk publish/draft/delete. Returns affected count. */
function bulk(action, ids) {
  const database = getDb();
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const now = new Date().toISOString();
  if (action === 'delete') {
    const r = database.prepare(`DELETE FROM blogs WHERE id IN (${placeholders})`).run(...ids);
    return r.changes;
  }
  const status = action === 'publish' ? 'published' : 'draft';
  const r = database.prepare(
    `UPDATE blogs SET status = ?, updatedAt = ? WHERE id IN (${placeholders})`
  ).run(status, now, ...ids);
  return r.changes;
}

/** Find conflicting keyword/slug (for duplicate protection). Excludes given id. */
function findConflict({ targetKeyword, slug }, excludeId = null) {
  const database = getDb();
  if (targetKeyword) {
    const row = database.prepare(
      `SELECT id, title, slug FROM blogs WHERE LOWER(TRIM(targetKeyword)) = LOWER(TRIM(?)) ${excludeId ? 'AND id != ?' : ''} LIMIT 1`
    ).get(targetKeyword, ...(excludeId ? [excludeId] : []));
    if (row) return { type: 'keyword', ...row };
  }
  if (slug) {
    const row = database.prepare(
      `SELECT id, title, slug FROM blogs WHERE LOWER(slug) = LOWER(?) ${excludeId ? 'AND id != ?' : ''} LIMIT 1`
    ).get(slug, ...(excludeId ? [excludeId] : []));
    if (row) return { type: 'slug', ...row };
  }
  return null;
}

/** Stats for admin dashboard. */
function stats() {
  const database = getDb();
  const total = database.prepare('SELECT COUNT(*) AS c FROM blogs').get().c;
  const published = database.prepare("SELECT COUNT(*) AS c FROM blogs WHERE status = 'published'").get().c;
  const drafts = total - published;
  const cats = database.prepare('SELECT category, COUNT(*) AS c FROM blogs GROUP BY category ORDER BY c DESC').all();
  const categories = {};
  for (const r of cats) categories[r.category || 'Uncategorized'] = r.c;
  return { total, published, drafts, categories };
}

/** Related articles (same category, exclude self). */
function related(blog, limit = 6) {
  const database = getDb();
  const rows = database.prepare(
    `SELECT * FROM blogs WHERE status = 'published' AND id != ? AND category = ? ORDER BY date DESC LIMIT ?`
  ).all(blog.id, blog.category || 'Guides', limit);
  return rows.map(rowToBlog);
}

/** Count of published articles (for sitemap). */
function publishedCount() {
  const database = getDb();
  return database.prepare("SELECT COUNT(*) AS c FROM blogs WHERE status = 'published'").get().c;
}

/** All published slugs + dates (for sitemap generation). */
function publishedForSitemap() {
  const database = getDb();
  return database.prepare(
    "SELECT slug, date, updatedAt FROM blogs WHERE status = 'published' ORDER BY date DESC"
  ).all();
}

module.exports = {
  getDb,
  importFromJson,
  exportToJson,
  list,
  getByIdOrSlug,
  getBySlug,
  create,
  update,
  remove,
  bulk,
  findConflict,
  stats,
  related,
  publishedCount,
  publishedForSitemap,
  DB_PATH,
};
