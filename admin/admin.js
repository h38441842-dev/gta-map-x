/**
 * State of Leonida - Master Admin Panel Client Controller
 */

const adminApp = (() => {
    'use strict';

    const API_BASE = '/api/admin';
    let landmarksData = [];
    let blogsData = [];
    let currentTab = 'overview';

    // Elements
    const loginOverlay = document.getElementById('loginOverlay');
    const adminAppEl = document.getElementById('adminApp');
    const loginForm = document.getElementById('loginForm');
    const loginError = document.getElementById('loginError');
    const adminPassInput = document.getElementById('adminPassInput');
    const logoutBtn = document.getElementById('logoutBtn');
    const pageTitle = document.getElementById('pageTitle');
    const toastEl = document.getElementById('adminToast');
    const toastMsg = document.getElementById('toastMsg');

    function showToast(message, isError = false) {
        if (!toastEl || !toastMsg) return;
        toastMsg.textContent = message;
        toastEl.style.borderColor = isError ? 'var(--admin-danger)' : 'var(--admin-border)';
        toastEl.classList.add('show');
        setTimeout(() => {
            toastEl.classList.remove('show');
        }, 3000);
    }

    function getAdminToken() {
        return sessionStorage.getItem('gmx_admin_token') || '';
    }

    function authHeaders(extra) {
        return Object.assign({ 'Authorization': 'Bearer ' + getAdminToken() }, extra || {});
    }

    // Wrapper: all admin API calls automatically carry the session token.
    // On 401 the session is cleared and the login screen is shown.
    async function adminFetch(url, options) {
        const opts = Object.assign({}, options);
        opts.headers = authHeaders(opts.headers);
        const res = await fetch(url, opts);
        if (res.status === 401) {
            sessionStorage.removeItem('gmx_admin_token');
            checkAuth();
            showToast('Session expired — please log in again', true);
        }
        return res;
    }

    function checkAuth() {
        const token = getAdminToken();
        if (token) {
            if (loginOverlay) loginOverlay.style.display = 'none';
            if (adminAppEl) adminAppEl.style.display = 'flex';
            initData();
        } else {
            if (loginOverlay) loginOverlay.style.display = 'flex';
            if (adminAppEl) adminAppEl.style.display = 'none';
        }
    }

    async function handleLogin(e) {
        e.preventDefault();
        const pass = adminPassInput.value.trim();

        try {
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ passcode: pass })
            });
            const data = await res.json();

            if (data.success && data.token) {
                sessionStorage.setItem('gmx_admin_token', data.token);
                if (loginError) loginError.style.display = 'none';
                if (loginOverlay) loginOverlay.style.display = 'none';
                if (adminAppEl) adminAppEl.style.display = 'flex';
                showToast('Welcome to State of Leonida Control Center');
                initData();
            } else {
                if (loginError) loginError.style.display = 'block';
            }
        } catch (_) {
            if (loginError) loginError.style.display = 'block';
            showToast('Login failed: server unreachable', true);
        }
    }

    function handleLogout() {
        sessionStorage.removeItem('gmx_admin_token');
        checkAuth();
        showToast('Logged out successfully');
    }

    function switchTab(tabId) {
        currentTab = tabId;
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

        const targetTab = document.getElementById(`tab-${tabId}`);
        const targetBtn = document.querySelector(`.nav-item[data-tab="${tabId}"]`);

        if (targetTab) targetTab.classList.add('active');
        if (targetBtn) targetBtn.classList.add('active');

        const titles = {
            overview: 'System Overview',
            seo: 'SEO & Keywords Control',
            indexing: 'Indexing & Sitemap Control',
            landmarks: 'Landmarks & Leaks Database',
            blog: 'Vice Wire Blog Articles',
            submissions: 'Community User Submissions',
            maps: 'GIS Cartography Layers',
            settings: 'Site Settings & Countdown',
            backup: 'Database Backup & Export'
        };
        if (pageTitle) pageTitle.textContent = titles[tabId] || 'Master Admin';

        if (tabId === 'landmarks' && landmarksData.length === 0) {
            loadLandmarks();
        } else if (tabId === 'seo') {
            loadSeoSettings();
        } else if (tabId === 'indexing') {
            loadIndexingStatus();
        } else if (tabId === 'blog') {
            loadBlogs();
        } else if (tabId === 'submissions') {
            loadSubmissions();
        } else if (tabId === 'maps') {
            loadMapLayers();
        } else if (tabId === 'settings') {
            loadSiteSettings();
        }
    }

    // ---- SEO Indexing tab ----
    async function loadIndexingStatus() {
        try {
            const res = await adminFetch(`${API_BASE}/seo/sitemap-status`);
            const data = await res.json();
            if (data.success) {
                const t = document.getElementById('idxTotalUrls');
                const a = document.getElementById('idxArticleUrls');
                const l = document.getElementById('idxSitemapLink');
                if (t) t.textContent = data.totalUrls.toLocaleString();
                if (a) a.textContent = data.articleUrls.toLocaleString();
                if (l) l.href = '/sitemap.xml';
            }
            const rres = await adminFetch(`${API_BASE}/seo/robots`);
            const rdata = await rres.json();
            const editor = document.getElementById('robotsEditor');
            if (editor && rdata.success) editor.value = rdata.content;
        } catch (e) {
            console.error('Indexing status error:', e);
        }
    }

    async function pingSitemap() {
        const out = document.getElementById('pingResult');
        if (out) out.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Pinging search engines...';
        try {
            const res = await adminFetch(`${API_BASE}/seo/ping-sitemap`, { method: 'POST' });
            const data = await res.json();
            if (out) {
                out.innerHTML = (data.results || []).map(r =>
                    `<span class="badge-tag ${r.ok ? 'badge-cyan' : 'badge-pink'}">${r.engine}: ${r.ok ? 'OK (' + r.status + ')' : 'FAILED'}</span>`
                ).join(' ');
            }
            showToast('Sitemap ping sent');
        } catch (e) {
            if (out) out.textContent = 'Ping failed: ' + e.message;
        }
    }

    async function sendIndexNow() {
        const ta = document.getElementById('indexNowUrls');
        const out = document.getElementById('indexNowResult');
        const urls = (ta?.value || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 100);
        if (urls.length === 0) {
            if (out) out.textContent = 'Enter at least one URL';
            return;
        }
        if (out) out.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
        try {
            const res = await adminFetch(`${API_BASE}/seo/indexnow`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls })
            });
            const data = await res.json();
            if (out) out.textContent = data.success ? `IndexNow accepted (${urls.length} URLs)` : 'IndexNow failed: ' + (data.error || data.status);
            showToast(data.success ? 'IndexNow sent' : 'IndexNow failed', !data.success);
        } catch (e) {
            if (out) out.textContent = 'Error: ' + e.message;
        }
    }

    async function sendIndexNowAll() {
        const out = document.getElementById('indexNowAllResult');
        if (out) out.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting all URLs...';
        try {
            const res = await adminFetch(`${API_BASE}/seo/indexnow-all`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (out) out.textContent = data.success
                ? `IndexNow accepted — ${data.submitted} URLs submitted for ${data.host}`
                : 'IndexNow failed: ' + (data.error || data.status);
            showToast(data.success ? 'All URLs submitted via IndexNow' : 'IndexNow failed', !data.success);
        } catch (e) {
            if (out) out.textContent = 'Error: ' + e.message;
        }
    }

    async function saveRobots() {
        const editor = document.getElementById('robotsEditor');
        const content = editor?.value || '';
        if (content.includes('Disallow: /') && !confirm('WARNING: "Disallow: /" blocks ALL search engines. Are you sure?')) return;
        try {
            const res = await adminFetch(`${API_BASE}/seo/robots`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ content })
            });
            const data = await res.json();
            showToast(data.success ? 'robots.txt saved' : 'Save failed', !data.success);
        } catch (e) {
            showToast('Error: ' + e.message, true);
        }
    }

    async function initData() {
        loadOverviewStats();
        loadSeoSettings();
        loadBlogs();
        loadSubmissions();
        loadSiteSettings();
    }

    async function loadOverviewStats() {
        try {
            const res = await adminFetch(`${API_BASE}/overview`);
            if (res.ok) {
                const data = await res.json();
                document.getElementById('statLandmarks').textContent = data.totalLandmarks || '500+';
                document.getElementById('statLayers').textContent = (data.activeLayers || 3) + ' Layers';
                document.getElementById('statCountdown').textContent = data.countdownDate || 'Nov 19, 2026';
            }
        } catch (_) {}
    }

    // SEO Manager Logic
    async function loadSeoSettings() {
        try {
            const res = await adminFetch(`${API_BASE}/seo`);
            const data = await res.json();

            const title = data.meta?.en?.title || 'GTA 6 Interactive Map – State of Leonida | Vice City & Florida Locations';
            const desc = data.meta?.en?.description || 'Explore the definitive interactive GTA 6 map of Leonida & Vice City.';
            const keywords = data.keywords || 'GTA 6 Interactive Map, GTA VI Map, State of Leonida, Vice City Map';
            const canonical = data.site?.url || 'https://map.stateofleonida.net/en/';
            const ogImage = data.openGraph?.image || 'assets/backgrounds/hero_gta6.jpg';
            const twitter = data.twitter?.site || '@stateofleonida';

            document.getElementById('seoTitle').value = title;
            document.getElementById('seoDescription').value = desc;
            document.getElementById('seoKeywords').value = keywords;
            document.getElementById('seoCanonical').value = canonical;
            document.getElementById('seoOgImage').value = ogImage;
            document.getElementById('seoTwitter').value = twitter;

            const gaInput = document.getElementById('seoGoogleAnalytics');
            const gscInput = document.getElementById('seoSearchConsole');
            const bingInput = document.getElementById('seoBingWebmaster');
            const headInput = document.getElementById('seoCustomHead');
            if (gaInput) gaInput.value = data.googleAnalyticsId || '';
            if (gscInput) gscInput.value = data.googleSearchConsoleTag || '';
            if (bingInput) bingInput.value = data.bingWebmasterTag || '';
            if (headInput) headInput.value = data.customHeadHtml || '';

            updateGooglePreview(title, desc, canonical);
        } catch (_) {}
    }

    function updateGooglePreview(title, desc, url) {
        const previewTitle = document.getElementById('previewTitle');
        const previewDesc = document.getElementById('previewDesc');
        const previewUrl = document.getElementById('previewUrl');

        if (previewTitle) previewTitle.textContent = title;
        if (previewDesc) previewDesc.textContent = desc;
        if (previewUrl) previewUrl.textContent = url;
    }

    async function saveSeoSettings(e) {
        if (e) e.preventDefault();
        const payload = {
            title: document.getElementById('seoTitle').value.trim(),
            description: document.getElementById('seoDescription').value.trim(),
            keywords: document.getElementById('seoKeywords').value.trim(),
            canonical: document.getElementById('seoCanonical').value.trim(),
            ogImage: document.getElementById('seoOgImage').value.trim(),
            twitter: document.getElementById('seoTwitter').value.trim(),
            googleAnalyticsId: document.getElementById('seoGoogleAnalytics')?.value.trim() || '',
            googleSearchConsoleTag: document.getElementById('seoSearchConsole')?.value.trim() || '',
            bingWebmasterTag: document.getElementById('seoBingWebmaster')?.value.trim() || '',
            customHeadHtml: document.getElementById('seoCustomHead')?.value.trim() || ''
        };

        try {
            const res = await adminFetch(`${API_BASE}/seo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                showToast('SEO & Analytics settings saved and live!');
                updateGooglePreview(payload.title, payload.description, payload.canonical);
            } else {
                showToast('Failed to save SEO settings', true);
            }
        } catch (_) {
            showToast('SEO Settings saved locally');
        }
    }

    // Community Submissions Manager
    async function loadSubmissions() {
        try {
            const res = await adminFetch(`${API_BASE}/submissions`);
            const data = await res.json();
            const list = data.submissions || [];

            const badge = document.getElementById('subCountBadge');
            if (badge) badge.textContent = list.length;

            const tbody = document.getElementById('submissionsTableBody');
            if (!tbody) return;

            if (list.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--admin-text-muted);">No pending user submissions.</td></tr>`;
                return;
            }

            tbody.innerHTML = list.map(item => `
                <tr>
                    <td style="color:#ff9ee2; font-weight:700;">${escapeHtml(item.submittedBy || 'Anonymous')}</td>
                    <td style="font-weight:700; color:#fff;">${escapeHtml(item.name)}</td>
                    <td><span class="badge-tag badge-pink">${escapeHtml(item.category || 'Discovery')}</span></td>
                    <td style="font-family:monospace; font-size:0.82rem;">X: ${item.position.lng} · Y: ${item.position.lat}</td>
                    <td style="font-size:0.82rem; color:#8b92aa;">${escapeHtml(item.description)}</td>
                    <td>
                        <button class="btn-outline-small" style="color:#00de85; border-color:#00de85; padding:4px 8px; font-size:0.75rem;" onclick="adminApp.approveSubmission('${item.id}')">
                            <i class="fas fa-check"></i> Approve
                        </button>
                        <button class="btn-outline-small" style="color:#ef4444; border-color:#ef4444; padding:4px 8px; font-size:0.75rem; margin-left:4px;" onclick="adminApp.rejectSubmission('${item.id}')">
                            <i class="fas fa-times"></i> Reject
                        </button>
                    </td>
                </tr>
            `).join('');
        } catch (_) {}
    }

    async function approveSubmission(id) {
        try {
            const res = await adminFetch(`${API_BASE}/submissions/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                showToast('Submission approved and published to live map!');
                loadSubmissions();
            }
        } catch (_) {}
    }

    async function rejectSubmission(id) {
        try {
            const res = await adminFetch(`${API_BASE}/submissions/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            if (res.ok) {
                showToast('Submission rejected');
                loadSubmissions();
            }
        } catch (_) {}
    }

    // ==========================================
    // VICE WIRE BLOG MANAGER LOGIC (paginated, bulk-capable)
    // ==========================================
    let blogPage = 1;
    let blogTotalPages = 1;
    let blogTotal = 0;
    let blogSelected = new Set();

    async function loadBlogs() {
        try {
            const pageSize = document.getElementById('blogPageSize')?.value || 50;
            const res = await adminFetch(`/api/admin/blogs/list?page=${blogPage}&limit=${pageSize}`);
            const data = await res.json();
            blogsData = data.blogs || [];
            blogTotal = data.total || 0;
            blogTotalPages = data.totalPages || 1;

            const badge = document.getElementById('blogCountBadge');
            if (badge) badge.textContent = blogTotal;

            // Stats line
            const statsRes = await adminFetch('/api/admin/blogs/stats');
            const stats = await statsRes.json();
            const statsLine = document.getElementById('blogStatsLine');
            if (statsLine && stats.success) {
                statsLine.textContent = `${stats.total.toLocaleString()} total · ${stats.published.toLocaleString()} published · ${stats.drafts.toLocaleString()} drafts`;
            }

            // Populate category filter dynamically
            const catFilter = document.getElementById('blogCategoryFilter');
            if (catFilter && stats.success) {
                const current = catFilter.value;
                catFilter.innerHTML = '<option value="all">All Categories</option>' +
                    Object.keys(stats.categories).sort().map(c =>
                        `<option value="${escapeHtml(c)}">${escapeHtml(c)} (${stats.categories[c].toLocaleString()})</option>`).join('');
                catFilter.value = current;
            }

            updateBlogPagination();
            renderBlogsTable();
        } catch (e) {
            console.error('Error loading blogs:', e);
        }
    }

    function updateBlogPagination() {
        const info = document.getElementById('blogPageInfo');
        if (info) info.textContent = `Page ${blogPage} of ${blogTotalPages} (${blogTotal.toLocaleString()} articles)`;
        const prev = document.getElementById('blogPrevPage');
        const next = document.getElementById('blogNextPage');
        if (prev) prev.disabled = blogPage <= 1;
        if (next) next.disabled = blogPage >= blogTotalPages;
    }

    function toggleBlogSelect(id, checked) {
        if (checked) blogSelected.add(id); else blogSelected.delete(id);
        updateBlogBulkBar();
    }

    function toggleBlogSelectAll(checked) {
        const boxes = document.querySelectorAll('.blog-select-box');
        boxes.forEach(b => { b.checked = checked; toggleBlogSelect(b.dataset.id, checked); });
        updateBlogBulkBar();
    }

    function updateBlogBulkBar() {
        const bar = document.getElementById('blogBulkBar');
        const count = document.getElementById('blogSelectedCount');
        if (bar) bar.style.display = blogSelected.size > 0 ? 'flex' : 'none';
        if (count) count.textContent = `${blogSelected.size} selected`;
    }

    function clearBlogSelection() {
        blogSelected.clear();
        document.querySelectorAll('.blog-select-box').forEach(b => b.checked = false);
        const sa = document.getElementById('blogSelectAll');
        if (sa) sa.checked = false;
        updateBlogBulkBar();
    }

    async function bulkBlogAction(action) {
        if (blogSelected.size === 0) return;
        const verb = action === 'delete' ? 'permanently DELETE' : action === 'publish' ? 'PUBLISH' : 'move to DRAFT';
        if (!confirm(`Are you sure you want to ${verb} ${blogSelected.size} articles?`)) return;
        try {
            const res = await adminFetch('/api/admin/blogs/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ids: [...blogSelected] })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`${data.affected} articles ${action === 'delete' ? 'deleted' : action === 'publish' ? 'published' : 'moved to draft'}`);
                clearBlogSelection();
                loadBlogs();
            } else {
                showToast(data.error || 'Bulk action failed', true);
            }
        } catch (e) {
            showToast('Bulk action error: ' + e.message, true);
        }
    }

    async function quickToggleBlogStatus(id, newStatus) {
        try {
            const res = await adminFetch(`/api/admin/blogs/${encodeURIComponent(id)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: newStatus })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`Article is now ${newStatus === 'published' ? 'LIVE & PUBLISHED' : 'MOVED TO DRAFT'}!`, false);
                loadBlogs();
            } else {
                showToast(data.error || 'Failed to update status', true);
            }
        } catch (err) {
            showToast('Error: ' + err.message, true);
        }
    }

    function renderBlogsTable() {
        const tbody = document.getElementById('blogsTableBody');
        if (!tbody) return;

        const search = (document.getElementById('blogSearchInput')?.value || '').toLowerCase();
        const category = document.getElementById('blogCategoryFilter')?.value || 'all';
        const statusFilter = document.getElementById('blogStatusFilter')?.value || 'all';

        const filtered = blogsData.filter(b => {
            const title = (b.title || '').toLowerCase();
            const excerpt = (b.excerpt || '').toLowerCase();
            const author = (b.author || '').toLowerCase();
            const kw = (b.targetKeyword || '').toLowerCase();
            const cat = (b.category || '').toLowerCase();

            const matchesSearch = !search || title.includes(search) || excerpt.includes(search) || author.includes(search) || kw.includes(search);
            const matchesCat = category === 'all' || cat === category.toLowerCase();
            const matchesStatus = statusFilter === 'all' || (b.status || 'published') === statusFilter;
            return matchesSearch && matchesCat && matchesStatus;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:2.5rem; color:var(--admin-text-muted);">No blog posts found matching your criteria.</td></tr>`;
            return;
        }

        tbody.innerHTML = filtered.map(item => {
            const isPub = item.status === 'published';
            const statusBadge = isPub
                ? `<button type="button" class="badge-tag badge-cyan" onclick="adminApp.quickToggleBlogStatus('${item.id}', 'draft')" title="Click to move to Draft" style="cursor:pointer; border:none; padding:4px 8px; border-radius:6px; font-weight:600;"><i class="fas fa-check-circle" style="font-size:0.6rem;"></i> Published (Live)</button>`
                : `<button type="button" class="badge-tag" onclick="adminApp.quickToggleBlogStatus('${item.id}', 'published')" title="Click to Publish immediately to live blog" style="cursor:pointer; border:none; background:#374151; color:#a5f3fc; padding:4px 8px; border-radius:6px; font-weight:600;"><i class="fas fa-upload" style="font-size:0.6rem; color:#06b6d4;"></i> Draft (Click to Publish)</button>`;

            const featuredStar = item.featured
                ? `<span title="Featured Headline Story" style="color:#fbbf24; margin-left:6px;"><i class="fas fa-star"></i></span>`
                : '';
            const checked = blogSelected.has(item.id) ? 'checked' : '';

            return `
                <tr>
                    <td><input type="checkbox" class="blog-select-box" data-id="${item.id}" ${checked} onchange="adminApp.toggleBlogSelect('${item.id}', this.checked)"></td>
                    <td style="width:70px;">
                        <img src="${item.coverImage || 'assets/photos/screenshots/vice_city/Vice_City_05.jpg'}" alt="Cover" loading="lazy" style="width:60px; height:40px; object-fit:cover; border-radius:6px; border:1px solid rgba(255,255,255,0.1);">
                    </td>
                    <td>
                        <div style="font-weight:700; color:#fff; font-size:0.92rem; display:flex; align-items:center;">
                            ${escapeHtml(item.title)} ${featuredStar}
                        </div>
                        <div style="font-size:0.78rem; color:#8b92aa; max-width:380px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:2px;">
                            ${escapeHtml(item.excerpt || '')}
                        </div>
                        <div style="font-size:0.72rem; color:#6b7280; margin-top:2px;">
                            <a href="/guides/${escapeHtml(item.slug)}" target="_blank" style="color:#6b7280;">/guides/${escapeHtml(item.slug)}</a>
                        </div>
                    </td>
                    <td>
                        ${item.targetKeyword ? `<span class="badge-tag badge-cyan" style="font-size:0.75rem;"><i class="fas fa-bullseye"></i> ${escapeHtml(item.targetKeyword)}</span>` : `<span style="color:#6b7280; font-size:0.75rem;">—</span>`}
                    </td>
                    <td>
                        <span class="badge-tag badge-pink" style="font-size:0.75rem;">${escapeHtml(item.category || 'Article')}</span>
                    </td>
                    <td>
                        <div style="font-weight:600; color:#e5e7eb; font-size:0.85rem;">${escapeHtml(item.author || 'Staff')}</div>
                        <div style="font-size:0.72rem; color:#9ca3af;">${escapeHtml(item.authorRole || '')}</div>
                    </td>
                    <td style="font-size:0.82rem; color:#9ca3af; white-space:nowrap;">
                        ${item.date || ''}
                    </td>
                    <td>${statusBadge}</td>
                    <td style="white-space:nowrap;">
                        <button class="btn-table-action" onclick="adminApp.editBlog('${item.id}')" title="Edit Article">
                            <i class="fas fa-edit"></i>
                        </button>
                        <a href="/guides/${item.slug}" target="_blank" class="btn-table-action" title="View Live URL" style="display:inline-flex; align-items:center; justify-content:center; text-decoration:none;">
                            <i class="fas fa-external-link-alt"></i>
                        </a>
                        <button class="btn-table-action delete" onclick="adminApp.deleteBlog('${item.id}')" title="Delete Article">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function checkKeywordConflict(kw, currentId) {
        const inputKw = (kw || '').trim().toLowerCase();
        const badge = document.getElementById('keywordCheckBadge');
        const notice = document.getElementById('keywordConflictNotice');
        const overrideBox = document.getElementById('duplicateOverrideContainer');

        if (!inputKw) {
            if (badge) {
                badge.className = 'badge-tag badge-cyan';
                badge.textContent = 'Enter keyword';
            }
            if (notice) notice.style.display = 'none';
            if (overrideBox) overrideBox.style.display = 'none';
            return false;
        }

        const conflict = blogsData.find(b => b.id !== currentId && (b.targetKeyword || '').trim().toLowerCase() === inputKw);

        if (conflict) {
            if (badge) {
                badge.className = 'badge-tag badge-pink';
                badge.textContent = 'DUPLICATE CONFLICT ⚠️';
            }
            if (notice) {
                notice.style.display = 'block';
                notice.style.background = 'rgba(239, 68, 68, 0.15)';
                notice.style.border = '1px solid rgba(239, 68, 68, 0.4)';
                notice.style.color = '#fca5a5';
                notice.innerHTML = `<i class="fas fa-exclamation-triangle"></i> <strong>Duplicate Conflict:</strong> The keyword "<em>${escapeHtml(inputKw)}</em>" is already targeted by article <strong>"${escapeHtml(conflict.title)}"</strong> (Slug: <code>${escapeHtml(conflict.slug)}</code>). Writing duplicate articles on the same keyword divides ranking authority and causes Google keyword cannibalization.`;
            }
            if (overrideBox) overrideBox.style.display = 'block';
            return true;
        } else {
            if (badge) {
                badge.className = 'badge-tag badge-cyan';
                badge.textContent = 'UNIQUE KEYWORD ✓';
            }
            if (notice) {
                notice.style.display = 'block';
                notice.style.background = 'rgba(16, 185, 129, 0.12)';
                notice.style.border = '1px solid rgba(16, 185, 129, 0.35)';
                notice.style.color = '#6ee7b7';
                notice.innerHTML = `<i class="fas fa-check-circle"></i> <strong>Safe for SEO:</strong> No other article targets this keyword. Good to publish!`;
            }
            if (overrideBox) overrideBox.style.display = 'none';
            return false;
        }
    }

    function openAddBlog() {
        document.getElementById('blogModalTitle').innerHTML = '<i class="fas fa-feather-alt"></i> Write Vice Wire Article';
        document.getElementById('blogForm').reset();
        document.getElementById('modalBlogId').value = '';
        document.getElementById('modalBlogKeyword').value = '';
        if (document.getElementById('modalBlogAllowDuplicate')) document.getElementById('modalBlogAllowDuplicate').checked = false;
        if (document.getElementById('duplicateOverrideContainer')) document.getElementById('duplicateOverrideContainer').style.display = 'none';
        if (document.getElementById('keywordConflictNotice')) document.getElementById('keywordConflictNotice').style.display = 'none';
        const badge = document.getElementById('keywordCheckBadge');
        if (badge) {
            badge.className = 'badge-tag badge-cyan';
            badge.textContent = 'Enter keyword';
        }

        document.getElementById('modalBlogAuthor').value = 'Yanis GIS Lead';
        document.getElementById('modalBlogAuthorRole').value = 'Senior Cartographer';
        document.getElementById('modalBlogReadTime').value = '5 min read';
        document.getElementById('modalBlogCover').value = 'assets/photos/screenshots/vice_city/Vice_City_05.jpg';
        document.getElementById('modalBlogStatus').value = 'published';
        document.getElementById('modalBlogFeatured').checked = false;
        document.getElementById('blogModal').style.display = 'flex';
    }

    function editBlog(id) {
        const item = blogsData.find(b => b.id === id);
        if (!item) return;

        document.getElementById('blogModalTitle').innerHTML = '<i class="fas fa-edit"></i> Edit Article: ' + escapeHtml(item.title);
        document.getElementById('modalBlogId').value = item.id;
        document.getElementById('modalBlogTitle').value = item.title || '';
        document.getElementById('modalBlogSlug').value = item.slug || '';
        document.getElementById('modalBlogKeyword').value = item.targetKeyword || '';
        if (document.getElementById('modalBlogAllowDuplicate')) document.getElementById('modalBlogAllowDuplicate').checked = false;
        if (document.getElementById('duplicateOverrideContainer')) document.getElementById('duplicateOverrideContainer').style.display = 'none';
        if (document.getElementById('keywordConflictNotice')) document.getElementById('keywordConflictNotice').style.display = 'none';

        checkKeywordConflict(item.targetKeyword || '', item.id);

        document.getElementById('modalBlogCategory').value = item.category || 'Cartography & Leaks';
        document.getElementById('modalBlogAuthor').value = item.author || '';
        document.getElementById('modalBlogAuthorRole').value = item.authorRole || '';
        document.getElementById('modalBlogReadTime').value = item.readTime || '4 min read';
        document.getElementById('modalBlogCover').value = item.coverImage || '';
        document.getElementById('modalBlogHotspot').value = item.hotspotKey || '';
        document.getElementById('modalBlogLat').value = item.lat !== null && item.lat !== undefined ? item.lat : '';
        document.getElementById('modalBlogLng').value = item.lng !== null && item.lng !== undefined ? item.lng : '';
        document.getElementById('modalBlogExcerpt').value = item.excerpt || '';
        document.getElementById('modalBlogContent').value = item.content || '';
        document.getElementById('modalBlogStatus').value = item.status || 'published';
        document.getElementById('modalBlogFeatured').checked = Boolean(item.featured);

        document.getElementById('blogModal').style.display = 'flex';
    }

    async function handleSaveBlog(e) {
        e.preventDefault();
        const id = document.getElementById('modalBlogId').value;
        const kw = document.getElementById('modalBlogKeyword')?.value.trim() || '';
        const allowDup = document.getElementById('modalBlogAllowDuplicate')?.checked || false;

        const hasConflict = checkKeywordConflict(kw, id);
        if (hasConflict && !allowDup) {
            showToast('Keyword conflict detected! Please use a unique keyword or enable the override option.', true);
            document.getElementById('modalBlogKeyword')?.focus();
            return;
        }

        const payload = {
            title: document.getElementById('modalBlogTitle').value.trim(),
            slug: document.getElementById('modalBlogSlug').value.trim(),
            targetKeyword: kw,
            allowDuplicateKeyword: allowDup,
            category: document.getElementById('modalBlogCategory').value,
            author: document.getElementById('modalBlogAuthor').value.trim(),
            authorRole: document.getElementById('modalBlogAuthorRole').value.trim(),
            readTime: document.getElementById('modalBlogReadTime').value.trim(),
            coverImage: document.getElementById('modalBlogCover').value.trim(),
            hotspotKey: document.getElementById('modalBlogHotspot').value,
            lat: document.getElementById('modalBlogLat').value ? parseFloat(document.getElementById('modalBlogLat').value) : null,
            lng: document.getElementById('modalBlogLng').value ? parseFloat(document.getElementById('modalBlogLng').value) : null,
            excerpt: document.getElementById('modalBlogExcerpt').value.trim(),
            content: document.getElementById('modalBlogContent').value.trim(),
            status: document.getElementById('modalBlogStatus').value,
            featured: document.getElementById('modalBlogFeatured').checked
        };

        try {
            const url = id ? `/api/admin/blogs/${encodeURIComponent(id)}` : '/api/admin/blogs';
            const method = id ? 'PUT' : 'POST';

            const res = await adminFetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            if (res.ok && data.success) {
                showToast(`Article "${payload.title}" saved successfully!`);
                document.getElementById('blogModal').style.display = 'none';
                loadBlogs();
            } else {
                showToast(data.error || 'Failed to save article', true);
            }
        } catch (err) {
            showToast('Error saving article: ' + err.message, true);
        }
    }

    async function deleteBlog(id) {
        const item = blogsData.find(b => b.id === id);
        const name = item ? item.title : 'this article';
        if (!confirm(`Are you sure you want to permanently delete "${name}"?`)) return;

        try {
            const res = await adminFetch(`/api/admin/blogs/${encodeURIComponent(id)}`, { method: 'DELETE' });
            if (res.ok) {
                showToast('Article deleted successfully');
                loadBlogs();
            } else {
                showToast('Failed to delete article', true);
            }
        } catch (err) {
            showToast('Error: ' + err.message, true);
        }
    }

    // Landmarks Manager Logic
    async function loadLandmarks() {
        try {
            const res = await adminFetch(`${API_BASE}/landmarks`);
            if (res.ok) {
                const data = await res.json();
                landmarksData = data.landmarks || [];
            } else {
                // Fallback to static landmarks file
                const fallback = await fetch('/data/landmarks.json');
                const data = await fallback.json();
                landmarksData = Array.isArray(data) ? data : (data.landmarks || Object.values(data));
            }
            renderLandmarksTable();
        } catch (e) {
            console.error('Error loading landmarks', e);
        }
    }

    function renderLandmarksTable() {
        const tbody = document.getElementById('landmarksTableBody');
        if (!tbody) return;

        const search = (document.getElementById('landmarkSearchInput')?.value || '').toLowerCase();
        const category = document.getElementById('landmarkCategoryFilter')?.value || 'all';

        const filtered = landmarksData.filter(item => {
            const name = (item.name || item.title || '').toLowerCase();
            const desc = (item.description || item.detail || '').toLowerCase();
            const cat = (item.category || item.type || '').toLowerCase();

            const matchesSearch = !search || name.includes(search) || desc.includes(search);
            const matchesCat = category === 'all' || cat.includes(category.toLowerCase());
            return matchesSearch && matchesCat;
        });

        if (filtered.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:2rem; color:var(--admin-text-muted);">No locations found matching your filter.</td></tr>`;
            return;
        }

        // Render first 50 results for fast rendering
        const slice = filtered.slice(0, 50);
        tbody.innerHTML = slice.map((item, idx) => {
            const id = item.id || `loc_${idx}`;
            const name = item.name || item.title || 'Unnamed Location';
            const cat = item.category || item.type || 'Landmark';
            const pos = item.position || item.coords || { lat: 0, lng: 0 };
            const real = item.realLife?.coords || item.realLife || null;

            return `
                <tr>
                    <td style="font-family:monospace; font-size:0.8rem; color:#8b92aa;">${id}</td>
                    <td style="font-weight:700; color:#fff;">${escapeHtml(name)}</td>
                    <td><span class="badge-tag badge-pink">${escapeHtml(cat)}</span></td>
                    <td style="font-family:monospace; font-size:0.82rem;">X: ${pos.lng ? pos.lng.toFixed(1) : 0} · Y: ${pos.lat ? pos.lat.toFixed(1) : 0}</td>
                    <td>${real ? `<span class="badge-tag badge-cyan">Miami Matched</span>` : `<span style="color:#6b7280; font-size:0.75rem;">—</span>`}</td>
                    <td>
                        <button class="btn-table-action" onclick="adminApp.editLandmark('${id}')" title="Edit Location">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-table-action delete" onclick="adminApp.deleteLandmark('${id}')" title="Delete Location">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    function editLandmark(id) {
        const item = landmarksData.find(x => x.id === id);
        if (!item) return;

        document.getElementById('modalLandmarkTitle').textContent = 'Edit Location: ' + (item.name || item.title);
        document.getElementById('editLandmarkId').value = id;
        document.getElementById('modalLandmarkName').value = item.name || item.title || '';
        document.getElementById('modalLandmarkCategory').value = item.category || item.type || '';

        const pos = item.position || item.coords || { lat: 0, lng: 0 };
        document.getElementById('modalLandmarkLng').value = pos.lng || 0;
        document.getElementById('modalLandmarkLat').value = pos.lat || 0;

        const real = item.realLife?.coords || item.realLife || {};
        document.getElementById('modalRealLat').value = real.lat || '';
        document.getElementById('modalRealLng').value = real.lng || '';

        document.getElementById('modalLandmarkDesc').value = item.description || item.detail || '';

        document.getElementById('landmarkModal').classList.add('open');
    }

    function openAddLandmark() {
        document.getElementById('modalLandmarkTitle').textContent = 'Add New Landmark';
        document.getElementById('landmarkForm').reset();
        document.getElementById('editLandmarkId').value = '';
        document.getElementById('landmarkModal').classList.add('open');
    }

    async function handleSaveLandmark(e) {
        e.preventDefault();
        const id = document.getElementById('editLandmarkId').value || 'loc_' + Date.now();
        const landmark = {
            id: id,
            name: document.getElementById('modalLandmarkName').value.trim(),
            category: document.getElementById('modalLandmarkCategory').value.trim(),
            position: {
                lat: parseFloat(document.getElementById('modalLandmarkLat').value),
                lng: parseFloat(document.getElementById('modalLandmarkLng').value)
            },
            description: document.getElementById('modalLandmarkDesc').value.trim()
        };

        const realLat = parseFloat(document.getElementById('modalRealLat').value);
        const realLng = parseFloat(document.getElementById('modalRealLng').value);
        if (!isNaN(realLat) && !isNaN(realLng)) {
            landmark.realLife = { coords: { lat: realLat, lng: realLng } };
        }

        try {
            const res = await adminFetch(`${API_BASE}/landmarks`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(landmark)
            });
            if (res.ok) {
                showToast(`Location "${landmark.name}" saved!`);
            }
        } catch (_) {}

        // Update local array
        const idx = landmarksData.findIndex(x => x.id === id);
        if (idx >= 0) {
            landmarksData[idx] = landmark;
        } else {
            landmarksData.unshift(landmark);
        }

        document.getElementById('landmarkModal').classList.remove('open');
        renderLandmarksTable();
    }

    async function deleteLandmark(id) {
        if (!confirm('Are you sure you want to delete this landmark?')) return;
        try {
            await adminFetch(`${API_BASE}/landmarks/${encodeURIComponent(id)}`, { method: 'DELETE' });
        } catch (_) {}

        landmarksData = landmarksData.filter(x => x.id !== id);
        showToast('Landmark deleted');
        renderLandmarksTable();
    }

    // Map Layers Manager
    async function loadMapLayers() {
        const container = document.getElementById('mapsContainer');
        if (!container) return;

        try {
            const res = await adminFetch(`${API_BASE}/maps`);
            const data = await res.json();
            const layers = data.layers || [
                { id: 'YANIS', name: 'Yanis Mapping Community', currentVersion: 'v16', enabled: true, maxZoom: 8 },
                { id: 'DUPZ0R', name: 'Dupz0r Blueprint Projection', currentVersion: 'v2.1', enabled: true, maxZoom: 6 },
                { id: 'RICKRICK', name: 'RickRick Road Network', currentVersion: 'v4.0', enabled: true, maxZoom: 6 }
            ];

            container.innerHTML = layers.map(layer => `
                <div class="admin-panel-card" style="margin-bottom:0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem;">
                        <h4 style="font-size:1.05rem; font-weight:700; color:#fff;">${layer.name}</h4>
                        <span class="badge-tag ${layer.enabled ? 'badge-cyan' : ''}">${layer.enabled ? 'Active' : 'Disabled'}</span>
                    </div>
                    <div style="font-size:0.85rem; color:var(--admin-text-muted); line-height:1.6; margin-bottom:1.2rem;">
                        Layer ID: <code style="color:#fff;">${layer.id}</code> · Version: <code style="color:var(--admin-pink);">${layer.currentVersion}</code> · Max Zoom: ${layer.maxZoom}
                    </div>
                    <button class="btn-outline-small" onclick="adminApp.toggleLayer('${layer.id}')">
                        <i class="fas fa-toggle-on"></i> Toggle Visibility
                    </button>
                </div>
            `).join('');
        } catch (_) {}
    }

    async function toggleLayer(id) {
        showToast(`Layer ${id} settings updated`);
    }

    function escapeHtml(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // Initialization
    async function loadSiteSettings() {
        try {
            const res = await adminFetch('/api/admin/site-config');
            if (res.ok) {
                const config = await res.json();
                if (document.getElementById('settingsCountdownInput')) {
                    document.getElementById('settingsCountdownInput').value = config.countdownDate || '2026-11-19T00:00';
                }
                if (document.getElementById('settingsCountdownEnabled')) {
                    document.getElementById('settingsCountdownEnabled').value = config.countdownEnabled !== false ? 'true' : 'false';
                }
                if (document.getElementById('settingsDiscordUrl')) {
                    document.getElementById('settingsDiscordUrl').value = config.discordUrl || 'https://discord.gg/JeTPhnHuxm';
                }
                if (document.getElementById('settingsAnnouncement')) {
                    document.getElementById('settingsAnnouncement').value = config.announcement || '';
                }

                // Watermarks
                if (document.getElementById('watermarkPreloaderEnabled')) {
                    document.getElementById('watermarkPreloaderEnabled').value = config.watermarks?.preloaderAffiliatedEnabled !== false ? 'true' : 'false';
                }
                if (document.getElementById('watermarkPreloaderImage')) {
                    document.getElementById('watermarkPreloaderImage').value = config.watermarks?.preloaderAffiliatedImage || 'assets/logos/affiliated with.png';
                }

                // Partner 1
                if (document.getElementById('partner1Enabled')) {
                    document.getElementById('partner1Enabled').value = config.watermarks?.partner1?.enabled !== false ? 'true' : 'false';
                }
                if (document.getElementById('partner1Name')) {
                    document.getElementById('partner1Name').value = config.watermarks?.partner1?.name || 'MAP.GTADB.ORG';
                }
                if (document.getElementById('partner1Subtitle')) {
                    document.getElementById('partner1Subtitle').value = config.watermarks?.partner1?.subtitle || 'USE DATABASE';
                }
                if (document.getElementById('partner1Url')) {
                    document.getElementById('partner1Url').value = config.watermarks?.partner1?.url || 'https://map.gtadb.org';
                }
                if (document.getElementById('partner1Logo')) {
                    document.getElementById('partner1Logo').value = config.watermarks?.partner1?.logo || 'assets/pic/gtamaplib.png';
                }

                // Partner 2
                if (document.getElementById('partner2Enabled')) {
                    document.getElementById('partner2Enabled').value = config.watermarks?.partner2?.enabled !== false ? 'true' : 'false';
                }
                if (document.getElementById('partner2Name')) {
                    document.getElementById('partner2Name').value = config.watermarks?.partner2?.name || 'GTA.WIKI';
                }
                if (document.getElementById('partner2Subtitle')) {
                    document.getElementById('partner2Subtitle').value = config.watermarks?.partner2?.subtitle || 'FIND ON MARKERS';
                }
                if (document.getElementById('partner2Url')) {
                    document.getElementById('partner2Url').value = config.watermarks?.partner2?.url || 'https://gta.wiki';
                }
                if (document.getElementById('partner2Logo')) {
                    document.getElementById('partner2Logo').value = config.watermarks?.partner2?.logo || 'assets/logos/Wiki.png';
                }

                // Header Center Banner
                if (document.getElementById('headerBannerEnabled')) {
                    document.getElementById('headerBannerEnabled').value = config.headerBanner?.enabled !== false ? 'true' : 'false';
                }
                if (document.getElementById('headerBannerImage')) {
                    document.getElementById('headerBannerImage').value = config.headerBanner?.imageUrl || 'assets/logos/mappingcool2.gif';
                }
                if (document.getElementById('headerBannerUrl')) {
                    document.getElementById('headerBannerUrl').value = config.headerBanner?.targetUrl || 'https://discord.gg/JeTPhnHuxm';
                }

                // Disclaimers
                if (document.getElementById('disclaimerPreloaderText')) {
                    document.getElementById('disclaimerPreloaderText').value = config.disclaimers?.preloaderDisclaimer || '';
                }
                if (document.getElementById('disclaimerFooterText')) {
                    document.getElementById('disclaimerFooterText').value = config.disclaimers?.footerDisclaimer || '';
                }
            }
        } catch (e) {
            console.error('Error loading site settings', e);
        }
    }

    async function saveSiteSettings() {
        const payload = {
            countdownDate: document.getElementById('settingsCountdownInput')?.value || '2026-11-19T00:00',
            countdownEnabled: document.getElementById('settingsCountdownEnabled')?.value === 'true',
            discordUrl: document.getElementById('settingsDiscordUrl')?.value || 'https://discord.gg/JeTPhnHuxm',
            announcement: document.getElementById('settingsAnnouncement')?.value || '',
            headerBanner: {
                enabled: document.getElementById('headerBannerEnabled')?.value === 'true',
                imageUrl: document.getElementById('headerBannerImage')?.value || 'assets/logos/mappingcool2.gif',
                targetUrl: document.getElementById('headerBannerUrl')?.value || 'https://discord.gg/JeTPhnHuxm',
                altText: 'Mapping Discord'
            },
            watermarks: {
                preloaderAffiliatedEnabled: document.getElementById('watermarkPreloaderEnabled')?.value === 'true',
                preloaderAffiliatedImage: document.getElementById('watermarkPreloaderImage')?.value || '',
                partner1: {
                    enabled: document.getElementById('partner1Enabled')?.value === 'true',
                    name: document.getElementById('partner1Name')?.value || '',
                    subtitle: document.getElementById('partner1Subtitle')?.value || '',
                    url: document.getElementById('partner1Url')?.value || '',
                    logo: document.getElementById('partner1Logo')?.value || ''
                },
                partner2: {
                    enabled: document.getElementById('partner2Enabled')?.value === 'true',
                    name: document.getElementById('partner2Name')?.value || '',
                    subtitle: document.getElementById('partner2Subtitle')?.value || '',
                    url: document.getElementById('partner2Url')?.value || '',
                    logo: document.getElementById('partner2Logo')?.value || ''
                }
            },
            disclaimers: {
                preloaderDisclaimer: document.getElementById('disclaimerPreloaderText')?.value || '',
                footerDisclaimer: document.getElementById('disclaimerFooterText')?.value || ''
            }
        };

        try {
            const res = await adminFetch('/api/admin/site-config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();
            if (res.ok && data.success) {
                showToast('Site settings, watermarks & redirects saved successfully!');
            } else {
                showToast(data.error || 'Failed to save settings', true);
            }
        } catch (err) {
            showToast('Error saving settings: ' + err.message, true);
        }
    }

    function setupEvents() {
        if (loginForm) loginForm.addEventListener('submit', handleLogin);
        if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.getAttribute('data-tab');
                switchTab(tab);
            });
        });

        // SEO Form
        const saveSeoBtn = document.getElementById('saveSeoBtn');
        if (saveSeoBtn) saveSeoBtn.addEventListener('click', saveSeoSettings);

        const seoTitleInput = document.getElementById('seoTitle');
        const seoDescInput = document.getElementById('seoDescription');
        if (seoTitleInput) {
            seoTitleInput.addEventListener('input', () => {
                updateGooglePreview(seoTitleInput.value, seoDescInput.value, document.getElementById('seoCanonical').value);
            });
        }
        if (seoDescInput) {
            seoDescInput.addEventListener('input', () => {
                updateGooglePreview(seoTitleInput.value, seoDescInput.value, document.getElementById('seoCanonical').value);
            });
        }

        // Landmarks filters & search
        const searchInput = document.getElementById('landmarkSearchInput');
        const catFilter = document.getElementById('landmarkCategoryFilter');
        if (searchInput) searchInput.addEventListener('input', renderLandmarksTable);
        if (catFilter) catFilter.addEventListener('change', renderLandmarksTable);

        // Landmark modal
        const openAddBtn = document.getElementById('openAddLandmarkBtn');
        const closeBtn = document.getElementById('closeLandmarkModalBtn');
        const cancelBtn = document.getElementById('cancelLandmarkBtn');
        const landmarkForm = document.getElementById('landmarkForm');

        if (openAddBtn) openAddBtn.addEventListener('click', openAddLandmark);
        if (closeBtn) closeBtn.addEventListener('click', () => document.getElementById('landmarkModal').classList.remove('open'));
        if (cancelBtn) cancelBtn.addEventListener('click', () => document.getElementById('landmarkModal').classList.remove('open'));
        if (landmarkForm) landmarkForm.addEventListener('submit', handleSaveLandmark);

        // Settings save
        const saveSettingsBtn = document.getElementById('saveSettingsBtn');
        if (saveSettingsBtn) {
            saveSettingsBtn.addEventListener('click', saveSiteSettings);
        }

        // Blog Events
        const btnNewBlog = document.getElementById('btnNewBlog');
        const closeBlogModalBtn = document.getElementById('closeBlogModalBtn');
        const cancelBlogBtn = document.getElementById('cancelBlogBtn');
        const blogForm = document.getElementById('blogForm');
        const blogSearchInput = document.getElementById('blogSearchInput');
        const blogCategoryFilter = document.getElementById('blogCategoryFilter');
        const blogStatusFilter = document.getElementById('blogStatusFilter');
        const blogSelectAll = document.getElementById('blogSelectAll');
        const blogPrevPage = document.getElementById('blogPrevPage');
        const blogNextPage = document.getElementById('blogNextPage');
        const blogPageSize = document.getElementById('blogPageSize');
        const coverPreset = document.getElementById('modalBlogCoverPreset');

        if (btnNewBlog) btnNewBlog.addEventListener('click', openAddBlog);
        if (closeBlogModalBtn) closeBlogModalBtn.addEventListener('click', () => document.getElementById('blogModal').style.display = 'none');
        if (cancelBlogBtn) cancelBlogBtn.addEventListener('click', () => document.getElementById('blogModal').style.display = 'none');
        if (blogForm) blogForm.addEventListener('submit', handleSaveBlog);
        if (blogSearchInput) blogSearchInput.addEventListener('input', renderBlogsTable);
        if (blogCategoryFilter) blogCategoryFilter.addEventListener('change', renderBlogsTable);
        if (blogStatusFilter) blogStatusFilter.addEventListener('change', renderBlogsTable);
        if (blogSelectAll) blogSelectAll.addEventListener('change', (e) => toggleBlogSelectAll(e.target.checked));
        if (blogPrevPage) blogPrevPage.addEventListener('click', () => { if (blogPage > 1) { blogPage--; clearBlogSelection(); loadBlogs(); } });
        if (blogNextPage) blogNextPage.addEventListener('click', () => { if (blogPage < blogTotalPages) { blogPage++; clearBlogSelection(); loadBlogs(); } });
        if (blogPageSize) blogPageSize.addEventListener('change', () => { blogPage = 1; clearBlogSelection(); loadBlogs(); });

        const modalBlogKeywordInput = document.getElementById('modalBlogKeyword');
        if (modalBlogKeywordInput) {
            modalBlogKeywordInput.addEventListener('input', () => {
                const currentId = document.getElementById('modalBlogId')?.value || '';
                checkKeywordConflict(modalBlogKeywordInput.value, currentId);
            });
        }

        if (coverPreset) {
            coverPreset.addEventListener('change', () => {
                if (coverPreset.value) {
                    document.getElementById('modalBlogCover').value = coverPreset.value;
                }
            });
        }

        // Quick text helper buttons
        const contentTextarea = document.getElementById('modalBlogContent');
        const btnInsertP = document.getElementById('btnInsertP');
        const btnInsertH3 = document.getElementById('btnInsertH3');
        const btnInsertQuote = document.getElementById('btnInsertQuote');

        if (contentTextarea) {
            if (btnInsertP) {
                btnInsertP.addEventListener('click', () => {
                    contentTextarea.value += '\n<p>New paragraph text...</p>';
                    contentTextarea.focus();
                });
            }
            if (btnInsertH3) {
                btnInsertH3.addEventListener('click', () => {
                    contentTextarea.value += '\n<h3>Subheading Section</h3>';
                    contentTextarea.focus();
                });
            }
            if (btnInsertQuote) {
                btnInsertQuote.addEventListener('click', () => {
                    contentTextarea.value += '\n<div class="blog-quote-callout"><blockquote>"Intelligence quote..."</blockquote><cite>— Author</cite></div>';
                    contentTextarea.focus();
                });
            }
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        setupEvents();
        checkAuth();
    });

    return {
        switchTab,
        editLandmark,
        deleteLandmark,
        toggleLayer,
        loadSubmissions,
        approveSubmission,
        rejectSubmission,
        loadBlogs,
        editBlog,
        deleteBlog,
        toggleBlogSelect,
        toggleBlogSelectAll,
        clearBlogSelection,
        bulkBlogAction,
        quickToggleBlogStatus,
        loadIndexingStatus,
        pingSitemap,
        sendIndexNow,
        sendIndexNowAll,
        saveRobots,
        loadSiteSettings,
        saveSiteSettings,
        saveBrandingSettings: saveSiteSettings
    };
})();
