/**
 * Vice Wire /blog index controller (Redesign Phase 3, specs 03/04).
 *
 * Server-paginated browsing of the full catalogue: 24 cards per request via
 * /api/blogs (ALWAYS with limit=24 — never the full list), display-group
 * category chips, debounced search, sort, and Load More appends.
 *
 * Display taxonomy mirrors BLOG_GROUPS in server.js — keep the two in sync.
 * Stored category strings are never edited; groups only map onto them.
 */
(function () {
    'use strict';

    var PER_PAGE = 24;
    var FALLBACK_COVER = 'assets/photos/screenshots/vice_city/Vice_City_05.jpg';

    var GROUPS = [
        { slug: 'guides', name: 'GTA 6 Guides', badge: 'Guide', icon: 'fa-compass', stored: ['Guides'] },
        { slug: 'gta-6-updates', name: 'News & Updates', badge: 'Update', icon: 'fa-bolt', stored: ['GTA 6 Updates'] },
        { slug: 'qa', name: 'Questions & Answers', badge: 'Q&A', icon: 'fa-circle-question', stored: ['Q&A'] },
        { slug: 'deep-dives', name: 'Vice Wire Deep Dives', badge: 'Deep Dive', icon: 'fa-satellite-dish', stored: ['Cartography & Leaks', 'Districts & Lore', 'Vehicles & Heists', 'Trailer Analysis', 'Dev Telemetry'] }
    ];
    var GROUP_BY_SLUG = {};
    var GROUP_BY_STORED = {};
    GROUPS.forEach(function (g) {
        GROUP_BY_SLUG[g.slug] = g;
        g.stored.forEach(function (s) { GROUP_BY_STORED[s.toLowerCase()] = g; });
    });
    // Accepts a display slug or a raw stored value (article pages link here
    // with raw stored values in ?category=).
    function resolveGroup(raw) {
        if (!raw) return null;
        var key = String(raw).trim().toLowerCase();
        return GROUP_BY_SLUG[key] || GROUP_BY_STORED[key] || null;
    }
    function groupOfStored(category) {
        return GROUP_BY_STORED[String(category || '').toLowerCase()] || null;
    }

    var CATEGORY_ICONS = {
        'Guides': 'fa-compass',
        'GTA 6 Updates': 'fa-bolt',
        'Trailer Analysis': 'fa-film',
        'Cartography & Leaks': 'fa-map-location-dot',
        'Districts & Lore': 'fa-city',
        'Vehicles & Heists': 'fa-car',
        'Dev Telemetry': 'fa-microchip',
        'Q&A': 'fa-circle-question'
    };

    var state = { group: 'all', q: '', sort: 'newest', page: 1, total: 0, totalPages: 1, loading: false, shown: 0 };
    var els = {};

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) {
            return dateStr;
        }
    }

    function fmtCount(n) {
        return Number(n || 0).toLocaleString('en-US');
    }

    // ---------------------------------------------------------------- cards
    function badgeHtml(item) {
        var g = groupOfStored(item.category);
        var label = g ? g.badge : (item.category || 'Intelligence');
        var icon = g ? g.icon : (CATEGORY_ICONS[item.category] || 'fa-bolt');
        var cls = g ? ' bp-badge--' + g.slug : '';
        return '<span class="blog-card-badge bp-badge' + cls + '" aria-hidden="true"><i class="fas ' + icon + '"></i>' + escapeHtml(label) + '</span>';
    }

    function cardHtml(item) {
        var excerpt = item.excerpt ? '<p class="blog-card-excerpt">' + escapeHtml(item.excerpt) + '</p>' : '';
        return '<article class="blog-card" data-slug="' + escapeHtml(item.slug) + '">'
            + '<a href="/guides/' + escapeHtml(item.slug) + '" class="blog-card-link" style="display:block; color:inherit; text-decoration:none;">'
            + '<div class="blog-card-media">'
            + '<img src="' + escapeHtml(item.coverImage || FALLBACK_COVER) + '" alt="' + escapeHtml(item.title) + '" class="blog-card-img" loading="lazy" decoding="async" width="640" height="360">'
            + badgeHtml(item)
            + '</div>'
            + '<div class="blog-card-content">'
            + '<div class="blog-meta-unboxed">'
            + '<span class="meta-category">' + escapeHtml(item.category || 'Guides') + '</span>'
            + '<span class="meta-sep" aria-hidden="true">·</span><span>' + escapeHtml(item.readTime || '5 min read') + '</span>'
            + '<span class="meta-sep" aria-hidden="true">·</span><span>' + formatDate(item.date) + '</span>'
            + '</div>'
            + '<h3 class="blog-card-title">' + escapeHtml(item.title) + '</h3>'
            + excerpt
            + '<div class="blog-card-footer">'
            + '<span>' + escapeHtml(item.author || 'GTA6mapx Editorial') + ' · ' + formatDate(item.date) + '</span>'
            + '<span class="blog-read-link"><span>Read Report</span> <i class="fas fa-arrow-right"></i></span>'
            + '</div>'
            + '</div></a></article>';
    }

    function skeletonHtml(count) {
        var out = '';
        for (var i = 0; i < count; i++) {
            out += '<div class="bp-skeleton" aria-hidden="true"><div class="bp-sk-media"></div><div class="bp-sk-line"></div><div class="bp-sk-line bp-sk-line--short"></div><div class="bp-sk-line"></div></div>';
        }
        return out;
    }

    function emptyHtml() {
        return '<div class="bp-state">'
            + '<i class="fas fa-search bp-state-icon" aria-hidden="true"></i>'
            + '<h2 class="bp-state-title">No intelligence dispatches found</h2>'
            + '<p class="bp-state-copy">Try adjusting your keyword search or category filter.</p>'
            + '<button type="button" class="bp-btn bp-btn--primary" data-action="reset">Reset search &amp; filters</button>'
            + '</div>';
    }

    function errorHtml() {
        return '<div class="bp-state">'
            + '<i class="fas fa-tower-broadcast bp-state-icon" aria-hidden="true"></i>'
            + '<h2 class="bp-state-title">The wire went quiet</h2>'
            + '<p class="bp-state-copy">Couldn&rsquo;t load dispatches. Check your connection and try again.</p>'
            + '<button type="button" class="bp-btn bp-btn--primary" data-action="retry">Retry</button>'
            + '</div>';
    }

    // ---------------------------------------------------------------- chips
    function buildChips(countsByStored, totalAll) {
        var html = '';
        var allCount = (totalAll != null) ? ' <span class="chip-count">' + fmtCount(totalAll) + '</span>' : '';
        html += '<a href="/blog" class="blog-filter-btn' + (state.group === 'all' ? ' active' : '') + '" data-group="all" aria-pressed="' + (state.group === 'all') + '">All Stories' + allCount + '</a>';
        GROUPS.forEach(function (g) {
            var countHtml = '';
            if (countsByStored) {
                var sum = 0;
                g.stored.forEach(function (s) { sum += countsByStored[s] || 0; });
                countHtml = ' <span class="chip-count">' + fmtCount(sum) + '</span>';
            }
            html += '<a href="/blog/category/' + g.slug + '" class="blog-filter-btn' + (state.group === g.slug ? ' active' : '') + '" data-group="' + g.slug + '" aria-pressed="' + (state.group === g.slug) + '">' + escapeHtml(g.name) + countHtml + '</a>';
        });
        els.chipRail.innerHTML = html;
    }

    function markActiveChip() {
        var chips = els.chipRail.querySelectorAll('.blog-filter-btn');
        chips.forEach(function (chip) {
            var active = chip.getAttribute('data-group') === state.group;
            chip.classList.toggle('active', active);
            chip.setAttribute('aria-pressed', String(active));
        });
    }

    function fetchCategories() {
        fetch('/api/blogs/categories')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !Array.isArray(data.categories)) throw new Error('bad categories');
                var counts = {};
                var total = 0;
                data.categories.forEach(function (c) { counts[c.name] = c.count; total += c.count; });
                buildChips(counts, total);
                var totalEl = document.getElementById('blogTotalCount');
                if (totalEl && total > 0) totalEl.textContent = fmtCount(total);
            })
            .catch(function () {
                // Static fallback: group chips without counts (page still works).
                buildChips(null, null);
            });
    }

    // -------------------------------------------------------------- popular
    function fetchPopular() {
        fetch('/api/blogs?popular=1&limit=5')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.success || !Array.isArray(data.blogs) || data.blogs.length === 0) throw new Error('no popular');
                els.popularRail.innerHTML = data.blogs.map(function (item, idx) {
                    return '<a class="bp-pop-card" href="/guides/' + escapeHtml(item.slug) + '">'
                        + '<span class="bp-pop-rank" aria-hidden="true">0' + (idx + 1) + '</span>'
                        + '<span class="bp-pop-media"><img src="' + escapeHtml(item.coverImage || FALLBACK_COVER) + '" alt="' + escapeHtml(item.title) + '" loading="lazy" decoding="async" width="640" height="360"></span>'
                        + '<span class="bp-pop-body">'
                        + '<span class="bp-pop-meta">' + escapeHtml(item.category || 'Guides') + ' · ' + escapeHtml(item.readTime || '5 min read') + '</span>'
                        + '<span class="bp-pop-title">' + escapeHtml(item.title) + '</span>'
                        + '</span></a>';
                }).join('');
                updatePopularVisibility();
            })
            .catch(function () {
                els.popularStrip.hidden = true;
            });
    }

    function updatePopularVisibility() {
        // Hidden while a search query is active (spec 03 §5.3).
        var hasCards = els.popularRail && els.popularRail.children.length > 0;
        els.popularStrip.hidden = !hasCards || !!state.q;
    }

    // ---------------------------------------------------------------- data
    function apiUrl(page) {
        var url = '/api/blogs?limit=' + PER_PAGE + '&page=' + page;
        if (state.group !== 'all') url += '&category=' + encodeURIComponent(state.group);
        if (state.q) url += '&search=' + encodeURIComponent(state.q);
        url += '&sort=' + encodeURIComponent(state.sort);
        return url;
    }

    function syncUrl() {
        var params = new URLSearchParams();
        if (state.group !== 'all') params.set('category', state.group);
        if (state.q) params.set('q', state.q);
        if (state.sort !== 'newest') params.set('sort', state.sort);
        var qs = params.toString();
        try {
            window.history.replaceState(null, '', '/blog' + (qs ? '?' + qs : ''));
        } catch (_) { /* file:// or sandboxed — state still works in-page */ }
    }

    function renderMeta() {
        var group = state.group !== 'all' ? GROUP_BY_SLUG[state.group] : null;
        var text;
        if (state.total === 0) {
            text = state.q ? 'No dispatches match \u201C' + state.q + '\u201D.' : 'No dispatches here yet.';
        } else if (state.q) {
            text = fmtCount(state.total) + ' dispatches match \u201C' + state.q + '\u201D' + (group ? ' in ' + group.name : '') + ' — showing ' + fmtCount(state.shown) + '.';
        } else if (group) {
            text = fmtCount(state.total) + ' dispatches in ' + group.name + ' — showing ' + fmtCount(state.shown) + '.';
        } else {
            text = 'Showing ' + fmtCount(state.shown) + ' of ' + fmtCount(state.total) + ' dispatches.';
        }
        els.resultsMeta.textContent = text;
        els.clearFilters.hidden = !(state.group !== 'all' || state.q);
    }

    function renderLoadMore() {
        var wrap = els.loadMoreWrap;
        var endEl = document.getElementById('loadMoreEnd');
        var btn = document.getElementById('loadMoreBtn');
        if (state.total === 0) { wrap.hidden = true; return; }
        if (state.page >= state.totalPages) {
            // End state — only meaningful after paging through a multi-page set.
            if (state.shown >= state.total && state.totalPages > 1) {
                wrap.hidden = false;
                els.loadMoreProgress.textContent = 'You\u2019ve seen all ' + fmtCount(state.total) + ' dispatches.';
                els.loadMoreBar.style.width = '100%';
                if (btn) btn.hidden = true;
                if (endEl) endEl.hidden = false;
            } else {
                wrap.hidden = true;
            }
            return;
        }
        wrap.hidden = false;
        if (endEl) endEl.hidden = true;
        if (btn) {
            btn.hidden = false;
            btn.disabled = state.loading;
            btn.innerHTML = state.loading ? '<i class="fas fa-circle-notch fa-spin"></i> Loading…' : 'Load More Dispatches';
        }
        els.loadMoreProgress.textContent = 'You\u2019ve seen ' + fmtCount(state.shown) + ' of ' + fmtCount(state.total);
        els.loadMoreBar.style.width = Math.min(100, Math.round((state.shown / Math.max(state.total, 1)) * 100)) + '%';
    }

    function applyResult(data, append) {
        state.total = data.total;
        state.totalPages = data.totalPages;
        state.page = data.page;
        var cards = data.blogs.map(cardHtml).join('');
        if (append) {
            els.grid.insertAdjacentHTML('beforeend', cards);
            state.shown += data.blogs.length;
        } else {
            els.grid.innerHTML = data.blogs.length ? cards : emptyHtml();
            state.shown = data.blogs.length;
        }
        renderMeta();
        renderLoadMore();
    }

    function loadPage(page, append) {
        if (state.loading) return;
        state.loading = true;
        if (!append) {
            els.grid.innerHTML = skeletonHtml(12);
            els.resultsMeta.textContent = 'Searching the wire…';
            els.loadMoreWrap.hidden = true;
        } else {
            renderLoadMore();
        }
        fetch(apiUrl(page))
            .then(function (r) { return r.json(); })
            .then(function (data) {
                state.loading = false;
                if (!data || !data.success || !Array.isArray(data.blogs)) throw new Error('bad response');
                applyResult(data, append);
            })
            .catch(function () {
                state.loading = false;
                if (append) {
                    renderLoadMore();
                } else {
                    els.grid.innerHTML = errorHtml();
                    els.resultsMeta.textContent = 'The wire went quiet — couldn\u2019t load dispatches.';
                    els.loadMoreWrap.hidden = true;
                }
            });
    }

    function resetAndLoad() {
        state.page = 1;
        updatePopularVisibility();
        syncUrl();
        loadPage(1, false);
    }

    function resetFilters() {
        state.group = 'all';
        state.q = '';
        els.searchInput.value = '';
        els.searchClear.hidden = true;
        markActiveChip();
        resetAndLoad();
    }

    // ---------------------------------------------------------------- init
    function initStateFromUrl() {
        var params = new URLSearchParams(window.location.search);
        var catParam = params.get('category');
        var group = resolveGroup(catParam);
        if (group) state.group = group.slug;
        var q = params.get('q') || params.get('search') || '';
        if (q) state.q = q;
        var sort = params.get('sort');
        if (sort && ['newest', 'oldest', 'az', 'za'].indexOf(sort) !== -1) state.sort = sort;
        return !!(catParam || q || sort);
    }

    function init() {
        els = {
            chipRail: document.getElementById('chipRail'),
            grid: document.getElementById('blogGrid'),
            searchInput: document.getElementById('blogSearch'),
            searchClear: document.getElementById('searchClear'),
            sortSelect: document.getElementById('blogSort'),
            resultsMeta: document.getElementById('resultsMeta'),
            clearFilters: document.getElementById('clearFilters'),
            loadMoreWrap: document.getElementById('loadMoreWrap'),
            loadMoreBtn: document.getElementById('loadMoreBtn'),
            loadMoreProgress: document.getElementById('loadMoreProgress'),
            loadMoreBar: document.getElementById('loadMoreBar'),
            popularStrip: document.getElementById('popularStrip'),
            popularRail: document.getElementById('popularRail'),
            toolbar: document.getElementById('blogToolbar')
        };
        if (!els.grid || !els.chipRail) return;

        initStateFromUrl();
        var boot = window.__BLOG_BOOT__ || null;

        buildChips(null, null);
        fetchCategories();
        fetchPopular();

        els.searchInput.value = state.q;
        els.searchClear.hidden = !state.q;
        els.sortSelect.value = state.sort;

        // The route builds __BLOG_BOOT__ from the same URL params parsed
        // above, so when it matches the state we can paint synchronously.
        var bootMatches = boot && Array.isArray(boot.blogs)
            && (boot.group || 'all') === state.group
            && (boot.q || '') === state.q
            && (boot.sort || 'newest') === state.sort;
        if (bootMatches) {
            applyResult({ blogs: boot.blogs, total: boot.total, totalPages: boot.totalPages, page: 1 }, false);
        } else {
            loadPage(1, false);
        }
        updatePopularVisibility();

        // ---- events
        els.chipRail.addEventListener('click', function (e) {
            var chip = e.target.closest('[data-group]');
            if (!chip) return;
            e.preventDefault();
            var g = chip.getAttribute('data-group');
            if (g === state.group) return;
            state.group = g;
            markActiveChip();
            resetAndLoad();
        });

        var debounce = null;
        els.searchInput.addEventListener('input', function () {
            var val = els.searchInput.value.trim();
            els.searchClear.hidden = !val;
            if (val.length === 1) return; // 1 char = no-op (spec 03 §5.4)
            window.clearTimeout(debounce);
            debounce = window.setTimeout(function () {
                if (val === state.q) return;
                state.q = val;
                resetAndLoad();
            }, 300);
        });
        els.searchInput.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                els.searchInput.value = '';
                els.searchClear.hidden = true;
                if (state.q) { state.q = ''; resetAndLoad(); }
            }
        });
        els.searchClear.addEventListener('click', function () {
            els.searchInput.value = '';
            els.searchClear.hidden = true;
            if (state.q) { state.q = ''; resetAndLoad(); }
            els.searchInput.focus();
        });

        els.sortSelect.addEventListener('change', function () {
            if (els.sortSelect.value === state.sort) return;
            state.sort = els.sortSelect.value;
            resetAndLoad();
        });

        els.loadMoreWrap.addEventListener('click', function (e) {
            if (e.target && e.target.id === 'loadMoreBtn') {
                loadPage(state.page + 1, true);
            }
        });

        els.clearFilters.addEventListener('click', resetFilters);

        els.grid.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-action]');
            if (!btn) return;
            var action = btn.getAttribute('data-action');
            if (action === 'reset') resetFilters();
            if (action === 'retry') loadPage(state.page, state.page > 1);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
