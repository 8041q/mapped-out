// main.js — Hash-routed multi-map loader for GitHub Pages.
// Flow: read window.location.hash, lookup MAP_CATALOG, show landing or load SVG.
// Map-specific data (hotspots, colors, geo bounds) comes from the catalog entry.

// Global error handlers
window.addEventListener('error', function (ev) { try { console.error('map:error', ev.message || ev.error || ev); } catch (e) { } });
window.addEventListener('unhandledrejection', function (ev) { try { console.error('map:unhandledrejection', ev.reason || ev); } catch (e) { } });

// Module-level state (reset on each map load)
let _svg = null;           // d3 selection of <svg>
let _states = null;        // d3 selection of province paths
let _tooltip = null;       // tooltip <div>
let _popup = null;         // popup <div>
let _activeHotspot = null;
let _popupHovered = false;
let _popupPending = false;
let _hotspotPinned = false;  // true after clicking a single hotspot — keeps popup open on mouseleave
let _popupLastEvent = null;
let _popupRectCached = null;
let _hotspotBaseRadiusVB = null;
let _hotspotBaseStrokeVB = null;
let _hotspotBaseStrokePx = null;
let _hotspotFullVBWidth = 1;
let _stateBaseStrokeVB = null;
let _abortController = null;   // to cancel listeners on teardown
let _zoomState = null;         // closure state for zoom/pan IIFE
let _hotspotsInitialized = false;

// Landing page: build card grid from MAP_CATALOG
function showLanding() {
    teardownMap();
    document.title = 'Map Projects';
    const landing = document.getElementById('landing');
    const mapArea = document.querySelector('.map-area');
    if (mapArea) mapArea.style.visibility = 'hidden';
    if (!landing) return;
    landing.style.display = '';

    landing.innerHTML = '';
    const heading = document.createElement('h1');
    heading.className = 'landing-heading';
    heading.textContent = 'SAIKANG Medical Projects - Map';
    landing.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'landing-grid';

    Object.keys(MAP_CATALOG).forEach(slug => {
        const entry = MAP_CATALOG[slug];
        const card = document.createElement('a');
        card.className = 'landing-card';
        card.href = '#' + slug;

        const thumb = document.createElement('div');
        thumb.className = 'landing-card-thumb';
        const img = document.createElement('img');
        img.src = entry.thumbnail || entry.svgUrl;
        img.alt = entry.title;
        img.loading = 'lazy';
        thumb.appendChild(img);

        const body = document.createElement('div');
        body.className = 'landing-card-body';
        const title = document.createElement('h2');
        title.textContent = entry.title;
        const desc = document.createElement('p');
        desc.textContent = entry.description || '';
        body.appendChild(title);
        body.appendChild(desc);

        card.appendChild(thumb);
        card.appendChild(body);
        grid.appendChild(card);
    });
    landing.appendChild(grid);
}

// Teardown: remove listeners, layers and reset state from previous map
function teardownMap() {
    // Abort any AbortController-registered listeners
    if (_abortController) { try { _abortController.abort(); } catch (e) { } _abortController = null; }

    // Remove tooltip & popup elements
    if (_tooltip) { try { _tooltip.remove(); } catch (e) { } _tooltip = null; }
    if (_popup) { try { _popup.remove(); } catch (e) { } _popup = null; }

    // Empty the map container
    const mapDiv = document.getElementById('map');
    if (mapDiv) mapDiv.innerHTML = '';

    // Reset state
    _svg = null; _states = null; _activeHotspot = null;
    _popupHovered = false; _popupPending = false; _hotspotPinned = false; _popupLastEvent = null; _popupRectCached = null;
    _hotspotBaseRadiusVB = null; _hotspotBaseStrokeVB = null;
    _hotspotBaseStrokePx = null; _hotspotFullVBWidth = 1;
    _stateBaseStrokeVB = null; _zoomState = null;
    _hotspotsInitialized = false;

    // Clear meta area
    const metaTitle = document.querySelector('.map-meta h1');
    if (metaTitle) metaTitle.textContent = '';
    const metaLogo = document.querySelector('.map-meta img');
    if (metaLogo) { metaLogo.src = ''; metaLogo.alt = ''; }
    const searchInput = document.getElementById('map-search');
    if (searchInput) searchInput.value = '';
    const sugg = document.getElementById('map-search-suggestions');
    if (sugg) { sugg.innerHTML = ''; sugg.setAttribute('aria-hidden', 'true'); }
}

// loadMap: fetch SVG, inject and initialise interactions
async function loadMap(slug) {
    const entry = MAP_CATALOG[slug];
    if (!entry) { showLanding(); return; }

    teardownMap();
    _abortController = new AbortController();
    const signal = _abortController.signal;

    // Hide landing, show map area
    const landing = document.getElementById('landing');
    const mapArea = document.querySelector('.map-area');
    if (landing) landing.style.display = 'none';
    if (mapArea) {
        mapArea.style.display = '';       // only once at startup
        mapArea.style.visibility = 'visible';
    }

    // Populate meta
    document.title = entry.title;
    const metaTitle = document.querySelector('.map-meta h1');
    if (metaTitle) metaTitle.textContent = entry.title;
    const metaLogo = document.querySelector('.map-meta img');
    if (metaLogo) { metaLogo.src = entry.logoUrl || ''; metaLogo.alt = entry.logoAlt || ''; }

    // Show back link
    const backLink = document.getElementById('back-link');
    if (backLink) backLink.style.display = '';

    // Fetch and inject SVG
    const mapDiv = document.getElementById('map');
    try {
        const resp = await fetch(entry.svgUrl);
        if (!resp.ok) throw new Error('SVG fetch failed: ' + resp.status);
        const svgText = await resp.text();
        mapDiv.innerHTML = svgText;
    } catch (err) {
        mapDiv.innerHTML = '<p style="color:red;padding:20px;">Failed to load map SVG.</p>';
        console.error('loadMap:fetch', err);
        return;
    }

    // Wait for SVG to be in DOM
    await new Promise(r => requestAnimationFrame(r));

    const svgEl = mapDiv.querySelector('svg');
    if (!svgEl) { console.error('No <svg> in loaded content'); return; }

    const svg = d3.select(svgEl);
    _svg = svg;

    // Hide text labels immediately to avoid them appearing in the corner
    svg.selectAll('text').style('display', 'none');

    // Gather provinces/states – anything with class="state" or id starting with state prefix
    const stateSelector = '.state, [id^="TH-"], [id^="VN-"], [id^="MY-"], path[id]';
    const states = svg.selectAll(stateSelector).filter(function () {
        const el = d3.select(this);
        const id = el.attr('id');
        return id && id.trim().length > 0;
    });
    _states = states;

    if (states.empty()) {
        console.warn('No provinces/states found in SVG. Selector used:', stateSelector);
    } else {
        console.log(`Found ${states.size()} provinces/states`);
    }

    // Build tooltip
    _tooltip = d3.select('body').append('div').attr('class', 'tooltip').style('opacity', 0);

    // Build popup
    _popup = d3.select('body').append('div').attr('class', 'popup');
    _popup
        .on('mouseenter', () => { _popupHovered = true; })
        .on('mouseleave', () => { _popupHovered = false; hidePopup(); });

    // Store the initial viewBox to calculate scaling; create one if missing
    let vbAttr = svg.attr('viewBox');
    
    // If no viewBox, try creating one from SVG dimensions or bbox
    if (!vbAttr) {
        console.log('Creating viewBox for SVG...');
        try {
            const width = svg.attr('width');
            const height = svg.attr('height');
            
            if (width && height) {
                const w = parseFloat(width);
                const h = parseFloat(height);
                if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                    vbAttr = `0 0 ${w} ${h}`;
                    svg.attr('viewBox', vbAttr);
                }
            }
            
            // Try bbox if width/height didn't work
            if (!vbAttr) {
                const bbox = svgEl.getBBox();
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                    vbAttr = `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
                    svg.attr('viewBox', vbAttr);
                }
            }
        } catch (err) {
            console.error('Failed to create viewBox:', err);
        }
    }
    
    if (vbAttr) {
        const parts = vbAttr.split(/\s+/).map(parseFloat);
        if (parts.length === 4) {
            _hotspotFullVBWidth = parts[2]; // Store the full viewBox width
        }
    }

    // Assign base colors to provinces
    assignColors(svg, states, entry.colorConfig || {});

    // Initialize hotspots from catalog
    initHotspots(svg, states, entry.hotspots || [], _tooltip, _popup, signal);

    // Ensure hotspot sizes are adjusted to current viewBox/scale
    requestAnimationFrame(() => {
        adjustHotspots();
        setTimeout(() => adjustHotspots(), 100);
    });

    // Initialize zoom/pan handlers
    initZoom(svg, signal);

    // Province hover interactions (tooltips, hover styling)
    initProvinceInteractions(states, _tooltip, _popup, signal);

    // Search box initialization
    initSearch(svg, states, _tooltip, _popup, signal);

    // Close popup when clicking background (not on hotspots)
    svg.on('click', function(event) {
        const target = event.target;
        if (!target || (!target.classList.contains('hotspot') && !target.closest('.hotspot'))) {
            hidePopup();
        }
    });

    console.log('Map loaded:', entry.title);
}

// assignColors: fill provinces with HSL gradient
function assignColors(svg, states, colorConfig) {
    if (!states || states.empty()) return;

    const { baseHue = 175, sat = '50%', minLight = 75, maxLight = 85 } = colorConfig;

    // Small deterministic per-index jitter for visual variation
    function computeJitter(i){
        const hueJ = ((i * 97) % 21) - 10;
        const satJ = ((i * 67) % 11) - 5;
        const lightJ = ((i * 53) % 5) - 2;
        return {hueJ, satJ, lightJ};
    }

    // Detect geo viewBox metadata if present (mapsvg:geoViewBox)
    const geoAttr = svg.attr('mapsvg:geoViewBox') || (svg.node() && svg.node().getAttribute('mapsvg:geoViewBox'));
    const vbArr = (svg.attr('viewBox') || svg.attr('viewbox') || '0 0 1 1').split(/\s+/).map(Number);
    const vbW = vbArr[2] || +svg.attr('width') || 1;
    const vbH = vbArr[3] || +svg.attr('height') || 1;
    let geo = null;
    if (geoAttr) {
        const parts = geoAttr.trim().split(/\s+/).map(Number);
        if (parts.length === 4 && parts.every(n => !Number.isNaN(n))) {
            geo = { minLon: parts[0], maxLat: parts[1], maxLon: parts[2], minLat: parts[3] };
            geo.latSpan = geo.maxLat - geo.minLat;
        }
    }

    const stateCount = states.size();

    states.each(function(d, i) {
        const el = d3.select(this);

        if (!geo) {
            const t = stateCount > 1 ? (i / (stateCount - 1)) : 0;
            const j = computeJitter(i);
            const hue = baseHue + j.hueJ;
            const satNum = parseFloat(String(sat).replace('%','')) || 50;
            const satVal = Math.max(20, Math.min(80, Math.round(satNum + j.satJ))) + '%';
            const light = Math.round(minLight + (maxLight - minLight) * t + j.lightJ);
            const fill = `hsl(${hue}, ${satVal}, ${light}%)`;
            el.attr('data-base-fill', fill);
            el.attr('fill', fill);
            if (!el.attr('stroke')) el.attr('stroke', '#fff');
            if (!el.attr('stroke-width')) el.attr('stroke-width', '0.4');
            return;
        }

        // If geo is present, compute centroid-based latitude for gradient
        let cx = 0, cy = 0;
        try {
            const bb = this.getBBox();
            cx = bb.x + bb.width / 2;
            cy = bb.y + bb.height / 2;
        } catch (e) {
            // Fallback to index-based gradient with jitter
            const t = stateCount > 1 ? (i / (stateCount - 1)) : 0;
            const j = computeJitter(i);
            const hue = baseHue + j.hueJ;
            const satNum = parseFloat(String(sat).replace('%','')) || 50;
            const satVal = Math.max(20, Math.min(80, Math.round(satNum + j.satJ))) + '%';
            const light = Math.round(minLight + (maxLight - minLight) * t + j.lightJ);
            const fill = `hsl(${hue}, ${satVal}, ${light}%)`;
            el.attr('data-base-fill', fill);
            el.attr('fill', fill);
            if (!el.attr('stroke')) el.attr('stroke', '#fff');
            if (!el.attr('stroke-width')) el.attr('stroke-width', '0.4');
            return;
        }

        const latSpan = geo.latSpan || 1;
        const lat = geo.maxLat - (cy * (latSpan / vbH));
        let score = (lat - geo.minLat) / (latSpan || 1);
        score = Math.max(0, Math.min(1, score));
        score = Math.pow(score, 1.35);

        const jitter = ((i * 37) % 9) - 4;
        const hue = baseHue + jitter;

        const light = Math.round(maxLight - score * (maxLight - minLight));
        const fill = `hsl(${hue}, ${sat}, ${light}%)`;
        el.attr('data-base-fill', fill);
        el.attr('fill', fill);
        if (!el.attr('stroke')) el.attr('stroke', '#fff');
        if (!el.attr('stroke-width')) el.attr('stroke-width', '0.4');
    });
}

// initProvinceInteractions: province tooltip & hover behavior
function initProvinceInteractions(states, tooltip, popup, signal) {
    if (!states || states.empty()) return;

    states
        .style('cursor', 'pointer')
        .on('mousemove', function (event) {
            const name = d3.select(this).attr('data-name') || 
                        d3.select(this).attr('title') || 
                        d3.select(this).attr('id') || 'Province';
            tooltip
                .text(name)
                .style('left', (event.pageX + 14) + 'px')
                .style('top', (event.pageY - 28) + 'px')
                .style('opacity', 1);
        })
        .on('mouseenter', function (event) {
            const el = d3.select(this);
            const name = el.attr('data-name') || el.attr('title') || el.attr('id') || 'Province';
            
            // Darken fill on hover using stored base color
            const baseFill = el.attr('data-base-fill');
            if (baseFill) {
                // Parse HSL and darken the lightness
                const hslMatch = baseFill.match(/hsl\((\d+),\s*([\d.]+)%,\s*([\d.]+)%\)/);
                if (hslMatch) {
                    const h = hslMatch[1];
                    const s = hslMatch[2];
                    const l = parseFloat(hslMatch[3]);
                    const darkerL = Math.max(l - 10, 0); // Darken by 10%
                    el.attr('fill', `hsl(${h}, ${s}%, ${darkerL}%)`);
                }
            }

            tooltip.text(name).style('opacity', 1);
        })
        
        .on('mouseleave', function () {
            const el = d3.select(this);
            
            // Restore original base color on mouse leave
            const baseFill = el.attr('data-base-fill');
            if (baseFill) {
                el.attr('fill', baseFill);
            }
            
            tooltip.style('opacity', 0);
        });
}

// Proximity threshold (SVG viewBox units) — hotspots within this distance are merged into a cluster
const CLUSTER_THRESHOLD_VB = 9;

// clusterHotspots: group nearby hotspots into cluster objects using greedy proximity
function clusterHotspots(hotspots, threshold) {
    const used = new Set();
    const result = [];
    for (let i = 0; i < hotspots.length; i++) {
        if (used.has(i)) continue;
        const root = hotspots[i];
        const members = [root];
        used.add(i);
        for (let j = i + 1; j < hotspots.length; j++) {
            if (used.has(j)) continue;
            const dx = root.x - hotspots[j].x;
            const dy = root.y - hotspots[j].y;
            if (Math.sqrt(dx * dx + dy * dy) <= threshold) {
                members.push(hotspots[j]);
                used.add(j);
            }
        }
        if (members.length === 1) {
            result.push({ type: 'single', data: members[0] });
        } else {
            const cx = members.reduce((s, m) => s + m.x, 0) / members.length;
            const cy = members.reduce((s, m) => s + m.y, 0) / members.length;
            result.push({ type: 'cluster', x: cx, y: cy, members });
        }
    }
    return result;
}

// initHotspots: create circle elements for hotspots, with proximity clustering
function initHotspots(svg, states, hotspots, tooltip, popup, signal) {
    if (!hotspots || !hotspots.length) { _hotspotsInitialized = true; return; }

    let layer = svg.select('#hotspots-layer');
    if (layer.empty()) {
        layer = svg.append('g').attr('id', 'hotspots-layer').attr('pointer-events', 'all');
    }

    _hotspotBaseRadiusVB = 1;
    _hotspotBaseStrokePx = 1;

    const renderItems = clusterHotspots(hotspots, CLUSTER_THRESHOLD_VB);

    const groups = layer.selectAll('g.hotspot-group')
        .data(renderItems)
        .enter()
        .append('g')
        .attr('class', 'hotspot-group');

    // Circle for every render item (single or cluster) — visual only, no pointer events
    const circles = groups.append('circle')
        .attr('class', d => d.type === 'cluster' ? 'hotspot hotspot--cluster' : 'hotspot')
        .attr('cx', d => d.type === 'cluster' ? d.x : d.data.x)
        .attr('cy', d => d.type === 'cluster' ? d.y : d.data.y)
        .attr('r', _hotspotBaseRadiusVB)
        .style('fill', d => d.type === 'cluster' ? 'rgba(0, 90, 180, 0.75)' : 'rgba(215, 38, 61, 0.65)')
        .style('stroke', d => d.type === 'cluster' ? 'rgb(0, 60, 140)' : 'rgb(200, 0, 0)')
        .style('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer')
        .style('pointer-events', 'none');

    // Count badge for cluster items
    groups.filter(d => d.type === 'cluster')
        .append('text')
        .attr('class', 'hotspot-cluster-label')
        .attr('x', d => d.x)
        .attr('y', d => d.y)
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .style('pointer-events', 'none')
        .text(d => d.members.length);

    // Invisible hit-area ring — larger transparent circle on top that receives all pointer events
    const hits = groups.append('circle')
        .attr('class', 'hotspot-hit')
        .attr('cx', d => d.type === 'cluster' ? d.x : d.data.x)
        .attr('cy', d => d.type === 'cluster' ? d.y : d.data.y)
        .attr('r', _hotspotBaseRadiusVB * 3)
        .style('fill', 'transparent')
        .style('stroke', 'none')
        .style('cursor', 'pointer')
        .style('pointer-events', 'all');

    hits
        .on('mouseenter', function (event, d) {
            const visualCircle = this.closest('.hotspot-group').querySelector('circle.hotspot');
            if (d.type === 'cluster') {
                // Highlight on hover — popup opens on click only
                d3.select(visualCircle)
                    .style('fill', 'rgba(0, 130, 220, 0.85)')
                    .style('stroke', 'rgb(0, 90, 200)');
                // Show a brief hint only when the list popup isn't already open
                if (_activeHotspot !== visualCircle) {
                    _tooltip
                        .text(`${d.members.length} nearby hospitals`)
                        .style('left', (event.pageX + 14) + 'px')
                        .style('top', (event.pageY - 28) + 'px')
                        .style('opacity', 1);
                }
            } else {
                d3.select(visualCircle)
                    .style('fill', 'rgba(255, 0, 0, 0.55)')
                    .style('stroke', 'rgb(255, 0, 0)');
                showPopup(d.data, visualCircle, event);
            }
        })
        .on('mouseleave', function (event, d) {
            const visualCircle = this.closest('.hotspot-group').querySelector('circle.hotspot');
            if (_activeHotspot !== visualCircle) {
                const isCluster = d3.select(visualCircle).classed('hotspot--cluster');
                d3.select(visualCircle)
                    .style('fill', isCluster ? 'rgba(0, 90, 180, 0.75)' : 'rgba(215, 38, 61, 0.65)')
                    .style('stroke', isCluster ? 'rgb(0, 60, 140)' : 'rgb(200, 0, 0)');
            }
            // Cluster popup was opened by click — let it persist until dismissed
            if (d.type === 'cluster') {
                _tooltip.style('opacity', 0);
            } else if (!_hotspotPinned) {
                hidePopup();
            }
        })
        .on('click', function (event, d) {
            event.stopPropagation();
            const visualCircle = this.closest('.hotspot-group').querySelector('circle.hotspot');
            if (d.type === 'cluster') {
                showClusterPopup(d, visualCircle, event);
            } else {
                _hotspotPinned = true;
                showPopup(d.data, visualCircle, event);
            }
        });

    _hotspotsInitialized = true;
}

// adjustHotspots: scale circle radii & strokes with zoom
function adjustHotspots() {
    if (!_hotspotsInitialized || !_svg) return;

    try {
        const svgNode = _svg.node();
        if (!svgNode) return;

        const vbAttr = _svg.attr('viewBox');
        if (!vbAttr) return;

        const vbParts = vbAttr.split(/\s+/).map(parseFloat);
        if (vbParts.length !== 4) return;

        const currentVBWidth = vbParts[2];
        const rect = svgNode.getBoundingClientRect();
        const pxWidth = rect.width;

        if (!pxWidth || pxWidth <= 0 || !currentVBWidth || currentVBWidth <= 0) return;

        // vbUnitsPerPixel: how many viewBox units equal 1 pixel
        const vbUnitsPerPixel = currentVBWidth / pxWidth;
        // zoomLevel: relative zoom compared to full viewBox width
        const zoomLevel = _hotspotFullVBWidth / currentVBWidth;
        // Scale radius in pixels then convert to viewBox units
        // On coarse-pointer (touch) devices the visual circles are doubled for easier tapping
        const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
        const baseRadiusPx = 9 * (isCoarsePointer ? 0.85 : 1.0);
        const scalingFactor = 0.3;
        const scaledRadiusPx = baseRadiusPx * (1 + (zoomLevel - 1) * scalingFactor);
        const newRadiusVB = scaledRadiusPx * vbUnitsPerPixel;
        const targetStrokePx = 0.9;

        // Apply to all hotspots
        _svg.selectAll('circle.hotspot')
            .attr('r', newRadiusVB)
            .style('stroke-width', targetStrokePx + 'px')
            .style('vector-effect', 'non-scaling-stroke');

        // Cluster circles slightly larger than singles
        _svg.selectAll('circle.hotspot--cluster')
            .attr('r', newRadiusVB * 1.3);

        // Badge text scales proportionally with the circle radius
        _svg.selectAll('text.hotspot-cluster-label')
            .attr('font-size', newRadiusVB);

        // Hit rings stay 3× the visual radius so they scale in sync
        _svg.selectAll('circle.hotspot-hit').attr('r', function(d) {
            return d.type === 'cluster' ? newRadiusVB * 1.3 * 1.7 : newRadiusVB * 1.7;
        });

    } catch (e) {
        console.error('adjustHotspots error:', e);
    }
}

// showPopup: display popup for a single hotspot, with carousel support for multiple images
function showPopup(d, circleEl, evt) {
    if (!_popup || _popupPending) return;
    _popupPending = true;
    _popupLastEvent = evt;

    // Reset the previously active hotspot before switching
    if (_activeHotspot && _activeHotspot !== circleEl) {
        const wasCluster = d3.select(_activeHotspot).classed('hotspot--cluster');
        d3.select(_activeHotspot)
            .style('fill', wasCluster ? 'rgba(0, 90, 180, 0.75)' : 'rgba(215, 38, 61, 0.65)')
            .style('stroke', wasCluster ? 'rgb(0, 60, 140)' : 'rgb(200, 0, 0)');
    }
    _activeHotspot = circleEl;

    // Only apply red highlight for solo hotspots; cluster circle keeps its own active colour
    if (!d3.select(circleEl).classed('hotspot--cluster')) {
        d3.select(circleEl)
            .style('fill', 'rgba(255, 0, 0, 0.65)')
            .style('stroke', 'rgb(255, 50, 50)');
    }

    _popup.classed('open', false).classed('popup--cluster', false);
    _popup.style('width', null); // clear any width locked by a previous popup

    // Normalise image source: prefer images[] array, fall back to legacy imageUrl
    const imgs = d.images || (d.imageUrl ? [d.imageUrl] : []);
    const hasCarousel = imgs.length > 1;

    let textContent = `<strong>${d.title || 'Hotspot'}</strong>`;
    if (d.description) textContent += `<p>${d.description}</p>`;

    if (hasCarousel) {
        _popup.html(
            `<div class="popup-carousel">` +
            `<img src="" alt="">` +
            `<button class="popup-carousel-btn popup-prev" aria-label="Previous"><svg width="9" height="15" viewBox="0 0 9 15" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="8,1 1,7.5 8,14" stroke="grey" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
            `<button class="popup-carousel-btn popup-next" aria-label="Next"><svg width="9" height="15" viewBox="0 0 9 15" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1,1 8,7.5 1,14" stroke="grey" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>` +
            `</div>` +
            `<div class="popup-carousel-counter"></div>` +
            textContent
        );

        let idx = 0;
        let heightLocked = false;
        const carouselEl = _popup.select('.popup-carousel');
        const imgEl = _popup.select('.popup-carousel img');
        const counter = _popup.select('.popup-carousel-counter');

        function updateCarousel() {
            imgEl.style('opacity', 0).style('transform', 'translateY(6px)');
            const src = imgs[idx];
            const loader = new Image();
            loader.onload = () => {
                if (!heightLocked) {
                    // Lock dimensions before the image paints using intrinsic pixel size
                    const containerW = carouselEl.node().offsetWidth;
                    const maxH = 750;
                    const naturalRatio = loader.naturalWidth / loader.naturalHeight;
                    let w = containerW;
                    let h = containerW / naturalRatio;
                    if (h > maxH) {
                        // Height capped: shrink width too so the box keeps the
                        // image's true aspect ratio instead of cropping top/bottom
                        h = maxH;
                        w = maxH * naturalRatio;
                    }
                    const popupW = _popup.node().offsetWidth;
                    const newPopupW = popupW - (containerW - w);
                    carouselEl.style('height', h + 'px').style('width', w + 'px');
                    imgEl.style('width', '100%').style('height', '100%');
                    _popup.style('width', newPopupW + 'px');
                    heightLocked = true;
                }
                imgEl.attr('src', src).style('opacity', 1).style('transform', 'translateY(0)');
            };
            loader.src = src;
            counter.text(`${idx + 1} / ${imgs.length}`);
        }

        _popup.select('.popup-prev').on('click', function (e) {
            e.stopPropagation();
            idx = (idx - 1 + imgs.length) % imgs.length;
            updateCarousel();
        });
        _popup.select('.popup-next').on('click', function (e) {
            e.stopPropagation();
            idx = (idx + 1) % imgs.length;
            updateCarousel();
        });

        updateCarousel();
    } else {
        _popup.html(textContent);

        if (imgs.length === 1) {
            const img = new Image();
            img.onload = function () {
                _popup.select('img').style('opacity', 1).style('transform', 'translateY(0)');
            };
            img.src = imgs[0];
            _popup.insert('img', ':first-child').attr('src', imgs[0]).attr('alt', d.title || '');
        }
    }

    requestAnimationFrame(() => {
        positionPopup(circleEl, evt);
        requestAnimationFrame(() => {
            _popup.classed('open', true);
            _popupPending = false;
        });
    });
}

// showClusterPopup: display a list popup for a cluster of nearby hotspots
function showClusterPopup(clusterData, circleEl, evt) {
    if (!_popup || _popupPending) return;
    _popupPending = true;
    _popupLastEvent = evt;

    // Reset the previously active hotspot before switching
    if (_activeHotspot && _activeHotspot !== circleEl) {
        const wasCluster = d3.select(_activeHotspot).classed('hotspot--cluster');
        d3.select(_activeHotspot)
            .style('fill', wasCluster ? 'rgba(0, 90, 180, 0.75)' : 'rgba(215, 38, 61, 0.65)')
            .style('stroke', wasCluster ? 'rgb(0, 60, 140)' : 'rgb(200, 0, 0)');
    }
    _activeHotspot = circleEl;
    d3.select(circleEl)
        .style('fill', 'rgba(0, 130, 220, 0.85)')
        .style('stroke', 'rgb(0, 90, 200)');

    _popup.classed('open', false).classed('popup--cluster', true);
    _popup.style('width', null); // clear any width locked by a previous popup

    let content = `<strong>${clusterData.members.length} nearby hospitals</strong>`;
    content += `<ul class="popup-cluster-list">`;
    clusterData.members.forEach((m, i) => {
        content += `<li data-member-idx="${i}">${m.title}</li>`;
    });
    content += `</ul>`;

    _popup.html(content);

    // Bind click handlers to list items — clicking a name drills into the individual popup
    _popup.selectAll('.popup-cluster-list li').each(function () {
        const li = this;
        d3.select(li).on('click', function (e) {
            e.stopPropagation();
            const idx = +li.dataset.memberIdx;
            showPopup(clusterData.members[idx], circleEl, e);
        });
    });

    requestAnimationFrame(() => {
        positionPopup(circleEl, evt);
        requestAnimationFrame(() => {
            _popup.classed('open', true);
            _popupPending = false;
        });
    });
}

function positionPopup(circleEl, evt) {
    if (!_popup || !circleEl) return;

    const popup = _popup.node();
    if (!popup) return;

    // Always use viewport-relative ("fixed") positioning rather than document-relative
    // ("absolute") positioning.
    // Fixed positioning is always relative to what's currently on screen, so
    // it can't drift off into a part of the iframe that's scrolled out of view.
    popup.style.position = 'fixed';
    popup.style.right = '';
    popup.style.bottom = '';
    popup.style.left = '0px';
    popup.style.top = '0px';
    popup.style.setProperty('--popup-left', '0px');
    popup.style.setProperty('--popup-top', '0px');

    requestAnimationFrame(() => {
        const rect = popup.getBoundingClientRect();
        _popupRectCached = rect;

        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const isMobile = viewportW <= 520;

        if (isMobile) {
            popup.style.left = '12px';
            popup.style.right = '12px';
            popup.style.top = 'auto';
            popup.style.bottom = '5%';
            return;
        }

        const margin = 20;

        // Anchor near the cursor
        // the visible viewport (clientX/clientY) instead of the document.
        let x = evt.clientX + 16;
        let y = evt.clientY - rect.height / 2;

        const fitsToRight = x + rect.width <= viewportW - margin;
        const fitsIfFlippedLeft = evt.clientX - rect.width - 16 >= margin;
        const fitsVertically = rect.height <= viewportH - margin * 2;

        if ((fitsToRight || fitsIfFlippedLeft) && fitsVertically) {
            if (!fitsToRight) x = evt.clientX - rect.width - 16;
            if (y < margin) y = margin;
            if (y + rect.height > viewportH - margin) y = viewportH - rect.height - margin;
        } else {
            // fallback
            x = Math.max(margin, (viewportW - rect.width) / 2);
            y = Math.max(margin, (viewportH - rect.height) / 2);
        }

        popup.style.setProperty('--popup-left', x + 'px');
        popup.style.setProperty('--popup-top', y + 'px');
    });
}

// hidePopup: close popup and clear active hotspot
function hidePopup() {
    if (!_popup) return;
    if (_popupHovered) return;

    _popup.classed('open', false);

    if (_activeHotspot) {
        const isCluster = d3.select(_activeHotspot).classed('hotspot--cluster');
        d3.select(_activeHotspot)
            .style('fill', isCluster ? 'rgba(0, 90, 180, 0.75)' : 'rgba(215, 38, 61, 0.65)')
            .style('stroke', isCluster ? 'rgb(0, 60, 140)' : 'rgb(200, 0, 0)');
        _activeHotspot = null;
    }

    _hotspotPinned = false;
    _popupPending = false;
}

// initZoom: mousewheel zoom + pan with viewBox adjustments
function initZoom(svg, signal) {
    const svgEl = svg.node();
    if (!svgEl) return;

    let vbAttr = svg.attr('viewBox');
    
    // If SVG has no viewBox, create one from width/height or bbox
    if (!vbAttr) {
        console.log('SVG has no viewBox, attempting to create one...');
        
        try {
            // Try to get from width/height attributes
            const width = svg.attr('width');
            const height = svg.attr('height');
            
            if (width && height) {
                // Remove units (px, %, etc.) and convert to numbers
                const w = parseFloat(width);
                const h = parseFloat(height);
                
                if (!isNaN(w) && !isNaN(h) && w > 0 && h > 0) {
                    vbAttr = `0 0 ${w} ${h}`;
                    svg.attr('viewBox', vbAttr);
                    console.log('Created viewBox from width/height:', vbAttr);
                }
            }
            
            // If still no viewBox, try to get bounding box
            if (!vbAttr) {
                const bbox = svgEl.getBBox();
                if (bbox && bbox.width > 0 && bbox.height > 0) {
                    vbAttr = `${bbox.x} ${bbox.y} ${bbox.width} ${bbox.height}`;
                    svg.attr('viewBox', vbAttr);
                    console.log('Created viewBox from bbox:', vbAttr);
                }
            }
        } catch (err) {
            console.error('Failed to create viewBox:', err);
        }
        
        // If still no viewBox, give up
        if (!vbAttr) {
            console.warn('No viewBox on SVG and could not create one; zoom disabled.');
            return;
        }
    }

    const initialVB = vbAttr.split(/\s+/).map(parseFloat);
    if (initialVB.length !== 4) { 
        console.warn('Invalid viewBox format:', vbAttr); 
        return; 
    }

    const fullVB = initialVB.slice();
    let vb = initialVB.slice();

    function clampToFull(candidate) {
        const [x, y, w, h] = candidate;
        const [fx, fy, fw, fh] = fullVB;
        const minW = fw * 0.1;
        const minH = fh * 0.1;
        let nw = Math.max(minW, Math.min(w, fw));
        let nh = Math.max(minH, Math.min(h, fh));
        let nx = Math.max(fx, Math.min(x, fx + fw - nw));
        let ny = Math.max(fy, Math.min(y, fy + fh - nh));
        return [nx, ny, nw, nh];
    }

    // Helper: check if pointer is over the SVG using bounding box
    function isPointerOverSvg(e) {
        try {
            const rect = svgEl.getBoundingClientRect();
            return (
                e.clientX >= rect.left &&
                e.clientX <= rect.right &&
                e.clientY >= rect.top &&
                e.clientY <= rect.bottom
            );
        } catch (err) {
            return false;
        }
    }

    // Core zoom logic: apply a zoom factor centered on a client-space point
    function applyZoom(zoomFactor, clientX, clientY) {
        try {
            const rect = svgEl.getBoundingClientRect();
            const mouseX = clientX - rect.left;
            const mouseY = clientY - rect.top;

            const scaleX = vb[2] / rect.width;
            const scaleY = vb[3] / rect.height;
            const vbMouseX = vb[0] + mouseX * scaleX;
            const vbMouseY = vb[1] + mouseY * scaleY;

            let newW = vb[2] * zoomFactor;
            let newH = vb[3] * zoomFactor;
            let newX = vbMouseX - (mouseX * newW / rect.width);
            let newY = vbMouseY - (mouseY * newH / rect.height);

            const candidate = clampToFull([newX, newY, newW, newH]);

            const EPS = 1e-4;
            if (Math.abs(candidate[2] - vb[2]) < EPS && Math.abs(candidate[3] - vb[3]) < EPS) {
                return;
            }

            vb = candidate;
            svg.attr('viewBox', vb.join(' '));

            requestAnimationFrame(() => adjustHotspots());
        } catch (err) {
            console.error('Zoom error:', err);
        }
    }

    // Wheel zoom wrapper
    function performZoom(e) {
        applyZoom(e.deltaY > 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }

    // Window-level capture listener to intercept wheel events over the SVG.
    window.addEventListener('wheel', function (e) {
        // Only if pointer is over our SVG
        if (!isPointerOverSvg(e)) return;

        const absX = Math.abs(e.deltaX || 0);
        const absY = Math.abs(e.deltaY || 0);

        if (!e.ctrlKey && !e.metaKey) {
            // Pprevent page drifting when scrolling.
            // Threshold: horizontal >= 0.5 * vertical (tunable)
            if (absX > 0 && absX >= absY * 0.5) {
                e.preventDefault();
                e.stopPropagation();
                try {
                    window.scrollBy({ top: e.deltaY, left: 0 });
                } catch (err) {
                    // Fallback for older browsers
                    window.scrollBy(0, e.deltaY);
                }
                return;
            }

            // Otherwise allow default vertical scrolling to proceed
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        performZoom(e);
    }, { passive: false, capture: true, signal });

    // Prevent touch gestures from zooming the browser
    if ('ontouchstart' in window) {
        svgEl.addEventListener('gesturestart', function(e) {
            e.preventDefault();
        }, { passive: false, signal });
        
        svgEl.addEventListener('gesturechange', function(e) {
            e.preventDefault();
        }, { passive: false, signal });
        
        svgEl.addEventListener('gestureend', function(e) {
            e.preventDefault();
        }, { passive: false, signal });
    }

    // Pan with mouse drag
    let isPanning = false;
    let startClient = null;
    let vbStart = null;

    // Touch state for single-finger pan and two-finger pinch-to-zoom
    let isTouchPanning = false;
    let touchStart = null;
    let vbTouchStart = null;
    let lastPinchDist = null;
    let wasPinching = false;

    function getTouchDistance(touches) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function getTouchMidpoint(touches) {
        return {
            x: (touches[0].clientX + touches[1].clientX) / 2,
            y: (touches[0].clientY + touches[1].clientY) / 2
        };
    }

    function setCursorDragging(active) {
        if (active) {
            svgEl.classList.add('map-interaction-active');
            svgEl.style.cursor = 'grabbing';
        } else {
            svgEl.classList.remove('map-interaction-active');
            svgEl.style.cursor = 'grab';
        }
    }

    svgEl.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        const target = e.target;
        if (target && (target.classList.contains('hotspot') || target.classList.contains('hotspot-hit'))) return;

        isPanning = true;
        startClient = { x: e.clientX, y: e.clientY };
        vbStart = vb.slice();
        setCursorDragging(true);
    }, { signal });

    window.addEventListener('mousemove', function (e) {
        if (!isPanning || !vbStart || !startClient) return;
        const rect = svgEl.getBoundingClientRect();
        const dxPx = e.clientX - startClient.x;
        const dyPx = e.clientY - startClient.y;
        const scaleX = vbStart[2] / rect.width;
        const scaleY = vbStart[3] / rect.height;
        vb = clampToFull([vbStart[0] - dxPx * scaleX, vbStart[1] - dyPx * scaleY, vbStart[2], vbStart[3]]);
        svg.attr('viewBox', vb.join(' '));
        
        requestAnimationFrame(() => adjustHotspots());
    }, { signal });

    window.addEventListener('mouseup', function () {
        if (!isPanning) return;
        isPanning = false;
        startClient = null;
        vbStart = null;
        setCursorDragging(false);
    }, { signal });

    // Touch pan (single finger) and pinch-to-zoom (two fingers)
    svgEl.addEventListener('touchstart', function(e) {
        const target = e.target;
        const onHotspot = target && (target.classList.contains('hotspot-hit') || target.classList.contains('hotspot'));
        if (e.touches.length === 2) {
            e.preventDefault();
            lastPinchDist = getTouchDistance(e.touches);
            wasPinching = true;
            isTouchPanning = false;
            touchStart = null;
            vbTouchStart = null;
        } else if (e.touches.length === 1 && !wasPinching && !onHotspot) {
            isTouchPanning = true;
            touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            vbTouchStart = vb.slice();
        }
    }, { passive: false, signal });

    window.addEventListener('touchmove', function(e) {
        if (e.touches.length === 2 && lastPinchDist !== null) {
            e.preventDefault();
            const newDist = getTouchDistance(e.touches);
            if (newDist > 0) {
                const ratio = lastPinchDist / newDist;
                const mid = getTouchMidpoint(e.touches);
                applyZoom(ratio, mid.x, mid.y);
            }
            lastPinchDist = newDist;
        } else if (e.touches.length === 1 && isTouchPanning && vbTouchStart && touchStart) {
            e.preventDefault();
            const rect = svgEl.getBoundingClientRect();
            const dx = e.touches[0].clientX - touchStart.x;
            const dy = e.touches[0].clientY - touchStart.y;
            const scaleX = vbTouchStart[2] / rect.width;
            const scaleY = vbTouchStart[3] / rect.height;
            vb = clampToFull([vbTouchStart[0] - dx * scaleX, vbTouchStart[1] - dy * scaleY, vbTouchStart[2], vbTouchStart[3]]);
            svg.attr('viewBox', vb.join(' '));
            requestAnimationFrame(() => adjustHotspots());
        }
    }, { passive: false, signal });

    window.addEventListener('touchend', function(e) {
        if (e.touches.length < 2) {
            lastPinchDist = null;
        }
        if (e.touches.length === 0) {
            isTouchPanning = false;
            touchStart = null;
            vbTouchStart = null;
            setTimeout(() => { wasPinching = false; }, 100);
        }
    }, { signal });

    setCursorDragging(false);
}

// initSearch: search input, suggestions and state activation
function initSearch(svg, states, tooltip, popup, signal) {
    try {
        const input = document.getElementById('map-search');
        const sugg = document.getElementById('map-search-suggestions');
        if (!input || !sugg || !states) return;

        const nodes = Array.from(states.nodes()).filter(n => n && n.id);
        const items = nodes.map(n => ({ id: n.id, name: (n.getAttribute('data-name') || n.getAttribute('title') || n.id || '').trim() }));
        let highlighted = -1;
        let currentMatches = [];
        let activeSearchState = null;

        function clearSuggestions() { sugg.innerHTML = ''; sugg.setAttribute('aria-hidden', 'true'); highlighted = -1; currentMatches = []; }
        function render(matches) {
            clearSuggestions();
            if (!matches || !matches.length) return;
            sugg.setAttribute('aria-hidden', 'false');
            const frag = document.createDocumentFragment();
            matches.slice(0, 30).forEach((m) => {
                const li = document.createElement('li');
                li.textContent = m.name;
                li.setAttribute('role', 'option');
                li.dataset.id = m.id;
                li.className = 'map-search-suggestion';
                li.addEventListener('click', function () { activateState(m.id); input.value = m.name; clearSuggestions(); });
                frag.appendChild(li);
            });
            sugg.appendChild(frag);
        }
        function search(q) {
            const s = (q || '').trim().toLowerCase();
            if (!s) { clearSuggestions(); clearActive(); return; }
            const matches = items.filter(it => it.name.toLowerCase().includes(s)).sort((a, b) => a.name.localeCompare(b.name));
            currentMatches = matches;
            render(matches);
        }
        function clearActive() {
            try {
                if (activeSearchState) {
                    try {
                        const prev = activeSearchState.getAttribute('data-prev-stroke');
                        const prevW = activeSearchState.getAttribute('data-prev-stroke-width');
                        if (prev !== null) { if (prev === '') activeSearchState.removeAttribute('stroke'); else activeSearchState.setAttribute('stroke', prev); }
                        if (prevW !== null) { if (prevW === '') activeSearchState.removeAttribute('stroke-width'); else activeSearchState.setAttribute('stroke-width', prevW); }
                        activeSearchState.style && (activeSearchState.style.vectorEffect = null);
                    } catch (e) { }
                    activeSearchState.classList.remove('state--active');
                    activeSearchState = null;
                }
                try { const actLayer = svg.select('#active-state-layer'); if (!actLayer.empty()) actLayer.selectAll('*').remove(); } catch (e) { }
                try { popup.classed('open', false); } catch (e) { }
                try { tooltip.style('opacity', 0); } catch (e) { }
            } catch (e) { }
        }
        function activateState(id) {
            try {
                clearActive();
                const el = document.getElementById(id);
                if (!el) return;
                try {
                    if (!el.hasAttribute('data-prev-stroke')) el.setAttribute('data-prev-stroke', el.getAttribute('stroke') || '');
                    if (!el.hasAttribute('data-prev-stroke-width')) el.setAttribute('data-prev-stroke-width', el.getAttribute('stroke-width') || '');
                } catch (e) { }
                try { el.setAttribute('stroke', 'none'); el.setAttribute('stroke-width', '0'); el.style && (el.style.vectorEffect = null); } catch (e) { }
                el.classList.add('state--active');
                activeSearchState = el;
                try {
                    let actLayer = svg.select('#active-state-layer');
                    if (actLayer.empty()) {
                        if (svg.select('#hotspots-layer').empty()) actLayer = svg.append('g').attr('id', 'active-state-layer');
                        else actLayer = svg.insert('g', '#hotspots-layer').attr('id', 'active-state-layer');
                    }
                    actLayer.selectAll('*').remove();
                    const clone = el.cloneNode(true);
                    try { clone.removeAttribute && clone.removeAttribute('id'); } catch (e) { }
                    (function styleNode(n) {
                        try {
                            const tag = (n.tagName || '').toLowerCase();
                            if (['path', 'polygon', 'polyline', 'rect', 'circle', 'ellipse', 'line'].includes(tag)) {
                                n.setAttribute('fill', 'none');
                                const accent = (getComputedStyle(document.documentElement).getPropertyValue('--popup-accent') || '#0a84ff').trim() || '#0a84ff';
                                n.setAttribute('stroke', accent);
                                n.setAttribute('stroke-width', '1');
                                n.setAttribute('vector-effect', 'non-scaling-stroke');
                                n.setAttribute('pointer-events', 'none');
                                try { n.style.filter = 'drop-shadow(0 8px 16px rgba(10,132,255,0.12))'; } catch (e) { }
                            }
                        } catch (e) { }
                        try { const ch = n.children || []; for (let i = 0; i < ch.length; i++) styleNode(ch[i]); } catch (e) { }
                    })(clone);
                    const node = actLayer.node();
                    if (node) node.appendChild(clone);
                } catch (e) { console.error('active-layer', e); }
            } catch (e) { console.error('activateState', e); }
        }

        input.addEventListener('input', function () { search(this.value); }, { signal });
        input.addEventListener('keydown', function (e) {
            const itemsEls = sugg ? Array.from(sugg.children) : [];
            if (e.key === 'ArrowDown') {
                if (!itemsEls.length) return;
                e.preventDefault(); highlighted = Math.min(itemsEls.length - 1, highlighted + 1);
                itemsEls.forEach((li, i) => li.classList.toggle('selected', i === highlighted));
            } else if (e.key === 'ArrowUp') {
                if (!itemsEls.length) return;
                e.preventDefault(); highlighted = Math.max(0, highlighted - 1);
                itemsEls.forEach((li, i) => li.classList.toggle('selected', i === highlighted));
            } else if (e.key === 'Enter') {
                if (itemsEls.length) { e.preventDefault(); const idx = highlighted >= 0 ? highlighted : 0; const sel = itemsEls[idx]; if (sel) { activateState(sel.dataset.id); input.value = sel.textContent; clearSuggestions(); } }
            } else if (e.key === 'Escape') {
                input.value = ''; clearSuggestions(); clearActive();
            }
        }, { signal });

        document.addEventListener('click', function (ev) {
            if (!ev.target) return;
            if (ev.target === input || (ev.target.closest && ev.target.closest('.map-search'))) return;
            clearSuggestions();
        }, { capture: true, signal });

    } catch (e) { console.error('map-search:init', e); }
}

// Hash router
function getSlugFromHash() {
    const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
    return hash || '';
}

function route() {
    const slug = getSlugFromHash();
    if (slug && MAP_CATALOG[slug]) {
        loadMap(slug);
    } else {
        showLanding();
    }
}

// Boot
window.addEventListener('hashchange', route);
window.addEventListener('DOMContentLoaded', route);