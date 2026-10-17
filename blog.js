/**
 * State of Leonida - Vice Wire GTA 6 Luxury Blog Controller
 */
(function() {
    'use strict';

    let allArticles = (typeof window !== 'undefined' && Array.isArray(window.__INITIAL_BLOGS__)) ? window.__INITIAL_BLOGS__ : [];
    let currentCategory = 'all';
    let searchQuery = '';

    // DOM Elements
    let blogSection = null;
    let blogListView = null;
    let blogSingleView = null;
    let featuredContainer = null;
    let gridContainer = null;
    let singleContentEl = null;
    let searchInput = null;

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

    async function initBlog() {
        blogSection = document.getElementById('gta-blog-section') || document.getElementById('blog') || document.querySelector('.gta-blog-section');
        blogListView = document.getElementById('blog-list-view');
        blogSingleView = document.getElementById('blog-single-view');
        featuredContainer = document.getElementById('blog-featured-container');
        gridContainer = document.getElementById('blog-grid-container');
        singleContentEl = document.getElementById('blog-single-content');
        searchInput = document.getElementById('blogSearchInputPublic');

        if (!blogSection) return;

        setupFilterEvents();
        setupRouting();

        // If we already have pre-loaded articles, make sure all click listeners are active
        if (allArticles.length === 0) {
            await fetchArticles();
        } else {
            // Background sync with live API
            fetchArticles();
        }

        handleInitialRoute();
    }

    async function fetchArticles() {
        try {
            const res = await fetch('/api/blogs');
            const data = await res.json();
            if (data.success && Array.isArray(data.blogs) && data.blogs.length > 0) {
                allArticles = data.blogs;
                renderArticlesFeed();
            }
        } catch (err) {
            console.warn('Failed to load Vice Wire articles via API, using embedded fallback:', err);
        }
    }

    function renderArticlesFeed() {
        if (!gridContainer) return;

        let filtered = allArticles.filter(item => {
            const matchesCat = currentCategory === 'all' || (item.category || '').toLowerCase() === currentCategory.toLowerCase();
            const q = searchQuery.toLowerCase();
            const matchesQuery = !q || 
                (item.title || '').toLowerCase().includes(q) ||
                (item.excerpt || '').toLowerCase().includes(q) ||
                (item.author || '').toLowerCase().includes(q) ||
                (item.targetKeyword || '').toLowerCase().includes(q);
            return matchesCat && matchesQuery;
        });

        if (filtered.length === 0) {
            if (featuredContainer) featuredContainer.innerHTML = '';
            gridContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 1rem; color: #8b92aa;">
                    <i class="fas fa-search" style="font-size: 2rem; margin-bottom: 1rem; opacity: 0.5;"></i>
                    <h3 style="color: #fff; margin-bottom: 0.5rem;">No intelligence dispatches found</h3>
                    <p>Try adjusting your keyword search or category filter.</p>
                </div>
            `;
            return;
        }

        // Determine featured item: first item marked featured, or the first article if no query is active
        let featuredItem = null;
        let gridItems = filtered;

        if (!searchQuery && currentCategory === 'all') {
            const featIdx = filtered.findIndex(a => a.featured);
            if (featIdx >= 0) {
                featuredItem = filtered[featIdx];
                gridItems = filtered.filter((_, idx) => idx !== featIdx);
            } else {
                featuredItem = filtered[0];
                gridItems = filtered.slice(1);
            }
        }

        // Render Featured Hero
        if (featuredContainer) {
            if (featuredItem) {
                featuredContainer.innerHTML = `
                    <div class="blog-featured-card" data-slug="${featuredItem.slug}">
                        <div class="blog-featured-media">
                            <img src="${featuredItem.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg'}" alt="${escapeHtml(featuredItem.title)}" class="blog-featured-img">
                            <div class="blog-featured-scrim"></div>
                        </div>
                        <div class="blog-featured-content">
                            <div class="blog-meta-unboxed">
                                <span class="meta-category">${escapeHtml(featuredItem.category || 'Special Report')}</span>
                                <span class="meta-sep" aria-hidden="true">·</span>
                                <span>${featuredItem.readTime || '5 min read'}</span>
                                <span class="meta-sep" aria-hidden="true">·</span>
                                <span>${formatDate(featuredItem.date)}</span>
                            </div>
                            <h2 class="blog-featured-title"><a href="/guides/${featuredItem.slug}" class="js-open-article" data-slug="${featuredItem.slug}" style="color:inherit; text-decoration:none;">${escapeHtml(featuredItem.title)}</a></h2>
                            <p class="blog-featured-excerpt">${escapeHtml(featuredItem.excerpt || '')}</p>
                            <a href="/guides/${featuredItem.slug}" class="blog-btn-action js-open-article" data-slug="${featuredItem.slug}" style="display:inline-flex; text-decoration:none;">
                                <span>Read Full Investigation</span>
                                <i class="fas fa-arrow-right"></i>
                            </a>
                        </div>
                    </div>
                `;
            } else {
                featuredContainer.innerHTML = '';
            }
        }

        // Render Grid Cards — each card is a real <a> to /guides/<slug> so crawlers
        // follow article URLs; JS click handler keeps the SPA experience.
        gridContainer.innerHTML = gridItems.map(item => `
            <article class="blog-card js-open-article" data-slug="${item.slug}">
                <a href="/guides/${item.slug}" class="blog-card-link" data-slug="${item.slug}" style="display:block; color:inherit; text-decoration:none;">
                <div class="blog-card-media">
                    <img src="${item.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg'}" alt="${escapeHtml(item.title)}" class="blog-card-img" loading="lazy">
                </div>
                <div class="blog-card-content">
                    <div class="blog-meta-unboxed">
                        <span class="meta-category">${escapeHtml(item.category || 'Intelligence')}</span>
                        <span class="meta-sep" aria-hidden="true">·</span>
                        <span>${item.readTime || '4 min read'}</span>
                    </div>
                    <h3 class="blog-card-title">${escapeHtml(item.title)}</h3>
                    <p class="blog-card-excerpt">${escapeHtml(item.excerpt || '')}</p>
                    <div class="blog-card-footer">
                        <span style="color: #9ba3be; font-weight: 500;">${escapeHtml(item.author || 'Yanis GIS')} · ${formatDate(item.date)}</span>
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

    function showSingleArticle(slug) {
        const article = allArticles.find(a => a.slug === slug || a.id === slug);
        if (!article) return;

        if (blogListView) blogListView.style.display = 'none';
        if (blogSingleView) {
            blogSingleView.style.display = 'block';
            scrollLandingToBlog();
        }

        // Update URL hash
        try {
            window.history.pushState(null, '', '#blog/' + article.slug);
        } catch (_) {}

        // Map Jump block HTML
        let mapJumpHtml = '';
        if (article.lat !== null && article.lng !== null && !isNaN(article.lat) && !isNaN(article.lng)) {
            mapJumpHtml = `
                <div class="blog-map-jump-callout">
                    <div class="map-jump-info">
                        <div class="map-jump-icon"><i class="fas fa-crosshairs"></i></div>
                        <div>
                            <div class="map-jump-title">Triangulated Coordinates Referenced</div>
                            <div class="map-jump-coords">Cartesian Plane: X: ${article.lng.toFixed(1)} · Y: ${article.lat.toFixed(1)}</div>
                        </div>
                    </div>
                    <button type="button" class="btn-jump-leaflet" data-lat="${article.lat}" data-lng="${article.lng}" data-hotspot="${article.hotspotKey || ''}">
                        <i class="fas fa-map-marked-alt"></i>
                        <span>Launch on 21K Map</span>
                    </button>
                </div>
            `;
        }

        const initialLetter = (article.author || 'Y').charAt(0).toUpperCase();

        if (singleContentEl) {
            singleContentEl.innerHTML = `
                <div class="blog-nav-bar">
                    <button type="button" class="btn-blog-back" id="btnBackToFeed">
                        <i class="fas fa-arrow-left"></i>
                        <span>Back to All Stories</span>
                    </button>
                    <div style="font-size: 0.85rem; color: #8b92aa; font-weight: 600;">
                        <span>State of Leonida</span> / <span>Vice Wire</span> / <span style="color: var(--gta-pink);">${escapeHtml(article.category)}</span>
                    </div>
                </div>

                <div class="blog-single-hero">
                    <img src="${article.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg'}" alt="${escapeHtml(article.title)}" class="blog-single-img">
                    <div class="blog-single-scrim"></div>
                    <div class="blog-single-header">
                        <div class="blog-meta-unboxed">
                            <span class="meta-category">${escapeHtml(article.category)}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${article.readTime || '5 min read'}</span>
                            <span class="meta-sep" aria-hidden="true">·</span>
                            <span>${formatDate(article.date)}</span>
                        </div>
                        <h1 class="blog-single-title">${escapeHtml(article.title)}</h1>
                        <div class="blog-author-strip">
                            <div class="author-avatar-badge">${initialLetter}</div>
                            <div class="author-info-block">
                                <span class="author-name">${escapeHtml(article.author || 'Vice Intelligence Team')}</span>
                                <span class="author-role">${escapeHtml(article.authorRole || 'Cartography & Lore Analyst')}</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="blog-body">
                    ${mapJumpHtml}
                    ${article.content || '<p>' + escapeHtml(article.excerpt) + '</p>'}
                    ${mapJumpHtml}
                </div>

                <!-- Bottom Author Bio & Return Action -->
                <div style="margin-top: 4rem; padding-top: 2rem; border-top: 1px solid rgba(255,255,255,0.1); display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1.5rem;">
                    <div>
                        <div style="font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.1em; color: var(--gta-pink); font-weight: 800; margin-bottom: 0.3rem;">DISPATCH VERIFICATION</div>
                        <div style="font-size: 0.95rem; color: #9ba3be;">Published by the State of Leonida Mapping Community Research Bureau.</div>
                    </div>
                    <button type="button" class="btn-blog-back js-back-to-feed">
                        <i class="fas fa-arrow-left"></i>
                        <span>Return to Vice Wire Feed</span>
                    </button>
                </div>
            `;
        }
    }

    function showArticlesFeed() {
        if (blogSingleView) blogSingleView.style.display = 'none';
        if (blogListView) {
            blogListView.style.display = 'block';
            scrollLandingToBlog();
        }
        try {
            window.history.pushState(null, '', '#blog');
        } catch (_) {}
    }

    function setupFilterEvents() {
        const filterBtns = document.querySelectorAll('.js-blog-filter');
        filterBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                filterBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentCategory = btn.getAttribute('data-category') || 'all';
                renderArticlesFeed();
            });
        });

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                searchQuery = e.target.value.trim();
                renderArticlesFeed();
            });
        }

        // Global delegate clicks for blog interactions
        document.addEventListener('click', (e) => {
            // Header or Nav links leading to blog
            const navBlogBtn = e.target.closest('#header-blog-btn, #btn-header-blog, #nav-link-blog, a[href="#blog"], .js-to-blog');
            if (navBlogBtn) {
                e.preventDefault();
                showArticlesFeed();
                return;
            }

            // Click on article card
            const openBtn = e.target.closest('.js-open-article');
            if (openBtn) {
                e.preventDefault();
                const slug = openBtn.getAttribute('data-slug');
                if (slug) showSingleArticle(slug);
                return;
            }

            // Back to feed buttons
            const backBtn = e.target.closest('#btnBackToFeed') || e.target.closest('.js-back-to-feed');
            if (backBtn) {
                e.preventDefault();
                showArticlesFeed();
                return;
            }

            // Launch interactive map jump from article
            const mapJumpBtn = e.target.closest('.btn-jump-leaflet');
            if (mapJumpBtn) {
                e.preventDefault();
                const lat = parseFloat(mapJumpBtn.getAttribute('data-lat'));
                const lng = parseFloat(mapJumpBtn.getAttribute('data-lng'));
                const hotspotKey = mapJumpBtn.getAttribute('data-hotspot');

                if (window.GTALanding && typeof window.GTALanding.openMap === 'function') {
                    window.GTALanding.openMap(hotspotKey);
                } else {
                    window.location.hash = '#map';
                }

                if (!isNaN(lat) && !isNaN(lng)) {
                    setTimeout(() => {
                        try {
                            const m = (window.mapManager && window.mapManager.getMap) ? window.mapManager.getMap() : (window.MapFeatures && window.MapFeatures.getMap ? window.MapFeatures.getMap() : null);
                            if (m && typeof m.setView === 'function') {
                                m.setView([lat, lng], 4.5, { animate: true });
                            }
                        } catch (_) {}
                    }, 250);
                }
            }
        });
    }

    function setupRouting() {
        window.addEventListener('hashchange', () => {
            handleInitialRoute();
        });
    }

    function handleInitialRoute() {
        const hash = window.location.hash;
        const path = window.location.pathname;

        if (hash.startsWith('#blog/')) {
            const slug = hash.replace('#blog/', '');
            if (slug) {
                const landing = document.getElementById('gta-landing-page');
                if (landing) landing.classList.remove('landing-hidden');
                const returnBtn = document.getElementById('map-return-landing-btn');
                if (returnBtn) returnBtn.style.display = 'none';
                showSingleArticle(slug);
            }
        } else if (hash === '#blog' || path === '/blog' || path === '/news') {
            const landing = document.getElementById('gta-landing-page');
            if (landing) landing.classList.remove('landing-hidden');
            const returnBtn = document.getElementById('map-return-landing-btn');
            if (returnBtn) returnBtn.style.display = 'none';
            showArticlesFeed();
            setTimeout(scrollLandingToBlog, 100);
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

    // Initialize when DOM ready or immediately if already loaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlog);
    } else {
        initBlog();
    }

    window.GTABlog = {
        showArticlesFeed,
        showSingleArticle,
        refresh: fetchArticles,
        scrollToBlog: scrollLandingToBlog
    };
})();
