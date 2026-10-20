#!/usr/bin/env python3
"""Pass 2: labeled fact sentences in alternate box formats + remaining tails."""
import json, re, hashlib

PATH = 'data/blogs.json'
blogs = json.load(open(PATH))

def pick(slug, pool, salt=''):
    h = int(hashlib.md5((slug + '|' + salt).encode()).hexdigest(), 16)
    return pool[h % len(pool)]

def sentence_regex(norm_key):
    s = norm_key.strip()
    s = s.replace('&#x27;', '\x01').replace('&quot;', '\x02').replace('&amp;', '\x03')
    out = []
    for ch in s:
        if ch == '\x01':
            out.append("(?:'|&#x27;|&rsquo;)")
        elif ch == '\x02':
            out.append('(?:&quot;|")')
        elif ch == '\x03':
            out.append('(?:&amp;|&)')
        elif ch == ' ':
            out.append(r'\s+')
        elif ch == '.':
            out.append(r'\s*\.\s*')
        else:
            out.append(re.escape(ch))
    return re.compile(''.join(out), re.I)

LAUNCH_VARIANTS = [
    'Launch: November 19, 2026 — Rockstar confirmed for PlayStation 5 and Xbox Series X|S.',
    'Launch: November 19, 2026, on PlayStation 5 and Xbox Series X|S (Rockstar-confirmed).',
    'Launch: Rockstar has set November 19, 2026 for PS5 and Xbox Series X|S.',
    'Launch: November 19, 2026 — PS5 and Xbox Series X|S, per Rockstar.',
    'Launch: The confirmed date is November 19, 2026 (PlayStation 5, Xbox Series X|S).',
    'Launch: GTA 6 lands November 19, 2026 on PS5 and Xbox Series X|S.',
]
POOLS = [
    ("launch: november 19, 2026 — rockstar confirmed playstation 5 and xbox series x|s.", LAUNCH_VARIANTS),
    ("launch: november 19, 2026 — rockstar validated playstation 5 and xbox series x|s.", LAUNCH_VARIANTS),
    ("launch: november 19, 2026 — rockstar verified playstation 5 and xbox series x|s.", LAUNCH_VARIANTS),
    ("launch: november 19, 2026 — rockstar announced playstation 5 and xbox series x|s.", LAUNCH_VARIANTS),
    ("setting: leonida, a fictional florida, with vice city as its centerpiece.", [
        'Setting: Leonida — a fictional Florida with Vice City at its center.',
        'Setting: The state of Leonida, Rockstar&#x27;s Florida, headlined by Vice City.',
        'Setting: Vice City returns, inside Leonida, a fictional Florida.',
        'Setting: Leonida, Rockstar&#x27;s take on Florida, anchored by Vice City.',
        'Setting: A fictional Florida called Leonida, with Vice City as the jewel.',
    ]),
    ("story: lucia caminos and jason duval lead the first dual-protagonist gta since gta 5.", [
        'Story: Lucia Caminos and Jason Duval share the lead — a dual-protagonist first since GTA 5.',
        'Story: Two leads, Lucia Caminos and Jason Duval, carry the narrative.',
        'Story: The first dual-protagonist GTA since GTA 5, led by Lucia Caminos and Jason Duval.',
        'Story: Lucia Caminos and Jason Duval headline the story.',
        'Story: A dual-protagonist tale built on Lucia Caminos and Jason Duval.',
    ]),
    ("demand: gta 5 sold over 200 million copies, according to take-two&#x27;s official reports.", [
        'Demand: GTA 5 has sold over 200 million copies (Take-Two&#x27;s official reports).',
        'Demand: Take-Two reports GTA 5 above 200 million copies sold.',
        'Demand: The audience is proven — 200 million-plus copies of GTA 5 sold, per Take-Two.',
        'Demand: GTA 5 sits above 200 million copies, according to Take-Two.',
        'Demand: Over 200 million copies of GTA 5 sold (Take-Two figures).',
    ]),
    ("for evidence-labeled gta 6 coverage — no rumors presented as fact, ever.", [
        'for GTA 6 coverage where every claim carries an evidence label — rumors never dressed as fact.',
        'for evidence-labeled GTA 6 coverage — rumours always marked, never sold as fact.',
        'for GTA 6 news with evidence labels on every claim — no rumor presented as fact.',
        'if you want GTA 6 coverage that labels its evidence and never passes rumor off as fact.',
    ]),
    ("the wait until november 19, 2026 is real.", [
        'The wait until November 19, 2026 is very real.',
        'Yes, the wait for November 19, 2026 is real — and long.',
        'November 19, 2026 will take its time arriving. The wait is real.',
        'The countdown to November 19, 2026 is genuinely on.',
    ]),
    ("enough theory — here&#x27;s what to actually do with this information.", [
        'Enough theory — here is how to actually use this information.',
        'Theory aside, here&#x27;s what to do with all of this.',
        'That&#x27;s the theory. Here&#x27;s the practical part.',
        'Enough background — here&#x27;s what this means in practice.',
    ]),
    ("alles selbst prüfen?", [
        'Möchtest du alles selbst prüfen?',
        'Alles selbst nachprüfen? So geht es:',
        'Lieber selbst prüfen? Hier sind die Quellen:',
        'Du willst alles selbst verifizieren?',
    ]),
    ("a rockstar não detalhou planos de multiplayer pós-lançamento.", [
        'A Rockstar ainda não detalhou os planos de multiplayer pós-lançamento.',
        'Planos de multiplayer após o lançamento não foram detalhados pela Rockstar.',
        'Sobre o multiplayer pós-lançamento, a Rockstar não deu detalhes.',
        'A Rockstar não revelou detalhes do multiplayer pós-lançamento.',
    ]),
]

for key, pool in POOLS:
    rx = sentence_regex(key)
    n = 0
    for b in blogs:
        c = b.get('content', '')
        if rx.search(c):
            variant = pick(b['slug'], pool, 'p2:' + key[:26])
            c2, k = rx.subn(lambda _: variant, c, count=1)
            if k:
                b['content'] = c2
                n += 1
    print('Pass2 pool x%d -> %s' % (n, key[:52]))

json.dump(blogs, open(PATH, 'w'), indent=2, ensure_ascii=False)
print('Saved', PATH)
