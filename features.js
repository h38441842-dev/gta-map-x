/**
 * State of Leonida - Advanced Interactive Features Suite
 * 1. GTA 6 vs GTA 5 / RDR2 Map Size Comparison
 * 2. In-Game GPS Route & Distance Calculator
 * 3. Deep-Link Location Sharing
 * 4. Explorer Visited Checklist
 * 5. Vice City Atmosphere Shader Modes
 */

(function() {
    'use strict';

    // State
    let activeCompareOverlay = null;
    let activeRoutePolyline = null;
    let routeStartMarker = null;
    let routeEndMarker = null;
    let currentAtmosphere = 'default';

    // Map size database based on community GIS data
    const MAP_SPECS = {
        gta5: {
            id: 'gta5',
            name: 'GTA V (Los Santos)',
            imageUrl: 'assets/maps/GTAV.svg',
            logoUrl: 'assets/logos/gta5logo.png',
            bounds: [[-3600.698, -5000], [7679.719, 5000]],
            areaKm2: 48.1,
            ratio: '2.6x Smaller than GTA 6'
        },
        gta4: {
            id: 'gta4',
            name: 'GTA IV (Liberty City)',
            imageUrl: 'assets/maps/GTAIV.svg',
            logoUrl: 'assets/logos/gta4logo.png',
            bounds: [[-2500, -5000], [3500, 5000]],
            areaKm2: 16.1,
            ratio: '7.8x Smaller than GTA 6'
        },
        rdr2: {
            id: 'rdr2',
            name: 'Red Dead Redemption 2',
            imageUrl: 'assets/maps/rdr2.png',
            logoUrl: 'assets/logos/rdr2.svg',
            bounds: [[-3100, -5900], [5300, 4400]],
            areaKm2: 75.0,
            ratio: '1.7x Smaller than GTA 6'
        }
    };

    // Landmark Presets for GPS Routing
    const GPS_WAYPOINTS = {
        'ocean-drive': { name: 'Ocean Drive (Vice Beach)', coords: [1409.4, 2803.2] },
        'port-gellhorn': { name: 'Port Gellhorn Industrial Strip', coords: [-2100.0, -8500.0] },
        'airport': { name: 'Vice City International Airport', coords: [-1200.0, 1100.0] },
        'keys': { name: 'Leonida Keys Overseas Highway', coords: [-7800.0, -2100.0] },
        'ambrosia': { name: 'Ambrosia Sugar Mill', coords: [3400.0, -4100.0] },
        'lake-leonida': { name: 'Lake Leonida Swamps', coords: [1100.0, -3200.0] }
    };

    // Checklist Locations
    const CHECKLIST_ITEMS = [
        { id: 'spot_1', name: 'Ocean Drive Art Deco Strip', cat: 'Vice Beach' },
        { id: 'spot_2', name: 'Vice City International Airport', cat: 'Transport' },
        { id: 'spot_3', name: 'Port Gellhorn Industrial Strip', cat: 'Port Gellhorn' },
        { id: 'spot_4', name: 'Leonida Keys Seven Mile Bridge', cat: 'Keys' },
        { id: 'spot_5', name: 'Ambrosia Sugar Mill', cat: 'Industrial' },
        { id: 'spot_6', name: 'Grassrivers Alligator Habitat', cat: 'Wildlife' },
        { id: 'spot_7', name: 'Leaf Links Golf Course', cat: 'Recreation' },
        { id: 'spot_8', name: 'Downtown Vice Financial Towers', cat: 'Downtown' },
        { id: 'spot_9', name: 'Starfish Island Luxury Villas', cat: 'Residential' },
        { id: 'spot_10', name: 'Little Haiti Marketplaces', cat: 'Districts' },
        { id: 'spot_11', name: 'Bayside Marina Harbor', cat: 'Coast' },
        { id: 'spot_12', name: 'Stockade Prison Facility', cat: 'Security' }
    ];

    function getLeafletMap() {
        try {
            if (window.mapManager && typeof window.mapManager.getMap === 'function') {
                const m = window.mapManager.getMap();
                if (m && typeof m.on === 'function' && typeof m.hasLayer === 'function') return m;
            }
            if (window.mapManager && window.mapManager.currentMap && typeof window.mapManager.currentMap.on === 'function') {
                return window.mapManager.currentMap;
            }
            if (window.MapFeatures && typeof window.MapFeatures.getMap === 'function') {
                const m = window.MapFeatures.getMap();
                if (m && typeof m.on === 'function') return m;
            }
        } catch (_) {}
        return null;
    }

    function showToast(msg) {
        let toast = document.getElementById('featureToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'featureToast';
            toast.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#131526;color:#fff;border:1px solid #ff50c5;padding:10px 20px;border-radius:8px;font-size:0.88rem;font-weight:700;z-index:999999;box-shadow:0 8px 30px rgba(0,0,0,0.8);pointer-events:none;transition:opacity 0.3s ease;opacity:0;';
            document.body.appendChild(toast);
        }
        toast.textContent = msg;
        toast.style.opacity = '1';
        setTimeout(() => {
            toast.style.opacity = '0';
        }, 2800);
    }

    /* -------------------------------------------------------------
       1. UI INJECTION: Floating Toolbar & Drawers
       ------------------------------------------------------------- */
    function injectUI() {
        // Floating Toolbar
        const toolbar = document.createElement('div');
        toolbar.className = 'map-features-toolbar';
        toolbar.id = 'mapFeaturesToolbar';
        toolbar.innerHTML = `
            <button class="feature-tool-btn" id="btnToolCompare" title="Compare Map Size (GTA 6 vs GTA 5)">
                <i class="fas fa-layer-group"></i>
                <span>Map Size Compare</span>
            </button>
            <button class="feature-tool-btn" id="btnToolRoute" title="Calculate GPS Distance & Travel Time">
                <i class="fas fa-route"></i>
                <span>GPS Route & Travel</span>
            </button>
            <button class="feature-tool-btn" id="btnToolChecklist" title="Explorer Visited Checklist">
                <i class="fas fa-tasks"></i>
                <span>Checklist (<span id="chklistCount">0</span>)</span>
            </button>
            <button class="feature-tool-btn" id="btnToolAtmosphere" title="Toggle Vice City Atmosphere">
                <i class="fas fa-sun"></i>
                <span id="atmoLabel">Day Mode</span>
            </button>
        `;
        document.body.appendChild(toolbar);

        // Map Size Comparison Drawer
        const compareDrawer = document.createElement('div');
        compareDrawer.className = 'feature-side-drawer';
        compareDrawer.id = 'drawerCompare';
        compareDrawer.innerHTML = `
            <div class="drawer-header">
                <div class="drawer-title">
                    <i class="fas fa-layer-group"></i>
                    <span>Map Size Comparison</span>
                </div>
                <button class="drawer-close-btn" data-close="drawerCompare">&times;</button>
            </div>
            <div class="drawer-body">
                <p style="font-size:0.85rem; color:#8b92aa; line-height:1.5;">
                    Overlay previous Rockstar game maps directly on the State of Leonida to inspect the true geographic scale in real-time.
                </p>

                <div class="compare-selector">
                    <button class="compare-card-btn" data-compare="gta5">
                        <img src="assets/logos/gta5logo.png" alt="GTA V" class="compare-card-logo">
                        <span class="compare-card-name">GTA V</span>
                        <span class="compare-card-size">~48 km² (2.6x Smaller)</span>
                    </button>
                    <button class="compare-card-btn" data-compare="rdr2">
                        <img src="assets/logos/rdr2.svg" alt="RDR2" class="compare-card-logo">
                        <span class="compare-card-name">RDR 2</span>
                        <span class="compare-card-size">~75 km² (1.7x Smaller)</span>
                    </button>
                    <button class="compare-card-btn" data-compare="gta4">
                        <img src="assets/logos/gta4logo.png" alt="GTA IV" class="compare-card-logo">
                        <span class="compare-card-name">GTA IV</span>
                        <span class="compare-card-size">~16 km² (7.8x Smaller)</span>
                    </button>
                    <button class="compare-card-btn" id="btnClearCompare">
                        <i class="fas fa-times-circle" style="font-size:1.4rem; color:#ef4444; margin:4px 0;"></i>
                        <span class="compare-card-name">Hide Overlay</span>
                        <span class="compare-card-size" style="color:#ef4444;">Leonida Only</span>
                    </button>
                </div>

                <div class="compare-stat-banner" id="compareStatBanner" style="display:none;">
                    <div class="compare-stat-title">Scale Comparison Ratio</div>
                    <div class="compare-stat-val" id="compareStatVal">2.6x Smaller</div>
                    <div class="compare-stat-desc" id="compareStatDesc">Leonida is estimated at 125 km² vs GTA 5 at 48 km²</div>
                </div>

                <div id="compareOpacityWrap" style="display:none;">
                    <label style="font-size:0.75rem; text-transform:uppercase; color:#8b92aa; font-weight:700;">Overlay Opacity (<span id="compareOpacityVal">70%</span>)</label>
                    <input type="range" id="compareOpacitySlider" min="20" max="100" value="70" style="width:100%; accent-color:#ff50c5; margin-top:6px;">
                </div>
            </div>
        `;
        document.body.appendChild(compareDrawer);

        // GPS Route Calculator Drawer
        const routeDrawer = document.createElement('div');
        routeDrawer.className = 'feature-side-drawer';
        routeDrawer.id = 'drawerRoute';
        routeDrawer.innerHTML = `
            <div class="drawer-header">
                <div class="drawer-title">
                    <i class="fas fa-route"></i>
                    <span>GPS Route & Travel Time</span>
                </div>
                <button class="drawer-close-btn" data-close="drawerRoute">&times;</button>
            </div>
            <div class="drawer-body">
                <div>
                    <label style="font-size:0.75rem; text-transform:uppercase; color:#8b92aa; font-weight:700; display:block; margin-bottom:6px;">Start Location (Point A)</label>
                    <select id="routeSelectA" class="route-preset-select">
                        <option value="ocean-drive">Ocean Drive (Vice Beach)</option>
                        <option value="airport">Vice City International Airport</option>
                        <option value="port-gellhorn">Port Gellhorn Industrial Strip</option>
                        <option value="ambrosia">Ambrosia Sugar Mill</option>
                        <option value="keys">Leonida Keys Highway</option>
                        <option value="lake-leonida">Lake Leonida Swamps</option>
                    </select>
                </div>

                <div>
                    <label style="font-size:0.75rem; text-transform:uppercase; color:#8b92aa; font-weight:700; display:block; margin-bottom:6px;">Destination (Point B)</label>
                    <select id="routeSelectB" class="route-preset-select">
                        <option value="port-gellhorn">Port Gellhorn Industrial Strip</option>
                        <option value="ocean-drive">Ocean Drive (Vice Beach)</option>
                        <option value="airport">Vice City International Airport</option>
                        <option value="ambrosia">Ambrosia Sugar Mill</option>
                        <option value="keys">Leonida Keys Highway</option>
                        <option value="lake-leonida">Lake Leonida Swamps</option>
                    </select>
                </div>

                <div class="route-results-grid">
                    <div class="route-res-card">
                        <div class="route-res-icon">🏎️</div>
                        <div class="route-res-title">Supercar (220 km/h)</div>
                        <div class="route-res-val" id="resSupercar">--</div>
                    </div>
                    <div class="route-res-card">
                        <div class="route-res-icon">🚁</div>
                        <div class="route-res-title">Helicopter (190 km/h)</div>
                        <div class="route-res-val" id="resHeli">--</div>
                    </div>
                    <div class="route-res-card">
                        <div class="route-res-icon">📏</div>
                        <div class="route-res-title">Total Distance</div>
                        <div class="route-res-val" id="resDistance">--</div>
                    </div>
                    <div class="route-res-card">
                        <div class="route-res-icon">🚶</div>
                        <div class="route-res-title">On Foot (5 km/h)</div>
                        <div class="route-res-val" id="resFoot">--</div>
                    </div>
                </div>

                <div style="display:flex; gap:10px; margin-top:8px;">
                    <button id="btnCalculateRoute" class="feature-tool-btn" style="flex:1; justify-content:center; background:#ff50c5; color:#fff;">
                        <i class="fas fa-play"></i> Draw Neon Route
                    </button>
                    <button id="btnClearRoute" class="feature-tool-btn" style="justify-content:center;">
                        <i class="fas fa-trash-alt"></i> Clear
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(routeDrawer);

        // Checklist Drawer
        const chkDrawer = document.createElement('div');
        chkDrawer.className = 'feature-side-drawer';
        chkDrawer.id = 'drawerChecklist';
        chkDrawer.innerHTML = `
            <div class="drawer-header">
                <div class="drawer-title">
                    <i class="fas fa-clipboard-check"></i>
                    <span>Explorer Visited Tracker</span>
                </div>
                <button class="drawer-close-btn" data-close="drawerChecklist">&times;</button>
            </div>
            <div class="drawer-body">
                <div>
                    <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:700;">
                        <span>Progress</span>
                        <span id="chklistPercent">0%</span>
                    </div>
                    <div class="checklist-progress-bar">
                        <div class="checklist-progress-fill" id="chklistFill" style="width:0%;"></div>
                    </div>
                </div>

                <div id="checklistItemsContainer" style="display:flex; flex-direction:column; gap:8px;">
                    <!-- Items rendered here -->
                </div>
            </div>
        `;
        document.body.appendChild(chkDrawer);

        setupEventListeners();
        renderChecklist();
        checkUrlDeepLink();
    }

    /* -------------------------------------------------------------
       2. EVENT LISTENERS
       ------------------------------------------------------------- */
    function setupEventListeners() {
        // Toggle Drawers
        document.getElementById('btnToolCompare').addEventListener('click', () => toggleDrawer('drawerCompare'));
        document.getElementById('btnToolRoute').addEventListener('click', () => {
            toggleDrawer('drawerRoute');
            calculateRoute();
        });
        document.getElementById('btnToolChecklist').addEventListener('click', () => toggleDrawer('drawerChecklist'));

        // Close Drawers
        document.querySelectorAll('.drawer-close-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-close');
                document.getElementById(id).classList.remove('open');
            });
        });

        // Atmosphere Switcher
        document.getElementById('btnToolAtmosphere').addEventListener('click', toggleAtmosphere);

        // Compare Cards
        document.querySelectorAll('.compare-card-btn[data-compare]').forEach(btn => {
            btn.addEventListener('click', () => {
                const mapId = btn.getAttribute('data-compare');
                setComparisonOverlay(mapId);
            });
        });
        document.getElementById('btnClearCompare').addEventListener('click', clearComparisonOverlay);

        // Opacity Slider
        const slider = document.getElementById('compareOpacitySlider');
        if (slider) {
            slider.addEventListener('input', (e) => {
                const val = e.target.value;
                document.getElementById('compareOpacityVal').textContent = val + '%';
                if (activeCompareOverlay) {
                    activeCompareOverlay.setOpacity(val / 100);
                }
            });
        }

        // Route actions
        document.getElementById('btnCalculateRoute').addEventListener('click', calculateRoute);
        document.getElementById('btnClearRoute').addEventListener('click', clearRoute);
        document.getElementById('routeSelectA').addEventListener('change', calculateRoute);
        document.getElementById('routeSelectB').addEventListener('change', calculateRoute);

        // Deep Link Click listener on Map
        function tryAttachMapListener() {
            const map = getLeafletMap();
            if (map && typeof map.on === 'function') {
                try {
                    map.on('contextmenu', (e) => {
                        if (!e || !e.latlng) return;
                        const lat = e.latlng.lat.toFixed(1);
                        const lng = e.latlng.lng.toFixed(1);
                        const shareUrl = `${window.location.origin}/?x=${lng}&y=${lat}&zoom=5`;
                        navigator.clipboard?.writeText(shareUrl);
                        showToast(`📍 Location Link Copied! (X: ${lng}, Y: ${lat})`);
                    });
                } catch (_) {}
            } else {
                setTimeout(tryAttachMapListener, 500);
            }
        }
        tryAttachMapListener();
    }

    function toggleDrawer(id) {
        const target = document.getElementById(id);
        const isOpen = target.classList.contains('open');
        document.querySelectorAll('.feature-side-drawer').forEach(d => d.classList.remove('open'));
        if (!isOpen) {
            target.classList.add('open');
        }
    }

    /* -------------------------------------------------------------
       3. MAP SIZE COMPARISON OVERLAY
       ------------------------------------------------------------- */
    function setComparisonOverlay(mapKey) {
        const spec = MAP_SPECS[mapKey];
        const map = getLeafletMap();
        if (!spec || !map) return;

        clearComparisonOverlay();

        activeCompareOverlay = L.imageOverlay(spec.imageUrl, spec.bounds, {
            opacity: 0.7,
            interactive: false
        }).addTo(map);

        document.querySelectorAll('.compare-card-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.querySelector(`.compare-card-btn[data-compare="${mapKey}"]`);
        if (activeBtn) activeBtn.classList.add('active');

        document.getElementById('compareStatBanner').style.display = 'block';
        document.getElementById('compareOpacityWrap').style.display = 'block';
        document.getElementById('compareStatVal').textContent = spec.ratio;
        document.getElementById('compareStatDesc').textContent = `Leonida (~125 km²) vs ${spec.name} (~${spec.areaKm2} km²)`;

        map.fitBounds(spec.bounds, { animate: true, padding: [40, 40] });
        showToast(`${spec.name} overlay activated`);
    }

    function clearComparisonOverlay() {
        const map = getLeafletMap();
        if (activeCompareOverlay && map) {
            map.removeLayer(activeCompareOverlay);
            activeCompareOverlay = null;
        }
        document.querySelectorAll('.compare-card-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('compareStatBanner').style.display = 'none';
        document.getElementById('compareOpacityWrap').style.display = 'none';
    }

    /* -------------------------------------------------------------
       4. GPS ROUTE & DISTANCE CALCULATOR
       ------------------------------------------------------------- */
    function calculateRoute() {
        const keyA = document.getElementById('routeSelectA').value;
        const keyB = document.getElementById('routeSelectB').value;

        const spotA = GPS_WAYPOINTS[keyA];
        const spotB = GPS_WAYPOINTS[keyB];
        const map = getLeafletMap();

        if (!spotA || !spotB || !map) return;

        // Clean previous route
        clearRoute();

        const [latA, lngA] = spotA.coords;
        const [latB, lngB] = spotB.coords;

        // Euclidean in-game distance calculation
        // 1 in-game coordinate unit is approximately 1.25 meters based on community cartography
        const dx = (lngB - lngA);
        const dy = (latB - latA);
        const rawUnits = Math.sqrt(dx * dx + dy * dy);
        const distanceKm = (rawUnits * 1.25 / 1000).toFixed(1);
        const distanceMiles = (distanceKm * 0.621371).toFixed(1);

        // Travel times
        const distNum = parseFloat(distanceKm);
        const timeSupercarSec = Math.round((distNum / 220) * 3600);
        const timeHeliSec = Math.round((distNum / 190) * 3600);
        const timeFootMin = Math.round((distNum / 5) * 60);

        function formatSec(s) {
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
        }

        document.getElementById('resDistance').textContent = `${distanceKm} km (${distanceMiles} mi)`;
        document.getElementById('resSupercar').textContent = formatSec(timeSupercarSec);
        document.getElementById('resHeli').textContent = formatSec(timeHeliSec);
        document.getElementById('resFoot').textContent = timeFootMin > 60 ? `${Math.floor(timeFootMin/60)}h ${timeFootMin%60}m` : `${timeFootMin}m`;

        // Draw animated neon polyline on map
        activeRoutePolyline = L.polyline([[latA, lngA], [latB, lngB]], {
            color: '#ff50c5',
            weight: 5,
            opacity: 0.9,
            dashArray: '10, 10'
        }).addTo(map);

        // Draw start and end beacon pins
        const iconA = L.divIcon({ className: 'pulse-beacon', iconSize: [20, 20] });
        const iconB = L.divIcon({ className: 'pulse-beacon', iconSize: [20, 20] });

        routeStartMarker = L.marker([latA, lngA], { icon: iconA }).addTo(map).bindPopup(`<b>Start:</b> ${spotA.name}`);
        routeEndMarker = L.marker([latB, lngB], { icon: iconB }).addTo(map).bindPopup(`<b>Destination:</b> ${spotB.name}`);

        map.fitBounds(activeRoutePolyline.getBounds(), { padding: [60, 60], animate: true });
        showToast(`Route calculated: ${distanceKm} km`);
    }

    function clearRoute() {
        const map = getLeafletMap();
        if (map) {
            if (activeRoutePolyline) map.removeLayer(activeRoutePolyline);
            if (routeStartMarker) map.removeLayer(routeStartMarker);
            if (routeEndMarker) map.removeLayer(routeEndMarker);
        }
        activeRoutePolyline = null;
        routeStartMarker = null;
        routeEndMarker = null;
    }

    /* -------------------------------------------------------------
       5. EXPLORER CHECKLIST TRACKER
       ------------------------------------------------------------- */
    function getVisitedSpots() {
        try {
            return JSON.parse(localStorage.getItem('leonida_visited_spots') || '[]');
        } catch (_) {
            return [];
        }
    }

    function toggleSpotVisited(id) {
        let visited = getVisitedSpots();
        if (visited.includes(id)) {
            visited = visited.filter(x => x !== id);
        } else {
            visited.push(id);
        }
        localStorage.setItem('leonida_visited_spots', JSON.stringify(visited));
        renderChecklist();
    }

    function renderChecklist() {
        const container = document.getElementById('checklistItemsContainer');
        if (!container) return;

        const visited = getVisitedSpots();
        const count = visited.length;
        const total = CHECKLIST_ITEMS.length;
        const pct = Math.round((count / total) * 100);

        document.getElementById('chklistCount').textContent = `${count}/${total}`;
        document.getElementById('chklistPercent').textContent = `${pct}%`;
        document.getElementById('chklistFill').style.width = `${pct}%`;

        container.innerHTML = CHECKLIST_ITEMS.map(item => {
            const isDone = visited.includes(item.id);
            return `
                <div class="checklist-item ${isDone ? 'visited' : ''}" onclick="window.LeonidaFeatures.toggleSpot('${item.id}')">
                    <input type="checkbox" class="checklist-checkbox" ${isDone ? 'checked' : ''} onclick="event.stopPropagation(); window.LeonidaFeatures.toggleSpot('${item.id}')">
                    <span class="checklist-text">${item.name}</span>
                    <span style="font-size:0.7rem; color:#8b92aa;">${item.cat}</span>
                </div>
            `;
        }).join('');
    }

    /* -------------------------------------------------------------
       6. ATMOSPHERE LIGHTING MODES
       ------------------------------------------------------------- */
    function toggleAtmosphere() {
        const body = document.body;
        const label = document.getElementById('atmoLabel');

        if (currentAtmosphere === 'default') {
            currentAtmosphere = 'sunset';
            body.classList.remove('map-atmosphere-night');
            body.classList.add('map-atmosphere-sunset');
            label.textContent = 'Sunset Glow';
            showToast('🌅 Vice City Sunset Mode Activated');
        } else if (currentAtmosphere === 'sunset') {
            currentAtmosphere = 'night';
            body.classList.remove('map-atmosphere-sunset');
            body.classList.add('map-atmosphere-night');
            label.textContent = 'Neon Midnight';
            showToast('🌃 Neon Midnight Mode Activated');
        } else {
            currentAtmosphere = 'default';
            body.classList.remove('map-atmosphere-sunset');
            body.classList.remove('map-atmosphere-night');
            label.textContent = 'Day Mode';
            showToast('☀️ Clear Daylight Restored');
        }
    }

    /* -------------------------------------------------------------
       7. DEEP LINK HANDLER (?x=...&y=...&zoom=...)
       ------------------------------------------------------------- */
    function checkUrlDeepLink() {
        const params = new URLSearchParams(window.location.search);
        const x = parseFloat(params.get('x'));
        const y = parseFloat(params.get('y'));
        const zoom = parseInt(params.get('zoom')) || 5;

        if (!isNaN(x) && !isNaN(y)) {
            setTimeout(() => {
                // If on landing, open map
                if (window.GTALanding && typeof window.GTALanding.openMap === 'function') {
                    window.GTALanding.openMap();
                }

                const map = getLeafletMap();
                if (map) {
                    map.setView([y, x], zoom, { animate: true });
                    const beacon = L.divIcon({ className: 'pulse-beacon', iconSize: [24, 24] });
                    L.marker([y, x], { icon: beacon }).addTo(map).bindPopup(`<b>Shared Location:</b> X: ${x}, Y: ${y}`).openPopup();
                    showToast(`Panned to shared coordinates: X: ${x}, Y: ${y}`);
                }
            }, 600);
        }
    }

    // Initialize when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectUI);
    } else {
        injectUI();
    }

    // Expose helpers globally
    window.LeonidaFeatures = {
        toggleSpot: toggleSpotVisited,
        setCompare: setComparisonOverlay,
        clearCompare: clearComparisonOverlay
    };
})();
