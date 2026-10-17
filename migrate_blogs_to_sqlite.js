#!/usr/bin/env node
/**
 * One-time migration: data/blogs.json (30MB) -> data/blogs.db (SQLite).
 * Idempotent: safe to re-run (INSERT OR REPLACE).
 * Keeps blogs.json as backup — server exports to it on admin writes.
 */
const blogdb = require('./lib/blogdb');
const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'data', 'blogs.json');
const dbPath = path.join(__dirname, 'data', 'blogs.db');

if (!fs.existsSync(jsonPath)) {
  console.error('blogs.json not found — nothing to migrate');
  process.exit(1);
}

// Backup existing DB if present
if (fs.existsSync(dbPath)) {
  const bak = dbPath + '.pre-migration-' + Date.now() + '.bak';
  fs.copyFileSync(dbPath, bak);
  console.log('Backed up existing DB to', path.basename(bak));
}

console.log('Migrating blogs.json -> blogs.db...');
const t0 = Date.now();
const count = blogdb.importFromJson(jsonPath);
const ms = Date.now() - t0;

const stats = blogdb.stats();
console.log(`Migrated ${count} articles in ${ms}ms`);
console.log(`DB stats: total=${stats.total} published=${stats.published} drafts=${stats.drafts}`);
console.log(`DB file: ${(fs.statSync(dbPath).size / 1024 / 1024).toFixed(1)} MB`);

// Verify slug uniqueness
const db = blogdb.getDb();
const dupes = db.prepare(
  'SELECT LOWER(slug) AS s, COUNT(*) AS c FROM blogs GROUP BY s HAVING c > 1'
).all();
if (dupes.length) {
  console.error('DUPLICATE SLUGS FOUND:', dupes.slice(0, 5));
  process.exit(1);
}
console.log('All slugs unique: YES');
console.log('Migration complete. blogs.json kept as backup/export artifact.');
