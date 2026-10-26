/**
 * State of Leonida - Vice Wire "Popular" homepage controller (Redesign Phase 1).
 *
 * Homepage scope ONLY: fetches the 10 curated Popular cards from
 * /api/blogs/popular (card fields, never full articles) and renders them into
 * #blog-featured-container (rank #1) + #blog-grid-container (ranks #2-#10).
 * The full catalogue, search, filters and the in-page reader live on /blog.
 */
(function() {
    'use strict';

    const CATEGORY_ICONS = {
        'Guides': 'fa-compass',
        'GTA 6 Updates': 'fa-bolt',
        'Trailer Analysis': 'fa-film',
        'Cartography & Leaks': 'fa-map-location-dot',
        'Districts & Lore': 'fa-city',
        'Vehicles & Heists': 'fa-car',
        'Dev Telemetry': 'fa-microchip',
        'Q&A': 'fa-circle-question'
    };
    const FALLBACK_COVER = 'assets/photos/screenshots/vice_city/Vice_City_05.jpg';

    let blogSection = null;
    let featuredContainer = null;
    let gridContainer = null;

    function scrollLandingToBlog() {
        const landing = document.getElementById('gta-landing-page');
        const blogSec = blogSection || document.getElementById('blog');
        if (landing) {
            landing.classList.remove('landing-hidden');
            if (blogSec) {
                const targetTop = Math.max(0, blogSec.offsetTop - 50);
                landing.scrollTo({ top: targetTop, behavior: 'smooth' });
            }
        }
        if (blogSec) {
            try { blogSec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        }
    }

    function rankChip(rank) {
        return `<span class="blog-rank-chip" aria-hidden="true">#${rank}</span>`;
    }

    function categoryBadge(category) {
        const icon = CATEGORY_ICONS[category] || 'fa-bolt';
        return `<span class="blog-card-badge" aria-hidden="true"><i class="fas ${icon}"></i>${escapeHtml(category || 'Intelligence')}</span>`;
    }

    function renderFeatured(item) {
        if (!featuredContainer || !item) return;
        featuredContainer.innerHTML = `
            <div class="blog-featured-card" data-slug="${escapeHtml(item.slug)}">
                <div class="blog-featured-media">
                    <img src="${escapeHtml(item.coverImage || FALLBACK_COVER)}" alt="${escapeHtml(item.title)}" class="blog-featured-img" loading="lazy" decoding="async">
                    <div class="blog-featured-scrim"></div>
                    ${rankChip(1)}
                </div>
                <div class="blog-featured-content">
                    <div class="blog-meta-unboxed">
                        <span class="meta-category">${escapeHtml(item.category || 'Special Report')}</span>
                        <span class="meta-sep" aria-hidden="true">·</span>
                        <span><i class="far fa-clock" aria-hidden="true"></i> ${escapeHtml(item.readTime || '5 min read')}</span>
                        <span class="meta-sep" aria-hidden="true">·</span>
                        <span>${formatDate(item.date)}</span>
                    </div>
                    <h3 class="blog-featured-title"><a href="/guides/${escapeHtml(item.slug)}" style="color:inherit; text-decoration:none;">${escapeHtml(item.title)}</a></h3>
                    <p class="blog-featured-excerpt">${escapeHtml(item.excerpt || '')}</p>
                    <a href="/guides/${escapeHtml(item.slug)}" class="blog-btn-action" style="display:inline-flex; text-decoration:none;">
                        <span>Read Full Investigation</span>
                        <i class="fas fa-arrow-right"></i>
                    </a>
                </div>
            </div>
        `;
    }

    function renderGrid(items) {
        if (!gridContainer) return;
        gridContainer.innerHTML = items.map((item, idx) => `
            <article class="blog-card" data-slug="${escapeHtml(item.slug)}">
                <a href="/guides/${escapeHtml(item.slug)}" class="blog-card-link" style="display:block; color:inherit; text-decoration:none;">
                    <div class="blog-card-media">
                        <img src="${escapeHtml(item.coverImage || FALLBACK_COVER)}" alt="${escapeHtml(item.title)}" class="blog-card-img" loading="lazy" decoding="async">
                        ${categoryBadge(item.category)}
                        ${rankChip(idx + 2)}
                    </div>
                    <div class="blog-card-content">
                        <h3 class="blog-card-title">${escapeHtml(item.title)}</h3>
                        <div class="blog-meta-unboxed">
                            <span><i class="far fa-clock" aria-hidden="true"></i> ${escapeHtml(item.readTime || '4 min read')}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${formatDate(item.date)}</span>
                        </div>
                        <div class="blog-card-footer">
                            <span class="blog-read-link">
                                <span>Read Report</span>
                                <i class="fas fa-arrow-right"></i>
                            </span>
                        </div>
                    </div>
                </a>
            </article>
        `).join('');
    }

    function setExploreCount(total) {
        const el = document.getElementById('blogTotalCount');
        const n = parseInt(total, 10);
        if (el && Number.isFinite(n) && n > 0) {
            el.textContent = n.toLocaleString('en-US') + ' ';
        }
    }

    async function fetchPopular() {
        try {
            const res = await fetch('/api/blogs/popular');
            const data = await res.json();
            if (data.success && Array.isArray(data.blogs) && data.blogs.length > 0) {
                const cards = data.blogs.slice(0, 10);
                renderFeatured(cards[0]);
                renderGrid(cards.slice(1));
                setExploreCount(data.total);
            }
        } catch (err) {
            console.warn('Failed to load Popular articles:', err);
        }
    }

    function handleInitialRoute() {
        const hash = window.location.hash;
        if (hash.startsWith('#blog/')) {
            // Legacy in-page reader links → canonical article URL.
            const slug = hash.replace('#blog/', '').trim();
            if (slug) window.location.replace('/guides/' + encodeURIComponent(slug));
        }
    }

    function initBlog() {
        blogSection = document.getElementById('blog') || document.querySelector('.gta-blog-section');
        featuredContainer = document.getElementById('blog-featured-container');
        gridContainer = document.getElementById('blog-grid-container');
        if (!blogSection || !gridContainer) return;

        // In-page "#blog" anchors (e.g. landing CTAs) scroll to the section;
        // nav Vice Wire links point to /blog and navigate normally.
        document.addEventListener('click', (e) => {
            const anchor = e.target.closest('a[href="#blog"], .js-to-blog');
            if (anchor) {
                e.preventDefault();
                scrollLandingToBlog();
            }
        });

        handleInitialRoute();
        schedulePopularFetch();
    }

    // The Popular cards live below the fold: defer the fetch until the
    // browser is idle (1.5s cap) so it never competes with first paint or
    // the map boot. GTABlog.refresh (below) still fetches on demand.
    let popularFetchScheduled = false;
    function schedulePopularFetch() {
        if (popularFetchScheduled) return;
        popularFetchScheduled = true;
        const start = () => fetchPopular();
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(start, { timeout: 1500 });
        } else {
            setTimeout(start, 300);
        }
    }

    function formatDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) {
            return dateStr;
        }
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlog);
    } else {
        initBlog();
    }

    // Backwards-compatible surface for landing.js callers.
    window.GTABlog = {
        showArticlesFeed: scrollLandingToBlog,
        showSingleArticle: function(slug) {
            if (slug) window.location.href = '/guides/' + encodeURIComponent(slug);
        },
        refresh: fetchPopular,
        scrollToBlog: scrollLandingToBlog
    };
})();
