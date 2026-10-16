#!/usr/bin/env python3
"""Import 3,646 GTA6mapx premium articles into gta-map-x blog format.

Each article gets its own URL via its unique slug: #blog/<slug>
Long-term method: idempotent, validates output, preserves existing 14 Vice Wire articles.
"""
import json, re, html, sys
from datetime import datetime

SRC = '/home/hatch/workspace/gta6mapx-marketing/article-factory/articles_final.json'
DST = '/home/hatch/workspace/gta-map-x-fix/data/blogs.json'

CATEGORY_MAP = {
    'guide': 'Guides',
    'traffic': 'GTA 6 Updates',
    'qa': 'Q&A',
}

def md_to_html(md):
    """Convert article markdown to safe HTML."""
    if not md:
        return '<p>Article content pending...</p>'
    # Remove schema comment
    md = re.sub(r'<!--.*?-->', '', md, flags=re.DOTALL)
    lines = md.split('\n')
    out = []
    para = []
    def flush_para():
        if para:
            text = ' '.join(para).strip()
            if text:
                out.append(f'<p>{inline(text)}</p>')
            para.clear()
    def inline(t):
        # Escape HTML first, then apply markdown
        t = html.escape(t)
        # Images: ![alt](src)
        t = re.sub(r'!\[([^\]]*)\]\(([^)]+)\)',
                   r'<img src="\2" alt="\1" loading="lazy" decoding="async">', t)
        # Links: [text](url) — map /guides/<slug> to #blog/<slug>
        def link_repl(m):
            text, url = m.group(1), m.group(2)
            if url.startswith('/guides/'):
                url = '#blog/' + url[len('/guides/'):]
            return f'<a href="{url}">{text}</a>'
        t = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', link_repl, t)
        # Bold
        t = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', t)
        # Italic (avoid breaking already-processed bold)
        t = re.sub(r'(?<!\*)\*([^*\n]+)\*(?!\*)', r'<em>\1</em>', t)
        return t
    for line in lines:
        s = line.strip()
        if not s:
            flush_para()
            continue
        # Headings
        m = re.match(r'^(#{1,4})\s+(.*)', s)
        if m:
            flush_para()
            level = len(m.group(1))
            out.append(f'<h{level}>{inline(m.group(2))}</h{level}>')
            continue
        # Horizontal rule
        if re.match(r'^---+$', s):
            flush_para()
            out.append('<hr>')
            continue
        # List items
        m = re.match(r'^[-*]\s+(.*)', s)
        if m:
            flush_para()
            # Simple: collect consecutive list items
            out.append(f'<ul><li>{inline(m.group(1))}</li></ul>')
            continue
        # Standalone image line
        if re.match(r'^!\[', s):
            flush_para()
            out.append(f'<p>{inline(s)}</p>')
            continue
        para.append(s)
    flush_para()
    # Merge adjacent <ul> blocks
    html_out = '\n'.join(out)
    html_out = re.sub(r'</ul>\n<ul>', '', html_out)
    return html_out or '<p>Article content pending...</p>'

def main():
    with open(SRC) as f:
        articles = json.load(f)
    print(f'Loaded {len(articles)} articles')

    # Load existing blogs (preserve the 14 Vice Wire articles)
    with open(DST) as f:
        existing = json.load(f)
    print(f'Existing blogs: {len(existing)}')

    existing_slugs = {b['slug'].lower() for b in existing}
    existing_ids = {b['id'] for b in existing}

    # Category distribution for default cover images
    default_covers = {
        'Guides': 'assets/photos/screenshots/vice_city/Vice_City_05.jpg',
        'GTA 6 Updates': 'assets/photos/trailer/trailer3/T3_201.png',
        'Q&A': 'assets/photos/screenshots/jason_duval/Jason_Duval_02.jpg',
    }

    new_blogs = []
    skipped = 0
    for i, a in enumerate(articles):
        slug = a['slug'].strip()
        if slug.lower() in existing_slugs:
            skipped += 1
            continue
        # Unique ID
        bid = f'gta6x-{slug[:60]}'
        if bid in existing_ids:
            bid = f'gta6x-{i}-{slug[:50]}'

        wc = a.get('word_count') or 800
        read_min = max(1, round(wc / 200))

        try:
            dt = datetime.fromisoformat(a['created_at'].replace('Z', '+00:00'))
            date_str = dt.strftime('%Y-%m-%d')
        except:
            date_str = '2026-10-16'

        category = CATEGORY_MAP.get(a.get('content_type'), 'Guides')
        excerpt = (a.get('meta_description') or a.get('title') or '')[:300]

        blog = {
            'id': bid,
            'slug': slug,
            'targetKeyword': a.get('keyword', ''),
            'title': a.get('title', ''),
            'category': category,
            'author': 'GTA6mapx Editorial',
            'authorRole': 'Staff Writer',
            'date': date_str,
            'readTime': f'{read_min} min read',
            'coverImage': default_covers.get(category, default_covers['Guides']),
            'excerpt': excerpt,
            'content': md_to_html(a.get('content', '')),
            'hotspotKey': '',
            'lat': None,
            'lng': None,
            'featured': False,
            'status': 'published',
        }
        new_blogs.append(blog)
        existing_slugs.add(slug.lower())
        existing_ids.add(bid)

    # New articles first (newest content on top), then existing Vice Wire articles
    all_blogs = new_blogs + existing

    # Validate: all slugs unique, all have required fields
    slugs = [b['slug'] for b in all_blogs]
    assert len(slugs) == len(set(s.lower() for s in slugs)), 'DUPLICATE SLUGS!'
    for b in all_blogs:
        assert b['slug'] and b['title'] and b['content'], f'Missing field in {b["id"]}'
        assert b['status'] == 'published', f'Non-published: {b["id"]}'

    with open(DST, 'w') as f:
        json.dump(all_blogs, f, indent=2, ensure_ascii=False)

    print(f'Imported: {len(new_blogs)} new articles')
    print(f'Skipped (dup slug): {skipped}')
    print(f'Total blogs: {len(all_blogs)}')
    print(f'All {len(all_blogs)} slugs unique: YES')
    print(f'Every post has own URL: YES (#blog/<slug>)')

if __name__ == '__main__':
    main()
