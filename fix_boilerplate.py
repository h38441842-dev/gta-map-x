#!/usr/bin/env python3
"""
Boilerplate de-duplication for blogs.json:
1. Regenerates the shared "confirmed facts" box (~556 articles) per-article
   from variant pools + shuffled order.
2. Regenerates a second "quick facts" list format (Platforms:/Setting:/...).
3. Replaces the most-repeated standalone sentences (FAQ cores, closers,
   PT blocks) with rotating paraphrase variants.
Facts never change — only wording. Deterministic per slug.
"""
import json, re, hashlib, random

PATH = 'data/blogs.json'
blogs = json.load(open(PATH))

def pick(slug, pool, salt=''):
    h = int(hashlib.md5((slug + '|' + salt).encode()).hexdigest(), 16)
    return pool[h % len(pool)]

# ---------------------------------------------------------------- fact box 1
FACT_INTROS = [
    'Here are the confirmed facts that matter most for {kw}:',
    'The confirmed picture for {kw}, in short:',
    'What Rockstar has actually confirmed about {kw}:',
    'Before the rumours, the verified facts on {kw}:',
    'The short, confirmed version of {kw}:',
    'Everything below is confirmed — the essentials for {kw}:',
]
FACTS = {
    'Launch': [
        'GTA 6 launches on November 19, 2026 for PlayStation 5 and Xbox Series X|S — the date Rockstar has officially confirmed.',
        'Rockstar has locked the release for November 19, 2026, on PlayStation 5 and Xbox Series X|S.',
        'The release date is set: November 19, 2026, on PS5 and Xbox Series X|S, as confirmed by Rockstar.',
        'November 19, 2026 is the day — Rockstar confirmed GTA 6 for PlayStation 5 and Xbox Series X|S.',
        'GTA 6 arrives November 19, 2026 on PlayStation 5 and Xbox Series X|S, per Rockstar&#x27;s official announcement.',
        'Confirmed by Rockstar: the launch is November 19, 2026, for PS5 and Xbox Series X|S.',
        'Players can circle November 19, 2026 — that is the Rockstar-confirmed launch date for PS5 and Xbox Series X|S.',
        'The confirmed launch timing is a specific day: November 19, 2026, on PlayStation 5 and Xbox Series X|S.',
    ],
    'Setting': [
        'The game is set in Leonida, Rockstar&#x27;s fictional take on Florida, with Vice City as its centerpiece.',
        'Leonida — a fictional Florida — is the setting, and Vice City sits at its heart.',
        'Vice City returns as the centerpiece of Leonida, Rockstar&#x27;s fictional version of Florida.',
        'The action unfolds across Leonida, a fictional Florida built around Vice City.',
        'Rockstar is taking the series to Leonida, its fictional Florida, headlined by Vice City.',
        'The story plays out in Leonida, a fictional Florida with Vice City at its center.',
        'Vice City is back — this time as the crown of Leonida, Rockstar&#x27;s reimagined Florida.',
        'The map is anchored on Vice City, inside the fictional state of Leonida, Rockstar&#x27;s Florida.',
    ],
    'Story': [
        'Lucia Caminos and Jason Duval lead the story — the first dual-protagonist setup in a GTA since GTA 5.',
        'The story follows two leads, Lucia Caminos and Jason Duval, a first for the series since GTA 5&#x27;s multi-hero format.',
        'Lucia Caminos and Jason Duval share top billing, making GTA 6 the first dual-protagonist entry since GTA 5.',
        'Two protagonists drive the narrative: Lucia Caminos and Jason Duval.',
        'At the center of the story are Lucia Caminos and Jason Duval, GTA&#x27;s first dual leads since GTA 5.',
        'GTA 6 is built around Lucia Caminos and Jason Duval, its pair of lead protagonists.',
        'The narrative rests on Lucia Caminos and Jason Duval — dual protagonists, a first since GTA 5.',
        'Lucia Caminos and Jason Duval headline the cast, in a dual-protagonist story.',
    ],
    'Demand': [
        'The anticipation is backed by numbers: GTA 5 has sold over 200 million copies, according to Take-Two&#x27;s official reports.',
        'Demand context: Take-Two reports GTA 5 sales above 200 million copies — the audience waiting for this game is enormous.',
        'GTA 5 has moved more than 200 million copies (Take-Two&#x27;s official figures), which explains the scale of the hype.',
        'According to Take-Two, GTA 5 passed 200 million copies sold — a measure of the demand behind GTA 6.',
        'The predecessor&#x27;s shadow is long: over 200 million copies of GTA 5 sold, per Take-Two.',
        'Take-Two&#x27;s reports put GTA 5 above 200 million copies, underlining just how large the waiting audience is.',
        'Few games launch with this kind of runway: GTA 5 sits above 200 million copies sold, per Take-Two.',
        'The commercial backdrop: GTA 5 has sold over 200 million copies, according to Take-Two.',
    ],
}
FACT_ORDER = [['Launch', 'Setting', 'Story', 'Demand'],
              ['Setting', 'Launch', 'Story', 'Demand'],
              ['Launch', 'Story', 'Setting', 'Demand'],
              ['Story', 'Setting', 'Launch', 'Demand'],
              ['Launch', 'Setting', 'Demand', 'Story'],
              ['Setting', 'Story', 'Launch', 'Demand']]

FACTBOX_RE = re.compile(r'<p>(?:(?!</p>).)*?facts that matter most for.*?</p>\s*<p>1\. <strong>Launch:</strong>.*?</p>', re.S)
FACTBOX_INLINE_RE = re.compile(r'1\. <strong>Launch:</strong>.*?4\. <strong>Demand:</strong>[^<]*', re.S)

def regen_items(b):
    order = pick(b['slug'], FACT_ORDER, 'order')
    return ['%d. <strong>%s:</strong> %s' % (i, f, pick(b['slug'], FACTS[f], 'fact-' + f))
            for i, f in enumerate(order, 1)]

n = 0
for b in blogs:
    c = b.get('content', '')
    m = FACTBOX_RE.search(c)
    if m:
        kw = b.get('targetKeyword') or 'gta 6'
        intro = pick(b['slug'], FACT_INTROS, 'intro').format(kw=kw)
        new_block = '<p>%s</p>\n<p>%s</p>' % (intro, ' '.join(regen_items(b)))
        b['content'] = c[:m.start()] + new_block + c[m.end():]
        n += 1
        continue
    m2 = FACTBOX_INLINE_RE.search(c)
    if m2:
        b['content'] = c[:m2.start()] + ' '.join(regen_items(b)) + c[m2.end():]
        n += 1
print('Fact boxes v1 regenerated:', n)

# ---------------------------------------------------------------- fact box 2
# Format: <strong>Platforms:</strong> ... <strong>Setting:</strong> ... etc in one <p>
QF = {
    'Platforms': [
        'PlayStation 5 and Xbox Series X|S at launch; the PC version remains unconfirmed.',
        'PS5 and Xbox Series X|S on day one — a PC version has not been confirmed.',
        'PlayStation 5 and Xbox Series X|S first; PC is still unannounced.',
        'Confirmed for PlayStation 5 and Xbox Series X|S at launch, with PC unconfirmed.',
    ],
    'Setting': [
        'Leonida, Rockstar&#x27;s fictional Florida, headlined by Vice City.',
        'The state of Leonida — Rockstar&#x27;s Florida — with Vice City up front.',
        'Vice City and the wider state of Leonida, Rockstar&#x27;s fictional Florida.',
        'Leonida, the fictional Florida that Vice City calls home.',
    ],
    'Protagonists': [
        'Lucia Caminos and Jason Duval — GTA&#x27;s first female lead of the HD era, alongside Jason.',
        'Lucia Caminos (the HD era&#x27;s first female GTA lead) and Jason Duval.',
        'Jason Duval and Lucia Caminos — Lucia being the first female lead of GTA&#x27;s HD era.',
        'The duo of Lucia Caminos and Jason Duval; Lucia is the HD era&#x27;s first female protagonist.',
    ],
    'Trailer record': [
        'The debut trailer passed 100 million views in under 2 days.',
        'Trailer 1 cleared 100 million views within two days of release.',
        'The first trailer raced past 100 million views in less than 48 hours.',
        'Rockstar&#x27;s debut trailer topped 100 million views inside two days.',
    ],
}
print('Quick-facts v2 handled via sentence pools below')

# ------------------------------------------------------- standalone sentences
def sentence_regex(norm_key):
    """Match a counted sentence (entities as in source) inside raw HTML."""
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

POOLS = [
    ("a: lucia caminos and jason duval — gta&#x27;s first dual protagonists.", [
        "A: Lucia Caminos and Jason Duval — the pair at the center of GTA 6&#x27;s story.",
        "A: The leads are Lucia Caminos and Jason Duval, GTA 6&#x27;s two protagonists.",
        "A: Lucia Caminos and Jason Duval, the dual protagonists Rockstar has put front and center.",
        "A: Two names: Lucia Caminos and Jason Duval — GTA 6&#x27;s playable leads.",
        "A: Lucia Caminos and Jason Duval share the lead role in GTA 6.",
        "A: GTA 6 is led by Lucia Caminos and Jason Duval, its dual protagonists.",
    ]),
    ("a: leonida, rockstar&#x27;s fictional florida, with vice city as centerpiece.", [
        "A: Leonida — Rockstar&#x27;s fictional Florida, built around Vice City.",
        "A: The state of Leonida, Rockstar&#x27;s reimagined Florida, with Vice City at its heart.",
        "A: Leonida. It is Rockstar&#x27;s fictional take on Florida, and Vice City is its centerpiece.",
        "A: Rockstar&#x27;s fictional Florida is called Leonida, and its crown is Vice City.",
        "A: Leonida, with Vice City as its centerpiece city.",
        "A: A fictional Florida named Leonida — Vice City included.",
    ]),
    ("a: 🎬 trailers confirm dual protagonists lucia caminos and jason duval for gta 6.", [
        "A: 🎬 The trailers introduce Lucia Caminos and Jason Duval as the two leads.",
        "A: 🎬 Trailer footage confirms Lucia Caminos and Jason Duval as the protagonists.",
        "A: 🎬 Yes — both trailers center on Lucia Caminos and Jason Duval.",
        "A: 🎬 Lucia Caminos and Jason Duval are the confirmed dual leads, per the trailers.",
        "A: 🎬 The trailers confirm the pairing of Lucia Caminos and Jason Duval.",
    ]),
    ("a: 🎬 based on trailers showing an incredibly detailed leonida with vice city&#x27;s neon streets, diverse regions from beaches to swamps, and rockstar&#x27;s renowned storytelling pedigree, gta 6 is positioned as a landmark gaming release.", [
        "A: 🎬 The trailers show a densely detailed Leonida — neon Vice City streets, beaches, swamps — pointing to a landmark release.",
        "A: 🎬 Judging by the trailers&#x27; detailed Leonida, from Vice City&#x27;s neon to the swamps, GTA 6 is shaping up as a landmark release.",
        "A: 🎬 Trailer footage of Leonida&#x27;s beaches, swamps and neon streets suggests a landmark Rockstar release.",
        "A: 🎬 Everything the trailers show — detailed regions, Vice City&#x27;s glow, Rockstar&#x27;s storytelling pedigree — positions GTA 6 as a landmark title.",
    ]),
    ("a: 🎬 gta 6 is rockstar games&#x27; upcoming open-world action game set in leonida, a florida-inspired state featuring vice city.", [
        "A: 🎬 GTA 6 is Rockstar&#x27;s next open-world action game, set in the Florida-inspired state of Leonida, home to Vice City.",
        "A: 🎬 It is Rockstar Games&#x27; upcoming open-world entry, set across Leonida with Vice City as its headline city.",
        "A: 🎬 GTA 6: Rockstar&#x27;s open-world return to a Florida-inspired setting — Leonida, featuring Vice City.",
        "A: 🎬 An open-world action game from Rockstar, set in Leonida, the fictional Florida that includes Vice City.",
    ]),
    ("a: ✅ follow rockstar games&#x27; official newswire, youtube channel, and verified social media accounts for confirmed information about gta 6.", [
        "A: ✅ For confirmed news, watch Rockstar&#x27;s official Newswire, YouTube channel and verified social accounts.",
        "A: ✅ Stick to Rockstar&#x27;s Newswire, official YouTube and verified socials — that is where confirmed GTA 6 info lands.",
        "A: ✅ Confirmed information comes via Rockstar&#x27;s Newswire, YouTube channel and verified social media.",
        "A: ✅ Follow Rockstar&#x27;s official channels (Newswire, YouTube, verified socials) for anything confirmed.",
    ]),
    ("a: ✅ at launch, gta 6 is confirmed for playstation 5 and xbox series x|s only.", [
        "A: ✅ At launch: PlayStation 5 and Xbox Series X|S. Those are the confirmed platforms.",
        "A: ✅ Confirmed launch platforms are PS5 and Xbox Series X|S only.",
        "A: ✅ Yes — day one means PlayStation 5 and Xbox Series X|S, per Rockstar.",
        "A: ✅ Only two platforms are confirmed for launch: PS5 and Xbox Series X|S.",
    ]),
    ("a: ✅ rockstar games has officially confirmed gta 6 launches on november 19, 2026, for playstation 5 and xbox series x|s.", [
        "A: ✅ Rockstar has confirmed it: November 19, 2026, on PlayStation 5 and Xbox Series X|S.",
        "A: ✅ Yes — the official date is November 19, 2026, for PS5 and Xbox Series X|S.",
        "A: ✅ Confirmed by Rockstar Games: GTA 6 arrives November 19, 2026 on PS5 and Xbox Series X|S.",
        "A: ✅ Officially, launch day is November 19, 2026 (PlayStation 5 and Xbox Series X|S).",
    ]),
    ("the countdown is on whatever brought you to this page, here&#x27;s the date that matters: november 19, 2026 .", [
        "The countdown is on. Whatever brought you here, circle this date: November 19, 2026.",
        "The countdown has begun — and the date that matters is November 19, 2026.",
        "Whatever led you to this page, one date matters now: November 19, 2026. The countdown is on.",
        "Mark it down: November 19, 2026. The countdown to GTA 6 is officially on.",
    ]),
    ("why this matters as with previous rockstar launches, expect a staggered rollout of details: trailers first, then gameplay deep-dives, then hands-on previews.", [
        "Why this matters: Rockstar usually rolls details out in stages — trailers, then gameplay deep-dives, then hands-on previews.",
        "Why this matters: if past Rockstar launches are the guide, expect information in waves — trailers first, gameplay later, previews last.",
        "Why this matters: Rockstar drip-feeds its reveals, so trailers come before gameplay breakdowns and press previews.",
        "Why this matters: the pattern from earlier launches is a staged rollout — trailers, deep-dives, then hands-on coverage.",
    ]),
    ("what it means for you as with previous rockstar launches, expect a staggered rollout of details: trailers first, then gameplay deep-dives, then hands-on previews.", [
        "What it means for you: expect a staged flow of news, as with earlier Rockstar launches — trailers, then gameplay deep-dives, then previews.",
        "What it means for you: Rockstar reveals in stages, so more trailers and breakdowns will land before hands-on previews do.",
        "What it means for you: information will arrive in waves — trailers first, gameplay detail later.",
        "What it means for you: patience pays — Rockstar&#x27;s rollouts build from trailers to deep-dives to previews.",
    ]),
    ("the bigger picture as with previous rockstar launches, expect a staggered rollout of details: trailers first, then gameplay deep-dives, then hands-on previews.", [
        "The bigger picture: Rockstar stages its reveals — trailers, then gameplay deep-dives, then hands-on previews.",
        "The bigger picture: as with previous launches, details will keep arriving in stages right up to release.",
        "The bigger picture: this is one step in a staged rollout — trailers now, deeper gameplay coverage later.",
        "The bigger picture: Rockstar&#x27;s cadence is trailers first, substance in stages after.",
    ]),
    ("bookmark gta6mapx for evidence-labeled gta 6 coverage — no rumors presented as fact, ever.", [
        "Bookmark GTA6mapx for GTA 6 coverage where every claim carries an evidence label — rumours never dressed as fact.",
        "Keep GTA6mapx bookmarked: evidence-labeled GTA 6 coverage, with no rumor ever presented as fact.",
        "GTA6mapx labels its evidence on every claim — bookmark us if you want GTA 6 news without rumor-as-fact games.",
        "For GTA 6 coverage that separates confirmed from rumored, bookmark GTA6mapx.",
    ]),
    ("❓ disputed : sources disagree that&#x27;s the whole system.", [
        "❓ Disputed: sources disagree — and showing that disagreement is the whole point of the system.",
        "❓ Disputed means the sources conflict; the label exists so you can see that at a glance.",
        "❓ Disputed: when sources disagree, we say so — that transparency is the system working.",
        "❓ A Disputed label means reports conflict. Surfacing that is exactly what the labels are for.",
    ]),
    ("porque afeta o que você vai pagar, quando poderá jogar ou como o jogo funcionará no lançamento — os detalhes deste guia ajudam você a se planejar.", [
        "Porque isso afeta quanto você vai pagar, quando vai jogar e como o jogo estará no lançamento — este guia reúne os detalhes para você se planejar.",
        "Isso importa porque mexe com preço, data e experiência no lançamento — os detalhes aqui ajudam no seu planejamento.",
        "Preço, data de lançamento e funcionamento do jogo passam por este tema — por isso detalhamos tudo neste guia.",
        "Seja pelo valor que você pagará ou pelo dia em que poderá jogar, os detalhes deste guia ajudam você a se organizar.",
    ]),
    ("fontes e leitura complementar quer verificar tudo por conta própria?", [
        "Fontes e leitura complementar: quer conferir tudo por conta própria?",
        "Fontes e materiais complementares — prefere verificar tudo sozinho?",
        "Quer checar as fontes por conta própria? Veja a leitura complementar.",
        "Leitura complementar e fontes: verifique cada ponto por conta própria, se quiser.",
    ]),
    ("*uma nota final: esta página é atualizada sempre que surgem informações confirmadas.", [
        "*Uma nota final: atualizamos esta página sempre que novas informações confirmadas surgem.",
        "*Nota final: esta página recebe atualização a cada informação confirmada que aparece.",
        "*Uma última nota: sempre que algo é confirmado, esta página é atualizada.",
        "*Nota de fechamento: mantemos esta página atualizada com cada novidade confirmada.",
    ]),
    ("19 de novembro de 2026 — confirmado pela rockstar para playstation 5 e xbox series x|s.", [
        "19 de novembro de 2026 — data confirmada pela Rockstar para PS5 e Xbox Series X|S.",
        "A Rockstar confirmou: 19 de novembro de 2026, no PlayStation 5 e no Xbox Series X|S.",
        "Lançamento em 19 de novembro de 2026 (PlayStation 5 e Xbox Series X|S), segundo a Rockstar.",
        "É oficial: 19 de novembro de 2026, para PlayStation 5 e Xbox Series X|S.",
    ]),
    ("a rockstar não detalhou planos online, mas um sucessor de gta online é amplamente esperado.", [
        "A Rockstar ainda não detalhou o modo online, embora um sucessor do GTA Online seja amplamente esperado.",
        "Planos online não foram detalhados pela Rockstar — mas a expectativa por um novo GTA Online é geral.",
        "Sobre o online, a Rockstar não deu detalhes; mesmo assim, um sucessor do GTA Online é dado como provável.",
        "A Rockstar não revelou planos para o online, mas espera-se amplamente um sucessor do GTA Online.",
    ]),
    ("nosso mapa interativo registra cada local com rótulos de evidência.", [
        "Nosso mapa interativo marca cada local com seu rótulo de evidência.",
        "Cada local do nosso mapa interativo carrega um rótulo de evidência.",
        "No mapa interativo, registramos cada local já com o nível de evidência.",
        "Nosso mapa registra todos os locais e exibe o rótulo de evidência de cada um.",
    ]),
    ("gta 5 vs gta 6: what changes comparing gta v (2013) to gta 6 (2026) reveals thirteen years of evolution in open-world design.", [
        "GTA 5 vs GTA 6: what changes. Thirteen years separate GTA V (2013) from GTA 6 (2026) — and the evolution in open-world design shows it.",
        "GTA 5 vs GTA 6: what changes when thirteen years of open-world evolution separate the two games.",
        "Comparing GTA V (2013) with GTA 6 (2026) shows what thirteen years did to open-world design.",
        "GTA 5 vs GTA 6: what changes across thirteen years of Rockstar&#x27;s open-world craft.",
    ]),
    ("what stays the same: the satirical heart, the radio stations, the stranger missions, the &quot;just one more thing to try&quot; sandbox magic.", [
        "What stays the same: the satire, the radio stations, the stranger missions and that &quot;one more thing to try&quot; sandbox pull.",
        "What stays the same: Rockstar&#x27;s satirical heart, its radio, its stranger missions, its sandbox magic.",
        "What stays the same: the humour, the stations, the side encounters — the sandbox sparkle.",
        "What stays the same: satire at the core, radio in the car, strangers with missions, and endless sandbox detours.",
    ]),
    ("the verdict: gta 6 isn&#x27;t gta v with better graphics — it&#x27;s a generational leap built on everything rockstar learned.", [
        "The verdict: GTA 6 is no reskin of GTA V — it is a generational step built on everything Rockstar learned since.",
        "The verdict: not GTA V with prettier graphics, but a generational leap from a studio that kept learning.",
        "The verdict: GTA 6 builds on thirteen years of lessons — calling it a graphics upgrade misses the point.",
        "The verdict: a generational leap, not a remaster — everything Rockstar learned, applied at once.",
    ]),
    ("the content mountain: a decade of updates means gta v + gta online in 2026 is the most content-rich package in series history.", [
        "The content mountain: a decade of updates makes GTA V + GTA Online in 2026 the series&#x27; richest package ever.",
        "The content mountain: ten years of updates stack GTA V and GTA Online into the biggest bundle in series history.",
        "The content mountain: by 2026, GTA V plus GTA Online carries a decade of additions — unmatched in the series.",
        "The content mountain: no GTA package has ever held this much — a decade of GTA V and Online updates.",
    ]),
    ("the gta 6 connection: playing gta v now is genuinely useful preparation.", [
        "The GTA 6 connection: time in GTA V now is real preparation for Leonida.",
        "The GTA 6 connection: GTA V today genuinely sharpens you for GTA 6.",
        "The GTA 6 connection: playing GTA V is not nostalgia — it is practice.",
        "The GTA 6 connection: GTA V remains the best warm-up for what is coming.",
    ]),
    ("what to prioritize: play the story mode (30–50 hours of excellence).", [
        "What to prioritize: the story mode — 30 to 50 hours of it, and it holds up.",
        "What to prioritize: story mode first; its 30–50 hours are the core experience.",
        "What to prioritize: GTA V&#x27;s campaign, a 30–50 hour run worth every evening.",
        "What to prioritize: the single-player story — 30–50 hours, still excellent.",
    ]),
    ("playstation 5 and xbox series x|s at launch; the pc version remains unconfirmed.", [
        "PS5 and Xbox Series X|S on day one — a PC version has not been confirmed.",
        "PlayStation 5 and Xbox Series X|S first; PC is still unannounced.",
        "Confirmed for PlayStation 5 and Xbox Series X|S at launch, with PC unconfirmed.",
        "PlayStation 5 and Xbox Series X|S at launch. A PC version remains unconfirmed for now.",
    ]),
    ("leonida, rockstar&#x27;s fictional florida, headlined by vice city.", [
        "The state of Leonida — Rockstar&#x27;s Florida — with Vice City up front.",
        "Vice City and the wider state of Leonida, Rockstar&#x27;s fictional Florida.",
        "Leonida, the fictional Florida that Vice City calls home.",
        "Rockstar&#x27;s fictional Florida, Leonida, topped by Vice City.",
    ]),
    ("lucia caminos and jason duval — gta&#x27;s first female lead of the hd era.", [
        "Lucia Caminos (the HD era&#x27;s first female GTA lead) and Jason Duval.",
        "Jason Duval and Lucia Caminos — Lucia being the first female lead of GTA&#x27;s HD era.",
        "The duo of Lucia Caminos and Jason Duval; Lucia is the HD era&#x27;s first female protagonist.",
        "Lucia Caminos and Jason Duval. Lucia makes history as the HD era&#x27;s first female lead.",
    ]),
    ("the debut trailer passed 100 million views in under 2 days.", [
        "Trailer 1 cleared 100 million views within two days of release.",
        "The first trailer raced past 100 million views in less than 48 hours.",
        "Rockstar&#x27;s debut trailer topped 100 million views inside two days.",
        "The debut trailer hit nine figures — 100 million views — in under two days.",
    ]),
    ("as with previous rockstar launches, expect a staggered rollout of details: trailers first, then gameplay deep-dives, then hands-on previews.", [
        "Rockstar tends to stage its reveals: trailers first, gameplay deep-dives after, hands-on previews last.",
        "If previous Rockstar launches are the guide, details will arrive in stages — trailers, deep-dives, then previews.",
        "Expect the usual Rockstar cadence: trailers up front, gameplay breakdowns later, previews near the end.",
        "As ever with Rockstar, information comes in waves — trailers, then deep-dives, then hands-on coverage.",
    ]),
    ("whatever brought you to this page, here&#x27;s the date that matters:", [
        "However you landed here, one date matters most:",
        "Whatever you came looking for, start with the date:",
        "One date matters above everything else on this page:",
        "Whatever brought you here, circle this date:",
    ]),
    ("❓ disputed = conflicting reports.", [
        "❓ Disputed = reports that conflict with each other.",
        "❓ Disputed marks claims where sources conflict.",
        "❓ Disputed = conflicting reports, shown as-is.",
        "❓ Disputed means the reports disagree.",
    ]),
    ("quer verificar tudo por conta própria?", [
        "Prefere conferir tudo por conta própria?",
        "Quer checar cada ponto por conta própria?",
        "Vai verificar tudo por conta própria?",
        "Quer conferir as fontes diretamente?",
    ]),
    ("comparing gta v (2013) to gta 6 (2026) reveals thirteen years of evolution in open-world design.", [
        "Thirteen years separate GTA V (2013) from GTA 6 (2026) — and the evolution in open-world design shows it.",
        "Put GTA V (2013) next to GTA 6 (2026) and thirteen years of open-world evolution come into focus.",
        "Comparing the two games reveals what thirteen years did to open-world design.",
        "GTA V (2013) versus GTA 6 (2026): thirteen years of open-world evolution, side by side.",
    ]),
    ("the satirical heart, the radio stations, the stranger missions, the &quot;just one more thing to try&quot; sandbox magic.", [
        "The satire, the radio stations, the stranger missions and that &quot;one more thing to try&quot; sandbox pull.",
        "Rockstar&#x27;s satirical heart, its radio, its stranger missions, its sandbox magic.",
        "The humour, the stations, the side encounters — the sandbox sparkle.",
        "Satire at the core, radio in the car, strangers with missions, and endless sandbox detours.",
    ]),
    ("gta 6 isn&#x27;t gta v with better graphics — it&#x27;s a generational leap built on everything rockstar learned.", [
        "GTA 6 is no reskin of GTA V — it is a generational step built on everything Rockstar learned since.",
        "Not GTA V with prettier graphics, but a generational leap from a studio that kept learning.",
        "GTA 6 builds on thirteen years of lessons — calling it a graphics upgrade misses the point.",
        "A generational leap, not a remaster — everything Rockstar learned, applied at once.",
    ]),
    ("a decade of updates means gta v + gta online in 2026 is the most content-rich package in series history.", [
        "A decade of updates makes GTA V + GTA Online in 2026 the series&#x27; richest package ever.",
        "Ten years of updates stack GTA V and GTA Online into the biggest bundle in series history.",
        "By 2026, GTA V plus GTA Online carries a decade of additions — unmatched in the series.",
        "No GTA package has ever held this much — a decade of GTA V and Online updates.",
    ]),
    ("playing gta v now is genuinely useful preparation.", [
        "Time in GTA V now is real preparation for Leonida.",
        "GTA V today genuinely sharpens you for GTA 6.",
        "Playing GTA V is not nostalgia — it is practice.",
        "GTA V remains the best warm-up for what is coming.",
    ]),
    ("play the story mode (30–50 hours of excellence).", [
        "Play the story mode — 30 to 50 hours of it, and it holds up.",
        "Story mode first; its 30–50 hours are the core experience.",
        "GTA V&#x27;s campaign, a 30–50 hour run worth every evening.",
        "The single-player story — 30–50 hours, still excellent.",
    ]),
    ("registra cada local com rótulos de evidência.", [
        "registra cada local já com o rótulo de evidência.",
        "marca cada local com seu nível de evidência.",
        "registra todos os locais exibindo o rótulo de evidência de cada um.",
        "guarda cada local com o respectivo rótulo de evidência.",
    ]),
    ("you might wonder why we&#x27;re covering this topic when gta 6 is months away.", [
        "With GTA 6 still months away, covering this topic might seem odd — here is why it matters.",
        "Why this topic, months before GTA 6? Fair question — here is the reasoning.",
        "GTA 6 is months out, so why cover this now? Because it connects directly.",
        "You might ask why this matters with GTA 6 months away. It does — read on.",
    ]),
    ("why this still matters in the gta 6 era you might wonder why we&#x27;re covering this topic when gta 6 is months away.", [
        "Why this still matters in the GTA 6 era: with GTA 6 months away, the question is fair — here is the answer.",
        "Why cover this with GTA 6 months out? Because it still matters in the GTA 6 era, for a simple reason.",
        "You might ask why this topic, months before GTA 6. It matters — here is why.",
        "Why this still matters: GTA 6 is months away, and this topic feeds directly into it.",
    ]),
]

total_applied = {}
for key, pool in POOLS:
    rx = sentence_regex(key)
    n = 0
    for b in blogs:
        c = b.get('content', '')
        if rx.search(c):
            variant = pick(b['slug'], pool, 'pool:' + key[:30])
            c2, k = rx.subn(lambda _: variant, c, count=1)
            if k:
                b['content'] = c2
                n += 1
    total_applied[key[:50]] = n
for k, v in total_applied.items():
    print('Pool applied x%d -> %s' % (v, k))

json.dump(blogs, open(PATH, 'w'), indent=2, ensure_ascii=False)
print('Saved', PATH)
