/**
 * State of Leonida - GTA 6 Landing Page Interactive Controller
 */
(function() {
    'use strict';

    // Original GTA VI Official Target Release Date: November 19, 2026 (00:00:00 UTC)
    let TARGET_DATE = new Date('2026-11-19T00:00:00Z').getTime();

    async function applySiteConfig() {
        try {
            const res = await fetch('/api/site-config');
            if (!res.ok) return;
            const config = await res.json();

            // 1. Countdown Date & Visibility
            if (config.countdownDate) {
                const parsed = new Date(config.countdownDate).getTime();
                if (!isNaN(parsed)) TARGET_DATE = parsed;
            }
            if (config.countdownEnabled === false) {
                const cd1 = document.getElementById('gta-countdown-wrapper');
                const cd2 = document.querySelector('.hero-countdown-box');
                if (cd1) cd1.style.display = 'none';
                if (cd2) cd2.style.display = 'none';
            }

            // 2. Preloader "Affiliated With" and Partner Credits
            if (config.watermarks) {
                const wm = config.watermarks;
                const affImg = document.querySelector('.preloader-affiliated');
                if (affImg) {
                    if (wm.preloaderAffiliatedEnabled === false) {
                        affImg.style.display = 'none';
                    } else if (wm.preloaderAffiliatedImage) {
                        affImg.src = wm.preloaderAffiliatedImage;
                        affImg.style.display = 'block';
                    }
                }

                // Partner 1 (GTADB or Custom)
                const p1 = wm.partner1;
                const p1El = document.querySelector('.credits-gtadb');
                if (p1 && p1El) {
                    if (p1.enabled === false) {
                        p1El.style.display = 'none';
                    } else {
                        p1El.style.display = 'flex';
                        if (p1.url) p1El.href = p1.url;
                        if (p1.logo) {
                            const img = p1El.querySelector('.credits-logo');
                            if (img) img.src = p1.logo;
                        }
                        if (p1.name) {
                            const title = p1El.querySelector('.credits-title');
                            if (title) title.textContent = p1.name;
                        }
                        if (p1.subtitle) {
                            const sub = p1El.querySelector('.credits-subtitle');
                            if (sub) sub.textContent = p1.subtitle;
                        }
                    }
                }

                // Partner 2 (GTA.Wiki or Custom)
                const p2 = wm.partner2;
                const p2El = document.querySelector('.credits-gtawiki');
                if (p2 && p2El) {
                    if (p2.enabled === false) {
                        p2El.style.display = 'none';
                    } else {
                        p2El.style.display = 'flex';
                        if (p2.url) p2El.href = p2.url;
                        if (p2.logo) {
                            const img = p2El.querySelector('.credits-logo');
                            if (img) img.src = p2.logo;
                        }
                        if (p2.name) {
                            const title = p2El.querySelector('.credits-title');
                            if (title) title.textContent = p2.name;
                        }
                        if (p2.subtitle) {
                            const sub = p2El.querySelector('.credits-subtitle');
                            if (sub) sub.textContent = p2.subtitle;
                        }
                    }
                }
            }

            // 3. Header Center Banner (Mappingcool2 GIF)
            if (config.headerBanner) {
                const bannerBtn = document.getElementById('header-mapping-btn');
                if (bannerBtn) {
                    if (config.headerBanner.enabled === false) {
                        bannerBtn.style.display = 'none';
                    } else {
                        bannerBtn.style.display = 'flex';
                        if (config.headerBanner.targetUrl) bannerBtn.href = config.headerBanner.targetUrl;
                        const img = bannerBtn.querySelector('.mapping-video');
                        if (img && config.headerBanner.imageUrl) img.src = config.headerBanner.imageUrl;
                    }
                }
            }

            // 4. Discord Community URL updates
            if (config.discordUrl) {
                document.querySelectorAll('a[href*="discord.gg"]').forEach(a => {
                    a.href = config.discordUrl;
                });
            }

            // 5. Custom Disclaimers & Copyright
            if (config.disclaimers) {
                if (config.disclaimers.preloaderDisclaimer) {
                    const discEl = document.querySelector('.preloader-disclaimer');
                    if (discEl) {
                        discEl.innerHTML = `<span class="preloader-disclaimer-line">${config.disclaimers.preloaderDisclaimer}</span>`;
                    }
                }
                if (config.disclaimers.footerDisclaimer) {
                    const footDiscEl = document.querySelector('.footer-disclaimer p');
                    if (footDiscEl) {
                        footDiscEl.textContent = config.disclaimers.footerDisclaimer;
                    }
                }
            }
        } catch (_) {}
    }

    // Hotspot Coordinates in Leonida Engine
    const HOTSPOTS = {
        'ocean-drive': { name: 'Ocean Drive & Vice Beach', lat: 1409.4, lng: 2803.2, zoom: 4 },
        'port-gellhorn': { name: 'Port Gellhorn Industrial Strip', lat: -2100.0, lng: -8500.0, zoom: 4 },
        'airport': { name: 'Vice City International Airport', lat: -1200.0, lng: 1100.0, zoom: 4 },
        'keys': { name: 'Leonida Keys Overseas Highway', lat: -7800.0, lng: -2100.0, zoom: 4 },
        'ambrosia': { name: 'Ambrosia Sugar Mill', lat: 3400.0, lng: -4100.0, zoom: 4 },
        'lake-leonida': { name: 'Lake Leonida & Grassrivers', lat: 1100.0, lng: -3200.0, zoom: 4 }
    };

    function initCountdown() {
        const dEl = document.getElementById('landing-days');
        const hEl = document.getElementById('landing-hours');
        const mEl = document.getElementById('landing-minutes');
        const sEl = document.getElementById('landing-seconds');

        if (!dEl || !hEl || !mEl || !sEl) return;

        function update() {
            const now = Date.now();
            const diff = Math.max(0, TARGET_DATE - now);

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
            const minutes = Math.floor((diff / (1000 * 60)) % 60);
            const seconds = Math.floor((diff / 1000) % 60);

            dEl.textContent = String(days).padStart(3, '0');
            hEl.textContent = String(hours).padStart(2, '0');
            mEl.textContent = String(minutes).padStart(2, '0');
            sEl.textContent = String(seconds).padStart(2, '0');

            const headerDaysEl = document.getElementById('countdown-days');
            if (headerDaysEl) {
                headerDaysEl.textContent = String(days);
            }
        }

        update();
        setInterval(update, 1000);
    }

    function openMap(hotspotKey) {
        const landing = document.getElementById('gta-landing-page');
        const returnBtn = document.getElementById('map-return-landing-btn');

        if (landing) {
            landing.classList.add('landing-hidden');
        }
        if (returnBtn) {
            returnBtn.style.display = 'inline-flex';
        }

        // Inform URL hash without reloading
        try {
            window.history.replaceState(null, '', '#map');
        } catch (_) {}

        function getLeafletMap() {
            try {
                if (window.mapManager && typeof window.mapManager.getMap === 'function') {
                    const m = window.mapManager.getMap();
                    if (m && typeof m.invalidateSize === 'function') return m;
                }
                if (window.mapManager && window.mapManager.currentMap && typeof window.mapManager.currentMap.invalidateSize === 'function') {
                    return window.mapManager.currentMap;
                }
                if (window.MapFeatures && typeof window.MapFeatures.getMap === 'function') {
                    const m = window.MapFeatures.getMap();
                    if (m && typeof m.invalidateSize === 'function') return m;
                }
            } catch (_) {}
            return null;
        }

        // Invalidate map size so Leaflet fills screen properly
        setTimeout(() => {
            const leafletMap = getLeafletMap();
            if (leafletMap) {
                try {
                    if (typeof leafletMap.invalidateSize === 'function') {
                        leafletMap.invalidateSize();
                    }
                    if (hotspotKey && HOTSPOTS[hotspotKey] && typeof leafletMap.setView === 'function') {
                        const spot = HOTSPOTS[hotspotKey];
                        leafletMap.setView([spot.lat, spot.lng], spot.zoom, { animate: true });
                    }
                } catch (_) {}
            }
        }, 150);
    }

    function openLanding(preserveScroll) {
        const landing = document.getElementById('gta-landing-page');
        const returnBtn = document.getElementById('map-return-landing-btn');

        if (landing) {
            landing.classList.remove('landing-hidden');
            if (!preserveScroll) {
                landing.scrollTop = 0;
            }
        }
        if (returnBtn) {
            returnBtn.style.display = 'none';
        }

        try {
            if (window.location.hash === '#map') {
                window.history.replaceState(null, '', window.location.pathname);
            }
        } catch (_) {}
    }

    function setupEventListeners() {
        // Launch buttons
        const launchBtns = document.querySelectorAll('.js-launch-map');
        launchBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const target = btn.getAttribute('data-hotspot');
                openMap(target);
            });
        });

        // Return button
        const returnBtn = document.getElementById('map-return-landing-btn');
        if (returnBtn) {
            returnBtn.addEventListener('click', (e) => {
                e.preventDefault();
                openLanding();
            });
        }

        // Hotspot chips
        const hotspotChips = document.querySelectorAll('.js-hotspot-chip');
        hotspotChips.forEach(chip => {
            chip.addEventListener('click', () => {
                const spot = chip.getAttribute('data-spot');
                openMap(spot);
            });
        });

        // Encyclopedia Tabs
        const encTabs = document.querySelectorAll('.encyclopedia-tab');
        const encPanels = document.querySelectorAll('.encyclopedia-panel');
        encTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.getAttribute('data-tab');
                encTabs.forEach(t => t.classList.remove('active'));
                encPanels.forEach(p => p.classList.remove('active'));
                tab.classList.add('active');
                const targetPanel = document.getElementById('panel-' + target);
                if (targetPanel) targetPanel.classList.add('active');
            });
        });

        // Direct Coordinate Map Jump Buttons in Encyclopedia Tables
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-table-map');
            if (btn) {
                e.preventDefault();
                const lat = parseFloat(btn.getAttribute('data-lat'));
                const lng = parseFloat(btn.getAttribute('data-lng'));
                const zoom = parseFloat(btn.getAttribute('data-zoom')) || 4.5;
                if (!isNaN(lat) && !isNaN(lng)) {
                    openMap();
                    setTimeout(() => {
                        try {
                            const m = (window.mapManager && window.mapManager.getMap) ? window.mapManager.getMap() : (window.MapFeatures && window.MapFeatures.getMap ? window.MapFeatures.getMap() : null);
                            if (m && typeof m.setView === 'function') {
                                m.setView([lat, lng], zoom, { animate: true });
                            }
                        } catch (_) {}
                    }, 250);
                }
            }
        });

        // Direct Navigation to Vice Wire Blog
        function jumpToBlog(e) {
            if (e && typeof e.preventDefault === 'function') e.preventDefault();
            const landing = document.getElementById('gta-landing-page');
            const returnBtn = document.getElementById('map-return-landing-btn');
            if (landing) landing.classList.remove('landing-hidden');
            if (returnBtn) returnBtn.style.display = 'none';

            if (window.GTABlog && typeof window.GTABlog.showArticlesFeed === 'function') {
                window.GTABlog.showArticlesFeed();
            } else {
                const single = document.getElementById('blog-single-view');
                const list = document.getElementById('blog-list-view');
                if (single) single.style.display = 'none';
                if (list) list.style.display = 'block';
            }

            const blogSec = document.getElementById('blog');
            if (blogSec && landing) {
                setTimeout(() => {
                    const topPos = Math.max(0, blogSec.offsetTop - 50);
                    landing.scrollTo({ top: topPos, behavior: 'smooth' });
                    try { blogSec.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
                }, 50);
            }
            try { window.history.pushState(null, '', '#blog'); } catch (_) {}
        }

        // Header blog button on map
        const headerBlogBtn = document.getElementById('header-blog-btn');
        if (headerBlogBtn) {
            headerBlogBtn.addEventListener('click', jumpToBlog);
        }

        // Header blog button on landing top bar
        const btnHeaderBlog = document.getElementById('btn-header-blog');
        if (btnHeaderBlog) {
            btnHeaderBlog.addEventListener('click', jumpToBlog);
        }

        // Nav link to blog
        const navLinkBlog = document.getElementById('nav-link-blog');
        if (navLinkBlog) {
            navLinkBlog.addEventListener('click', jumpToBlog);
        }

        // Check if user came with #map or ?view=map
        const urlParams = new URLSearchParams(window.location.search);
        if (window.location.hash === '#map' || urlParams.get('view') === 'map') {
            openMap();
        } else if (window.location.hash === '#blog' || window.location.hash.startsWith('#blog/')) {
            openLanding(true);
            setTimeout(jumpToBlog, 150);
        } else {
            // Default to landing page
            openLanding();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            applySiteConfig();
            initCountdown();
            setupEventListeners();
        });
    } else {
        applySiteConfig();
        initCountdown();
        setupEventListeners();
    }

    // Expose helpers globally
    window.GTALanding = {
        openMap: openMap,
        openLanding: openLanding
    };
})();
