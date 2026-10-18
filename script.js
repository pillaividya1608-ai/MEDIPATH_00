/* ============================================================================
   MediPath – application script (UI + map rendering). Routing lives in data/engine.js.
   No positioning hardware is used: the start point is chosen / corrected by the user.
   ========================================================================== */
(function () {
  'use strict';
  const D = window.MEDIPATH_DATA, Eng = window.MediPathEngine;
  const { FLOORS, CONFIG, rooms, nodes, edges } = D;
  const NS = 'http://www.w3.org/2000/svg';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ico = (n, cls) => '<svg class="ic ' + (cls || '') + '"><use href="#i-' + n + '"/></svg>';
  const byId = Eng.roomById;
  const floorList = Object.values(FLOORS).sort((a, b) => b.level - a.level);
  const floorLabel = f => FLOORS[f].level === 0 ? 'Ground Floor' : 'Floor ' + FLOORS[f].level;

  const KIND = {
    ward: ['bed', 't-orange'], icu: ['pulse', 't-blue'], emergency: ['cross', 't-red'], wc: ['wc', 't-teal'], cafe: ['cup', 't-orange'],
    pharmacy: ['pill', 't-green'], lab: ['flask', 't-purple'], radiology: ['scan', 't-blue'], consult: ['user', 't-indigo'], dept: ['cross', 't-indigo'],
    cardio: ['heart', 't-pink'], opd: ['user', 't-teal'], physio: ['pulse', 't-green'], admin: ['building', 't-gold'], records: ['list', 't-gold'],
    lounge: ['user', 't-purple'], reception: ['building', 't-blue'], waiting: ['user', 't-teal'], stairs: ['stairs', 't-gold'], ramp: ['wheel', 't-green'], entrance: ['door', 't-blue']
  };
  const kindOf = r => KIND[r.kind] || ['pin', 't-green'];
  const GROUPS = { All: null, Wards: ['Ward'], Departments: ['Department'], Facilities: ['Facility', 'Stairs'] };

  /* ------------------------------------------------------------------ state */
  const store = {
    get(k, d) { try { const v = localStorage.getItem('medipath.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('medipath.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
  };
  const qs = new URLSearchParams(location.search);
  const state = {
    startId: byId[qs.get('from')] ? qs.get('from') : 'main_entrance',
    destId: byId[qs.get('to')] ? qs.get('to') : null,
    mode: ['fastest', 'accessible', 'turns'].includes(qs.get('mode')) ? qs.get('mode') : (store.get('prefAccessible', false) ? 'accessible' : 'fastest'),
    floor: 'gf', route: null, error: null, step: 0, navigating: false, pickedId: null,
    screen: 'home', locMode: 'dest', group: 'All', floorFilter: 'all', query: '', infoKey: null, infoFrom: 'settings',
    saved: store.get('saved', []), debug: qs.has('debug')
  };
  const mpp = CONFIG.metersPerPixel;
  const fmtDist = px => { const m = px * mpp; return m < 10 ? Math.max(1, Math.round(m)) + ' m' : Math.round(m / (m > 40 ? 5 : 1)) * (m > 40 ? 5 : 1) + ' m'; };
  const fmtTime = (px, stairs) => { const s = px * mpp / CONFIG.walkSpeedMps + (stairs || 0) * 25; return s < 45 ? Math.max(10, Math.round(s / 5) * 5) + ' s' : Math.max(1, Math.round(s / 60)) + ' min'; };
  const svgEl = (tag, attrs, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
  let toastTimer;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3000); }
  const isDesktop = () => window.matchMedia('(min-width: 900px)').matches;

  /* ------------------------------------------------------------------ MapView (pan / zoom / pick) */
  class MapView {
    constructor(el, opt) {
      opt = opt || {}; this.el = el; this.onPick = opt.onPick; this.floor = null; this.s = 1; this.tx = 0; this.ty = 0; this.userMoved = false; this.minS = 0.15; this.maxS = 6;
      el.innerHTML = '<div class="mv-stage"><img alt="" draggable="false"><svg xmlns="' + NS + '"></svg></div>';
      this.stage = el.firstChild; this.img = this.stage.firstChild; this.svg = this.stage.lastChild; this.bind();
      this.ro = new ResizeObserver(() => { if (this.floor) { this.userMoved ? this.apply() : this.refit(); } }); this.ro.observe(el);
    }
    setFloor(f) {
      if (this.floor === f) return; const F = FLOORS[f]; this.floor = f;
      this.img.src = F.image; this.stage.style.width = F.width + 'px'; this.stage.style.height = F.height + 'px';
      this.svg.setAttribute('viewBox', '0 0 ' + F.width + ' ' + F.height); this.userMoved = false; this.refit();
    }
    refit() { const F = FLOORS[this.floor]; this.fitBounds({ x0: 0, y0: 0, x1: F.width, y1: F.height }, 0.97); }
    fitBounds(b, pad, maxS) {
      const w = this.el.clientWidth, h = this.el.clientHeight; if (!w || !h) return;
      const bw = Math.max(40, b.x1 - b.x0), bh = Math.max(40, b.y1 - b.y0);
      let s = Math.min(w / bw, h / bh) * (pad || 0.9); if (maxS) s = Math.min(s, maxS);
      this.s = s; this.tx = w / 2 - (b.x0 + bw / 2) * s; this.ty = h / 2 - (b.y0 + bh / 2) * s; this.minS = Math.min(s, 0.3) * 0.5; this.apply();
    }
    apply() { this.stage.style.transform = 'translate(' + this.tx + 'px,' + this.ty + 'px) scale(' + this.s + ')'; if (this.onChange && !this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; this.onChange(); }); }
    zoomAt(f, cx, cy) { const ns = Math.min(this.maxS, Math.max(this.minS, this.s * f)); f = ns / this.s; this.tx = cx - (cx - this.tx) * f; this.ty = cy - (cy - this.ty) * f; this.s = ns; this.userMoved = true; this.apply(); }
    zoomCentre(f) { this.zoomAt(f, this.el.clientWidth / 2, this.el.clientHeight / 2); }
    toMap(cx, cy) { const r = this.el.getBoundingClientRect(); return { x: (cx - r.left - this.tx) / this.s, y: (cy - r.top - this.ty) / this.s }; }
    bind() {
      const el = this.el, pts = new Map(); let moved = 0, pinch = 0;
      const pd = m => { const [a, b] = [...m.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
      el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; el.classList.add('dragging'); if (pts.size === 2) pinch = pd(pts); });
      el.addEventListener('pointermove', e => {
        const p = pts.get(e.pointerId); if (!p) return;
        if (pts.size === 1) { const dx = e.clientX - p.x, dy = e.clientY - p.y; moved += Math.abs(dx) + Math.abs(dy); this.tx += dx; this.ty += dy; this.userMoved = true; this.apply(); }
        p.x = e.clientX; p.y = e.clientY;
        if (pts.size === 2) { const d = pd(pts), r = el.getBoundingClientRect(), [a, b] = [...pts.values()]; if (pinch) this.zoomAt(d / pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch = d; moved += 10; }
      });
      const up = e => { const had = pts.has(e.pointerId); pts.delete(e.pointerId); if (!pts.size) el.classList.remove('dragging'); if (had && e.type === 'pointerup' && moved < 6 && this.onPick) this.onPick(this.toMap(e.clientX, e.clientY)); };
      el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
      el.addEventListener('wheel', e => { e.preventDefault(); const r = el.getBoundingClientRect(); this.zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    }
  }

  /* ------------------------------------------------------------------ overlay: route, nodes, markers (all compact) */
  const BLUE = '#1b46e6';
  function drawOverlay(svg, floor, k, o) {
    o = o || {}; svg.innerHTML = '';
    const g = svgEl('g', {}, svg), route = state.route, start = byId[state.startId], dest = state.destId ? byId[state.destId] : null;

    if (o.debug) {
      edges.forEach(e => { const a = nodes[e.a], b = nodes[e.b]; if (a.floor !== floor || b.floor !== floor) return;
        svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: e.status === 'verified' ? '#1b46e6' : e.status === 'label' ? '#e08a00' : '#e02020', 'stroke-width': 1.6 * k, 'stroke-dasharray': (4 * k) + ' ' + (3 * k) }, g); });
      Object.values(nodes).forEach(n => { if (n.floor !== floor) return; svgEl('circle', { cx: n.x, cy: n.y, r: 2.6 * k, fill: n.type === 'door' ? '#17a05a' : n.type === 'room' ? '#fff' : n.type === 'stairs' ? '#d6249f' : '#ffd400', stroke: '#000', 'stroke-width': .6 * k }, g); });
    }
    if (state.screen === 'maps') { drawMapsMarkers(g, floor, k); return; } // Map feature: only its own markers
    const pick = state.pickedId && byId[state.pickedId];
    if (pick && pick.floor === floor) { const r = pick.rect; svgEl('rect', { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], class: 'room-hit', 'stroke-width': 2 * k }, g); }

    if (route && route.ok) {
      const P = route.nodes, segs = []; let cur = null;
      P.forEach((id, i) => { if (nodes[id].floor === floor) { if (!cur) { cur = []; segs.push(cur); } cur.push(i); } else cur = null; });
      const pathOf = idxs => 'M' + idxs.map(i => nodes[P[i]].x + ' ' + nodes[P[i]].y).join(' L');
      const st = route.steps && route.steps[state.step];
      if (st && o.activeStep !== false && st.floor === floor && st.endIdx > st.nodeIdx) { // current step: soft green halo under the line
        const idxs = []; for (let i = st.nodeIdx; i <= st.endIdx; i++) if (nodes[P[i]].floor === floor) idxs.push(i);
        if (idxs.length > 1) svgEl('path', { d: pathOf(idxs), fill: 'none', stroke: '#17a05a', 'stroke-opacity': .22, 'stroke-width': 13 * k, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
      }
      segs.forEach(idxs => {
        if (idxs.length < 2) return; const d = pathOf(idxs);
        svgEl('path', { d, fill: 'none', stroke: '#fff', 'stroke-opacity': .95, 'stroke-width': 6.4 * k, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        svgEl('path', { d, fill: 'none', stroke: BLUE, 'stroke-width': 3.4 * k, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
        for (let j = 0; j < idxs.length - 1; j++) { const e = route.edges[idxs[j]]; // unconfirmed passages stay visibly dashed
          if (e && e.status === 'unverified') svgEl('path', { d: pathOf([idxs[j], idxs[j + 1]]), fill: 'none', stroke: '#e08a00', 'stroke-width': 3.4 * k, 'stroke-dasharray': (6 * k) + ' ' + (5 * k), 'stroke-linecap': 'round' }, g); }
      });
      P.forEach((id, i) => { const n = nodes[id]; if (n.floor !== floor || i === 0 || i === P.length - 1) return;
        const a = nodes[P[i - 1]], b = nodes[P[i + 1]]; if (!b || a.floor !== floor || b.floor !== floor) return;
        if (n.type === 'door') svgEl('circle', { cx: n.x, cy: n.y, r: 2.8 * k, fill: '#fff', stroke: BLUE, 'stroke-width': 1.4 * k }, g);
        else if (a.x !== b.x && a.y !== b.y) svgEl('circle', { cx: n.x, cy: n.y, r: 3.4 * k, fill: '#fff', stroke: BLUE, 'stroke-width': 1.8 * k }, g); });
      route.edges.forEach((e, i) => { if (e.kind !== 'stairs') return;
        [P[i], P[i + 1]].forEach(id => { const n = nodes[id]; if (n.floor === floor) stairToken(g, n.x, n.y, k); }); });
    }
    const sm = (state.navigating && state.pos) ? state.pos : (start && nodes[start.node]); // moving dot while navigating
    if (sm && sm.floor === floor) startMarker(g, sm, k);
    if (dest && dest.floor === floor) destPin(g, nodes[dest.node], k);
  }
  function startMarker(g, n, k) { // small blue dot with a faint ring
    svgEl('circle', { cx: n.x, cy: n.y, r: 9 * k, fill: 'rgba(37,99,235,.28)', class: 'pulse' }, g);
    svgEl('circle', { cx: n.x, cy: n.y, r: 5.2 * k, fill: '#2563eb', stroke: '#fff', 'stroke-width': 2.2 * k }, g);
  }
  function destPin(g, n, k) { // compact green pin (≈ 22 px tall at any zoom)
    svgEl('circle', { cx: n.x, cy: n.y, r: 7 * k, fill: 'rgba(23,160,90,.22)', class: 'pulse' }, g);
    svgEl('ellipse', { cx: n.x, cy: n.y, rx: 4.5 * k, ry: 1.7 * k, fill: 'rgba(0,0,0,.28)' }, g);
    const p = svgEl('g', { transform: 'translate(' + n.x + ',' + n.y + ') scale(' + k * 0.5 + ')' }, g);
    svgEl('path', { d: 'M0 0C-9-12-17-19-17-29a17 17 0 1 1 34 0C17-19 9-12 0 0Z', fill: '#17a05a', stroke: '#fff', 'stroke-width': 3.2 }, p);
    svgEl('circle', { cx: 0, cy: -29, r: 6.6, fill: '#fff' }, p);
  }
  function stairToken(g, x, y, k) { // amber rounded square with a stair glyph, ≈ 16 px
    const s = 8 * k;
    svgEl('rect', { x: x - s, y: y - s, width: 2 * s, height: 2 * s, rx: 3.5 * k, fill: '#fff4de', stroke: '#d98a14', 'stroke-width': 1.5 * k }, g);
    svgEl('path', { d: 'M' + (x - 4 * k) + ' ' + (y + 4 * k) + 'h' + 2.6 * k + 'v' + -2.6 * k + 'h' + 2.6 * k + 'v' + -2.6 * k + 'h' + 3 * k, fill: 'none', stroke: '#b9650b', 'stroke-width': 1.5 * k, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  }

  /* ------------------------------------------------------------------ route computation */
  function computeRoute() {
    state.route = null; state.error = null; state.step = 0;
    if (!state.destId) return;
    const r = Eng.findRoute(state.startId, state.destId, state.mode);
    if (r.ok) state.route = r; else state.error = r;
  }

  /* ------------------------------------------------------------------ map view instance */
  const main = new MapView($('#main-map'), { onPick: pickAt });
  main.onChange = () => drawOverlay(main.svg, main.floor, 1 / main.s, { debug: state.debug });
  function bounds(ns, pad) { if (!ns.length) return null; pad = pad || 0; return { x0: Math.min(...ns.map(n => n.x)) - pad, y0: Math.min(...ns.map(n => n.y)) - pad, x1: Math.max(...ns.map(n => n.x)) + pad, y1: Math.max(...ns.map(n => n.y)) + pad }; }
  function fitRoute() { main.userMoved = false; main.refit(); }
  function focusStep() {
    const r = state.route; if (!r) return; const st = r.steps[state.step], P = r.nodes;
    const b = bounds(P.slice(st.nodeIdx, st.endIdx + 1).map(id => nodes[id]).filter(n => n.floor === main.floor), 170);
    if (b) { main.fitBounds(b, 0.85, 1.35); main.userMoved = true; }
  }
  function pickAt(p) {
    if (state.screen === 'maps') { mapsPick(p); return; }
    const f = main.floor; let best = null, area = Infinity;
    rooms.forEach(r => { if (r.floor !== f) return; const a = r.rect; if (p.x >= a[0] && p.x <= a[2] && p.y >= a[1] && p.y <= a[3]) { const ar = (a[2] - a[0]) * (a[3] - a[1]); if (ar < area) { area = ar; best = r; } } });
    state.pickedId = best ? best.id : null; renderMapUI(); main.onChange();
  }

  /* ------------------------------------------------------------------ screens */
  function leftScreen() { return state.screen === 'map' ? (isDesktop() && state.destId ? 'route' : 'locations') : state.screen; }
  function placeSheets() { const host = $('#route-host'), mp = $('#mappane'), sh = $('#route-sheet'), nc = $('#navcard'), ms = $('#maps-sheet'); if (isDesktop()) { host.append(sh, nc); $('#maps-host').append(ms); } else { mp.append(sh, nc, ms); } }
  function show(screen, opts) {
    opts = opts || {}; state.screen = screen; const app = $('#app'); app.dataset.screen = screen;
    if (screen === 'locations' && !opts.keepMode) state.locMode = 'dest';
    const ls = leftScreen(); $$('.screen').forEach(s => s.classList.toggle('active', s.id === 's-' + ls));
    const tab = { home: 'home', locations: 'home', map: 'map', maps: 'map', directions: 'map', saved: 'saved', settings: 'settings', info: 'settings' }[screen] || 'home';
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (ls === 'locations') renderLocations(); if (ls === 'saved') renderSaved(); if (ls === 'directions') renderDirections();
    if (screen === 'map' || screen === 'maps') { requestAnimationFrame(() => { renderMapUI(); main.onChange(); }); }
  }
  const go = (s, o) => show(s, o);

  function rowHtml(r, opts) {
    opts = opts || {}; const [icon, cls] = kindOf(r);
    const sub = (r.code ? r.code + ' · ' : '') + (r.category === 'Stairs' ? 'Stairs' : r.category) + ' · ' + floorLabel(r.floor);
    return '<button class="loc-row" data-id="' + r.id + '"><span class="tile ' + cls + '">' + ico(icon) + '</span><span class="qa-t"><b>' + esc(r.name) + '</b><small>' + esc(sub) + '</small></span>' +
      (opts.remove ? '<span class="icon-btn" data-remove="' + r.id + '" role="button" aria-label="Remove from saved">' + ico('x') + '</span>' : ico('chev-r', 'chev')) + '</button>';
  }
  function search(q) {
    q = q.trim().toLowerCase(); if (!q) return rooms.slice();
    const score = r => { const n = r.name.toLowerCase(), c = (r.code || '').toLowerCase(), f = (r.full || '').toLowerCase(), cat = r.category.toLowerCase(), fl = floorLabel(r.floor).toLowerCase(), hay = [n, c, f, cat, fl, FLOORS[r.floor].name.toLowerCase()].join(' ');
      if (n === q || c === q) return 0; if (n.startsWith(q) || c.startsWith(q)) return 1; if (n.includes(q) || c.includes(q) || f.includes(q)) return 2; if (cat.startsWith(q)) return 3; if (hay.includes(q)) return 4;
      return q.split(/\s+/).every(w => hay.includes(w)) ? 5 : 9; };
    return rooms.map(r => [score(r), r]).filter(x => x[0] < 9).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  }
  function renderLocations() {
    $('#loc-title').textContent = state.locMode === 'start' ? 'Where are you now?' : state.locMode === 'save' ? 'Add Saved Location' : 'Hospital Locations';
    $('#loc-search').placeholder = state.locMode === 'start' ? 'Search your current location…' : 'Search destination…';
    $('#chips').innerHTML = Object.keys(GROUPS).map(g => '<button class="chip ' + (state.group === g ? 'on' : '') + '" data-g="' + g + '">' + g + '</button>').join('');
    $('#loc-h').textContent = state.locMode === 'start' ? 'Choose your starting point' : 'Hospital Locations' + (state.floorFilter !== 'all' ? ' · ' + FLOORS[state.floorFilter].name : '');
    let list = search(state.query);
    if (GROUPS[state.group]) list = list.filter(r => GROUPS[state.group].includes(r.category));
    if (state.floorFilter !== 'all') list = list.filter(r => r.floor === state.floorFilter);
    if (state.locMode === 'dest') list = list.filter(r => r.id !== state.startId);
    $('#loc-list').innerHTML = list.length ? list.map(r => rowHtml(r)).join('') : '<div class="empty">No matching place on the supplied maps.<br>Try a department name or a room number.</div>';
  }
  function renderSaved() {
    const l = state.saved.map(i => byId[i]).filter(Boolean);
    $('#saved-list').innerHTML = l.length ? l.map(r => rowHtml(r, { remove: true })).join('') : '<div class="empty">No saved locations yet.<br>Tap + to add one, or use the bookmark on a route.</div>';
  }
  function renderDirections() {
    const r = state.route, list = $('#dir-list');
    if (!r) { list.innerHTML = '<div class="empty">Choose a destination to see step-by-step directions.</div>'; $('#dir-dist').textContent = '–'; $('#dir-time').textContent = '–'; $('#btn-view-route').disabled = true; return; }
    $('#btn-view-route').disabled = false; const s0 = byId[state.startId];
    let h = '<button class="dir-row" data-step="0"><span class="dir-ic start">' + ico('user') + '</span><span class="dir-t">Your Location<small>' + esc(s0.name) + ' · ' + FLOORS[s0.floor].name + '</small></span>' + ico('chev-r', 'chev') + '</button>';
    r.steps.forEach((s, i) => { if (s.icon === 'arrive') return;
      const cls = s.icon === 'stairs' ? 'st' : ''; const ic = { straight: 'straight', left: 'left', right: 'right', back: 'uturn', stairs: 'stairs' }[s.icon] || 'straight';
      h += '<button class="dir-row ' + (i === state.step && state.navigating ? 'cur' : '') + '" data-step="' + i + '"><span class="dir-ic ' + cls + '">' + ico(ic) + '</span><span class="dir-t">' + esc(s.text.replace(' (passage not confirmed on the map)', '')) + '<small>' + FLOORS[s.floor].name + (s.unverified ? '</small><small class="warn">Passage not confirmed on the map' : '') + '</small></span>' + ico('chev-r', 'chev') + '</button>'; });
    h += '<button class="dir-row" data-step="' + (r.steps.length - 1) + '"><span class="dir-ic end">' + ico('pin') + '</span><span class="dir-t">You have reached<small>' + esc(r.dest.name) + '</small></span></button>';
    list.innerHTML = h; $('#dir-dist').textContent = (CONFIG.scaleIsEstimate ? '≈ ' : '') + Math.round(r.distanceM) + ' m'; $('#dir-time').textContent = r.minutes + ' min';
  }

  /* ---------- info pages ---------- */
  function unverifiedNotices() {
    const out = [], seen = new Set();
    edges.forEach(e => { if (e.status !== 'unverified') return; const f = nodes[e.a].floor, key = f + e.via; if (seen.has(key)) return; seen.add(key);
      out.push(f === 'gf' ? 'Ground Floor – the north and east corridors meet only at the small East Stairs block; the map does not show a walkable passage through it (affects ICU, General Ward, Emergency, Consultation Room 1 when approached from the west).' : 'First Floor – Room 102 and the Doctors’ Lounge are reached through the East Stairs block; the map does not show that passage clearly.'); });
    return out;
  }
  const INFO = {
    help: () => ['Help & Support', '<div class="card"><b>Getting around</b><br>Search a department, ward or facility, then tap <b>Start Navigation</b>. Tap <b>Directions</b> for every step.</div><div class="card"><b>Correct your location</b><br>Tap any room on the map and choose <b>I’m here</b> – or use <b>From</b> on the route card.</div><div class="card"><b>Step-free routes</b><br>Choose <b>Step-free</b> to avoid stairs and use the wheelchair ramp. If the only way is by stairs you will be told.</div><h4>How routes are checked</h4><p>Routes follow a graph of the corridors, doorways and stairs on your floor plans. Every segment is tested against the map before it is shown, so routes never cut through walls or rooms.</p><p><b>Verified</b> – continuous corridor on the drawing. <b>Route checked</b> – stair or ramp links known from labels. <b>Unconfirmed</b> – shown dashed; please confirm on site.</p>'],
    privacy: () => ['Privacy Policy', '<div class="card">MediPath runs entirely in your browser. It does not use GPS, Bluetooth, Wi-Fi or any positioning hardware, and it sends nothing to a server. Saved locations and preferences stay on your device.</div>'],
    language: () => ['Language', '<div class="card">English is the only language available in this version.</div>'],
    theme: () => ['Theme', '<div class="card">This version uses the light theme only.</div>'],
    hospital: () => { const n = unverifiedNotices(); return ['Hospital Information', '<div class="card"><b>' + esc(CONFIG.hospitalName) + '</b><br>Two floors are mapped: Ground Floor and First Floor. Stairs to the basement and second floor are shown but not mapped.</div><h4>Connections to confirm</h4>' + (n.length ? n.map(x => '<div class="card warn">' + esc(x) + '</div>').join('') : '<div class="card">All connections are verified.</div>') + '<h4>Floor links</h4><div class="card">Main Stairs and East Stairs (beside Room 101) join the two floors. The map shows these by their labels and position.</div><h4>Distances</h4><div class="card">The plans have no scale bar, so distances use an estimated ' + mpp + ' m per map pixel (<code>data/map-data.js</code>).</div>']; },
    about: () => ['About MediPath', '<div class="brand"><h1 class="wordmark"><span>Medi</span><b>Path</b></h1><p>Indoor Navigation</p></div><div class="card"><b>About MediPath</b><br>MediPath helps you navigate through the hospital easily with accurate indoor maps and directions.<br><br>Version 1.0</div>']
  };
  function openInfo(key) { const [t, h] = INFO[key](); state.infoKey = key; state.infoFrom = state.screen === 'home' ? 'home' : 'settings'; $('#info-title').textContent = t; $('#info-body').innerHTML = h; show('info'); }

  /* ------------------------------------------------------------------ map pane UI */
  function renderMapUI() {
    const s = byId[state.startId], d = state.destId ? byId[state.destId] : null, r = state.route;
    $('#map-title').textContent = floorLabel(state.floor); $('#floor-tag').textContent = floorLabel(state.floor);
    main.setFloor(state.floor);
    $('#floor-menu').innerHTML = floorList.map(F => '<button class="floor-opt ' + (F.id === state.floor ? 'on' : '') + '" data-floor="' + F.id + '">' + (F.level === 0 ? 'Ground Floor' : 'Floor ' + F.level) + ' <small style="color:#6f7d79;font-weight:400">· ' + F.name + '</small>' + (F.id === state.floor ? ico('check') : '') + '</button>').join('');
    if (state.screen === 'maps') { renderMapsUI(); return; }
    const dp = $('#dest-pick'); dp.classList.toggle('set', !!d); $('#dest-pick-text').textContent = d ? d.name + (d.code ? ' · ' + d.code : '') + ' · ' + FLOORS[d.floor].name : 'Search destination…';
    $('#from-name').textContent = s.name;
    $('#sheet-empty').hidden = !!d; $('#sheet-route').hidden = !d;
    const note = $('#map-note'); note.hidden = true;
    if (d) {
      $('#sr-name').textContent = d.name; $('#sr-sub').textContent = (d.code ? d.code + ' · ' : '') + FLOORS[d.floor].name;
      $('#sr-time').textContent = r ? r.minutes + ' min' : '–'; $('#sr-dist').textContent = r ? (CONFIG.scaleIsEstimate ? '≈ ' : '') + Math.round(r.distanceM) + ' m' : '–';
      $$('#seg-mode button').forEach(b => b.classList.toggle('on', b.dataset.mode === state.mode));
      const st = $('#route-status'); st.className = 'status';
      if (r) { const v = r.validation;
        if (v.status !== 'unverified') st.classList.add('ok');
        if (v.status === 'verified') st.innerHTML = ico('shield') + '<span>Verified route – follows the corridors drawn on the map.</span>';
        else if (v.status === 'label') st.innerHTML = ico('shield') + '<span>Route checked – corridors verified; the ' + esc(v.labelOnly.join(' and ')) + ' link comes from the map labels.</span>';
        else { st.classList.add('warn'); st.innerHTML = ico('warn') + '<span>Includes a connection the map does not prove (' + esc(v.unverified.join(', ')) + ', shown dashed). Please confirm on site.</span>'; } }
      else if (state.error) { st.classList.add('bad'); st.innerHTML = ico('warn') + '<span>' + esc(state.error.reason) + '</span>'; }
      $('#btn-start').disabled = !r; $('#btn-directions').disabled = !r; $('#btn-save').classList.toggle('on', state.saved.includes(d.id));
    }
    if (!r && state.error) { note.hidden = false; note.innerHTML = '<b>No route</b><br>' + esc(state.error.reason); }
    // chips / pick card
    const chip = $('#map-chip'); chip.hidden = true; chip.dataset.floor = '';
    if (r && r.floors.length > 1 && r.floors.includes(state.floor)) { const other = r.floors.find(f => f !== state.floor); chip.hidden = false; chip.dataset.floor = other; chip.textContent = 'Route continues on ' + FLOORS[other].name + ' →'; }
    const pc = $('#pick-card'), p = state.pickedId && byId[state.pickedId];
    if (p) { pc.hidden = false; pc.innerHTML = '<div class="pc-t"><span><b>' + esc(p.name) + '</b><small>' + esc((p.code ? p.code + ' · ' : '') + p.category + ' · ' + FLOORS[p.floor].name) + '</small></span><button class="icon-btn" data-pc="close" aria-label="Close">' + ico('x') + '</button></div><div class="pc-b">' + (p.id !== state.destId ? '<button class="btn" data-pc="go">Navigate here</button>' : '') + (p.id !== state.startId ? '<button class="btn ghost" data-pc="here">I’m here</button>' : '') + '</div>'; }
    else pc.hidden = true;
    $('#app').classList.toggle('navigating', state.navigating && !!r); syncPause();
    renderNav();
  }

  function maneuver(s) { return { left: 'Turn left', right: 'Turn right', straight: 'Continue straight', back: 'Turn around' }[s.icon] || s.text; }
  function renderNav() {
    const r = state.route; if (!r || !state.navigating) return;
    const steps = r.steps, i = state.step, cur = steps[i], nxt = steps[i + 1];
    const total = steps.reduce((t, s) => t + s.distPx, 0) || 1, done = steps.slice(0, i).reduce((t, s) => t + s.distPx, 0);
    const remain = steps.slice(i).reduce((t, s) => t + s.distPx, 0), remainStairs = steps.slice(i).filter(s => s.icon === 'stairs').length;
    let ic, title, sub;
    if (!nxt) { ic = 'flag'; title = 'You have arrived'; sub = r.dest.name; }
    else if (cur.icon === 'stairs') { ic = 'stairs'; title = cur.text.split(' to the ')[0]; sub = 'to the ' + (cur.text.split(' to the ')[1] || ''); }
    else if (nxt.icon === 'arrive') { ic = 'flag'; title = 'Arrive at ' + r.dest.name; sub = 'in ' + fmtDist(cur.distPx); }
    else if (nxt.icon === 'stairs') { ic = 'stairs'; title = nxt.text.split(' to the ')[0]; sub = 'in ' + fmtDist(cur.distPx); }
    else { ic = { left: 'left', right: 'right', straight: 'straight', back: 'uturn' }[nxt.icon] || 'straight'; title = maneuver(nxt); sub = 'in ' + fmtDist(cur.distPx); }
    $('#nav-banner .nb-ic').innerHTML = ico(ic); $('#nb-title').textContent = title; $('#nb-sub').textContent = sub;
    $('#nc-to').textContent = 'To ' + r.dest.name; $('#nc-meta').textContent = (nxt ? fmtTime(remain, remainStairs) + '  ·  ' + fmtDist(remain) : 'Arrived');
    $('#nc-step').textContent = cur.text.replace(' (passage not confirmed on the map)', '');
    const pct = nxt ? Math.min(99, Math.round(done / total * 100)) : 100; $('#nc-bar').style.width = pct + '%'; $('#nc-pct').textContent = pct + '%';
    $('#btn-prev-step').disabled = i === 0; $('#btn-next-step').disabled = !nxt;
  }


  /* ---------- moving location dot: follows the route edges; Stop / Resume never reset or jump ---------- */
  const DOT_SPEED = CONFIG.walkSpeedMps / CONFIG.metersPerPixel, STAIR_DWELL = 700; // 1× walking speed in map px per second (same speed the ETA uses); ms pause on the stairs
  const move = { raf: 0, token: 0, last: 0 };
  function dotPlace() {
    const r = state.route, P = r.nodes, E = r.edges.length;
    if (state.edgeI >= E) { const n = nodes[P[E]]; state.pos = { floor: n.floor, x: n.x, y: n.y }; return; }
    const e = r.edges[state.edgeI], a = nodes[P[state.edgeI]], b = nodes[P[state.edgeI + 1]];
    if (e.kind === 'stairs' || !e.len) { state.pos = { floor: a.floor, x: a.x, y: a.y }; return; }
    const t = state.along / e.len; state.pos = { floor: a.floor, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  const edgeLen = e => e.kind === 'stairs' ? 0 : e.len;
  function dotTravelled() { const r = state.route; let t = 0; for (let i = 0; i < Math.min(state.edgeI, r.edges.length); i++) t += edgeLen(r.edges[i]); if (state.edgeI < r.edges.length) t += state.along; return t; }
  function stepOfEdge(i) { const st = state.route.steps; if (i >= state.route.edges.length) return st.length - 1; for (let s = 0; s < st.length; s++) if (st[s].nodeIdx <= i && i < st[s].endIdx) return s; return st.length - 1; }
  function syncPause() {
    const b = $('#btn-pause'); if (!b) return; const r = state.route, arrived = !!r && state.edgeI >= r.edges.length;
    b.disabled = !state.navigating || !r || arrived; b.innerHTML = (state.moving ? ico('stop') + 'Stop' : ico('play') + 'Resume'); b.setAttribute('aria-label', state.moving ? 'Stop' : 'Resume');
  }
  function stopLoop() { move.token++; if (move.raf) cancelAnimationFrame(move.raf); move.raf = 0; }
  function startLoop() { // exactly one loop at a time; first frame has dt = 0 so resuming never jumps
    stopLoop(); const t = ++move.token; move.last = 0;
    const tick = ts => { if (t !== move.token) return; if (!state.navigating || !state.route || !state.moving) { move.raf = 0; return; }
      const dt = move.last ? Math.min((ts - move.last) / 1000, 0.1) : 0; move.last = ts; advance(dt); if (t === move.token && state.moving) move.raf = requestAnimationFrame(tick); };
    move.raf = requestAnimationFrame(tick);
  }
  function stopMove() { state.moving = false; stopLoop(); syncPause(); }
  function startMove() { if (!state.route) return; state.edgeI = 0; state.along = 0; state.dwell = 0; state.moving = true; dotPlace(); syncPause(); startLoop(); }
  function advance(dt) {
    const r = state.route, E = r.edges.length; let rem = DOT_SPEED * dt;
    if (state.dwell > 0) { state.dwell -= dt * 1000; if (state.dwell > 0) { dotAfter(); return; } state.edgeI++; state.along = 0; rem = 0; }
    while (rem > 0 && state.edgeI < E) {
      const e = r.edges[state.edgeI];
      if (e.kind === 'stairs') { state.dwell = STAIR_DWELL; break; }
      if (state.along + rem >= e.len) { rem -= e.len - state.along; state.edgeI++; state.along = 0; } else { state.along += rem; rem = 0; }
    }
    dotAfter();
  }
  function dotAfter() {
    const r = state.route, E = r.edges.length; dotPlace();
    const s = stepOfEdge(state.edgeI);
    if (s !== state.step || state.pos.floor !== state.floor) { state.step = s; state.floor = state.pos.floor; renderMapUI(); if (leftScreen() === 'directions') renderDirections(); } // map stays fitted; only the dot moves
    main.onChange();
    const tot = r.edges.reduce((t, e) => t + edgeLen(e), 0) || 1, pct = state.edgeI >= E ? 100 : Math.min(99, Math.round(dotTravelled() / tot * 100));
    $('#nc-bar').style.width = pct + '%'; $('#nc-pct').textContent = pct + '%';
    if (state.edgeI >= E) { state.moving = false; stopLoop(); syncPause(); fitRoute(); } // arrived: dot stays on the destination, map back to its fitted view
  }
  function moveToStep(st) { // user jumped to another step: put the dot at the start of that step, keep run/stopped state
    const E = state.route.edges.length; state.edgeI = Math.min(st.nodeIdx, E); state.along = 0; state.dwell = 0; dotPlace();
    if (state.edgeI >= E) { state.moving = false; stopLoop(); } syncPause();
  }
  function togglePause() {
    if (!state.navigating || !state.route) return;
    if (state.moving) { state.moving = false; stopLoop(); syncPause(); main.onChange(); } // freeze exactly where it is
    else if (state.edgeI < state.route.edges.length) { state.moving = true; syncPause(); startLoop(); } // continue from the same spot
  }

  /* ---------- Map feature: both floor maps, tap to set my location / destination ---------- */
  function mapsRoomAt(floor, p) {
    let best = null, area = Infinity;
    rooms.forEach(r => { if (r.floor !== floor) return; const a = r.rect; if (p.x >= a[0] && p.x <= a[2] && p.y >= a[1] && p.y <= a[3]) { const ar = (a[2] - a[0]) * (a[3] - a[1]); if (ar < area) { area = ar; best = r; } } });
    return best;
  }
  function mapsNearestNode(floor, p) {
    let best = null, bd = Infinity;
    Object.values(nodes).forEach(n => { if (n.floor !== floor || n.type === 'room') return; const d = Math.hypot(n.x - p.x, n.y - p.y); if (d < bd) { bd = d; best = n; } });
    return best;
  }
  function mapsPick(p) {
    const f = main.floor, room = mapsRoomAt(f, p);
    if (state.mapTool === 'loc') {
      let node, label;
      if (room) { node = nodes[room.node]; label = room.name; } else if (Eng.inWalk(f, p)) { node = mapsNearestNode(f, p); label = 'Corridor'; } else { toast('Tap inside a room or corridor.'); return; }
      state.mapLoc = { floor: f, x: p.x, y: p.y, node: node.id, label }; state.mapTool = null;
    } else if (state.mapTool === 'dest') {
      if (!room) { toast('Tap a room to select it as the destination.'); return; }
      state.mapDest = { floor: f, roomId: room.id }; state.mapTool = null;
    } else { toast('Choose “I’m Here” or “Select Destination”, then tap the map.'); return; }
    renderMapUI(); main.onChange();
  }
  function drawMapsMarkers(g, floor, k) {
    const L = state.mapLoc, Dm = state.mapDest;
    if (Dm && Dm.floor === floor) { const rm = byId[Dm.roomId], r = rm.rect; svgEl('rect', { x: r[0], y: r[1], width: r[2] - r[0], height: r[3] - r[1], class: 'room-hit', 'stroke-width': 2 * k }, g); destPin(g, nodes[rm.node], k); }
    if (L && L.floor === floor) startMarker(g, L, k);
  }
  function renderMapsUI() {
    $('#pick-card').hidden = true; $('#map-chip').hidden = true; $('#map-note').hidden = true;
    $$('#seg-floor button').forEach(b => b.classList.toggle('on', b.dataset.floor === state.floor));
    $('#btn-set-loc').classList.toggle('on', state.mapTool === 'loc'); $('#btn-set-dest').classList.toggle('on', state.mapTool === 'dest');
    const L = state.mapLoc, Dm = state.mapDest;
    $('#mp-info').innerHTML = '<div><b>My location:</b> ' + (L ? esc(L.label) + ' · ' + FLOORS[L.floor].name : 'not set') + '</div><div><b>Destination:</b> ' + (Dm ? esc(byId[Dm.roomId].name) + ' · ' + FLOORS[Dm.floor].name : 'not set') + '</div>' +
      '<div>' + (state.mapTool === 'loc' ? 'Tap the map where you are now.' : state.mapTool === 'dest' ? 'Tap the room you want to go to.' : 'Choose a control above, then tap the map.') + '</div>';
    $('#btn-map-start').disabled = !(L && Dm);
  }
  function startFromMaps() {
    const L = state.mapLoc, Dm = state.mapDest; if (!L || !Dm) return;
    const dr = byId[Dm.roomId]; if (L.node === dr.node) { toast('You are already at the destination.'); return; }
    byId.__loc = { id: '__loc', name: 'Your Location', floor: L.floor, category: 'Facility', kind: 'entrance', node: L.node, door: null, rect: [L.x - 1, L.y - 1, L.x + 1, L.y + 1] };
    state.startId = '__loc'; state.destId = Dm.roomId; state.pickedId = null; state.navigating = false; stopMove(); computeRoute();
    if (!state.route) { toast(((state.error && state.error.reason) || 'No route found.').slice(0, 140)); return; }
    state.navFromMaps = true; show('map'); afterRouteChange(true); startNav();
  }

  /* ---------- state mutators ---------- */
  function afterRouteChange(refit) {
    if (state.route) state.floor = byId[state.startId].floor; else if (state.destId) state.floor = byId[state.destId].floor; else state.floor = byId[state.startId].floor;
    renderMapUI(); main.onChange(); if (refit) fitRoute(); if (leftScreen() === 'directions' || state.screen === 'directions') renderDirections();
    $('#notice-dot').hidden = !unverifiedNotices().length;
  }
  function setDest(id, quiet) {
    state.destId = id; state.pickedId = null; state.navigating = false; stopMove(); computeRoute(); afterRouteChange(true); if (state.screen === 'map') show('map');
    if (!quiet && state.error) toast(state.error.reason.slice(0, 120));
  }
  function setStart(id) {
    state.startId = id; state.pickedId = null; const wasNav = state.navigating; computeRoute(); if (!state.route) { state.navigating = false; stopMove(); } afterRouteChange(!wasNav); if (wasNav && state.route) { state.step = 0; startMove(); renderMapUI(); fitRoute(); }
  }
  function setMode(m) { state.mode = m; state.navigating = false; stopMove(); computeRoute(); afterRouteChange(true); }
  function swap() { if (!state.destId) { toast('Choose a destination first.'); return; } const s = state.startId; state.startId = state.destId; state.destId = s; state.navigating = false; stopMove(); computeRoute(); afterRouteChange(true); }
  function setFloor(f) { state.floor = f; renderMapUI(); main.onChange(); fitRoute(); }
  function gotoStep(i) {
    const r = state.route; if (!r) return; state.step = Math.max(0, Math.min(r.steps.length - 1, i)); const st = r.steps[state.step];
    if (state.navigating) moveToStep(st);
    state.floor = st.floor; renderMapUI(); main.onChange(); if (leftScreen() === 'directions') renderDirections();
  }
  function startNav() { if (!state.route) return; state.navigating = true; state.step = 0; state.pickedId = null; state.floor = byId[state.startId].floor; show('map'); startMove(); renderMapUI(); main.onChange(); fitRoute(); }
  function endNav() { stopMove(); state.pos = null; state.navigating = false; state.step = 0; renderMapUI(); main.onChange(); fitRoute(); if (state.navFromMaps) { state.navFromMaps = false; show('maps'); } else if (leftScreen() === 'directions') show(isDesktop() ? 'locations' : 'map'); }
  function toggleSaved(id) { const i = state.saved.indexOf(id); i >= 0 ? state.saved.splice(i, 1) : state.saved.push(id); store.set('saved', state.saved); return i < 0; }

  /* ------------------------------------------------------------------ events */
  function chooseLocation(id) {
    if (state.locMode === 'start') { state.locMode = 'dest'; setStart(id); show('map'); return; }
    if (state.locMode === 'save') { toggleSaved(id) ? toast('Saved ' + byId[id].name) : toast('Removed ' + byId[id].name); state.locMode = 'dest'; show('saved'); return; }
    setDest(id); show('map');
  }
  function bind() {
    document.addEventListener('click', e => {
      const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); return; }
      const inf = e.target.closest('[data-info]'); if (inf) { openInfo(inf.dataset.info); return; }
      const t = e.target.closest('.tab'); if (t) { const k = t.dataset.tab; if (k === 'map') { show('maps'); } else show(k); return; }
      if (!e.target.closest('.floor-wrap')) $('#floor-menu').hidden = true;
    });
    $('#floor-btn').addEventListener('click', () => { const m = $('#floor-menu'); m.hidden = !m.hidden; });
    $('#floor-menu').addEventListener('click', e => { const b = e.target.closest('[data-floor]'); if (b) { $('#floor-menu').hidden = true; setFloor(b.dataset.floor); } });
    $('#map-back').addEventListener('click', () => show(state.screen === 'maps' || isDesktop() ? 'home' : 'locations'));
    $('#loc-back').addEventListener('click', () => { const m = state.locMode; state.locMode = 'dest'; show(m === 'dest' ? 'home' : m === 'save' ? 'saved' : 'map'); });
    $('#info-back').addEventListener('click', () => show(state.infoFrom));
    $('#dir-back').addEventListener('click', () => show(isDesktop() ? 'home' : 'map'));
    $('#btn-notices').addEventListener('click', () => openInfo('hospital'));
    $('#loc-search').addEventListener('input', e => { state.query = e.target.value; renderLocations(); });
    $('#loc-search').addEventListener('keydown', e => { if (e.key === 'Enter') { const b = $('#loc-list .loc-row'); if (b) chooseLocation(b.dataset.id); } });
    $('#chips').addEventListener('click', e => { const c = e.target.closest('.chip'); if (c) { state.group = c.dataset.g; renderLocations(); } });
    $('#btn-filter').addEventListener('click', () => { const o = ['all', ...Object.keys(FLOORS).sort((a, b) => FLOORS[a].level - FLOORS[b].level)]; state.floorFilter = o[(o.indexOf(state.floorFilter) + 1) % o.length]; renderLocations(); toast(state.floorFilter === 'all' ? 'Showing all floors' : 'Showing ' + FLOORS[state.floorFilter].name); });
    $('#loc-list').addEventListener('click', e => { const b = e.target.closest('.loc-row'); if (b) chooseLocation(b.dataset.id); });
    $('#saved-list').addEventListener('click', e => { const x = e.target.closest('[data-remove]'); if (x) { e.stopPropagation(); toggleSaved(x.dataset.remove); renderSaved(); renderMapUI(); return; } const b = e.target.closest('.loc-row'); if (b) { setDest(b.dataset.id); show('map'); } });
    $('#btn-saved-add').addEventListener('click', () => { state.locMode = 'save'; state.query = ''; $('#loc-search').value = ''; show('locations', { keepMode: true }); });
    $('#dest-pick').addEventListener('click', () => { state.locMode = 'dest'; state.query = ''; $('#loc-search').value = ''; show('locations', { keepMode: true }); if (!isDesktop()) { /* mobile: list replaces map */ } });
    $('#btn-find').addEventListener('click', () => { state.locMode = 'dest'; show('locations', { keepMode: true }); });
    $('#from-btn').addEventListener('click', () => { state.locMode = 'start'; state.query = ''; $('#loc-search').value = ''; show('locations', { keepMode: true }); });
    $('#btn-swap').addEventListener('click', swap);
    $('#btn-save').addEventListener('click', () => { if (!state.destId) return; const on = toggleSaved(state.destId); $('#btn-save').classList.toggle('on', on); toast(on ? 'Saved to your locations' : 'Removed from saved'); });
    $('#seg-mode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
    $('#btn-start').addEventListener('click', () => { state.navFromMaps = false; startNav(); }); $('#btn-end').addEventListener('click', endNav); $('#btn-pause').addEventListener('click', togglePause);
    $('#seg-floor').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setFloor(b.dataset.floor); });
    $('#btn-set-loc').addEventListener('click', () => { state.mapTool = state.mapTool === 'loc' ? null : 'loc'; renderMapUI(); });
    $('#btn-set-dest').addEventListener('click', () => { state.mapTool = state.mapTool === 'dest' ? null : 'dest'; renderMapUI(); });
    $('#btn-map-start').addEventListener('click', startFromMaps);
    $('#btn-directions').addEventListener('click', () => { show('directions'); });
    $('#btn-view-route').addEventListener('click', () => { state.navigating = false; show('map'); renderMapUI(); fitRoute(); });
    $('#dir-list').addEventListener('click', e => { const b = e.target.closest('[data-step]'); if (!b || !state.route) return; const i = +b.dataset.step; if (!state.navigating) { state.navigating = true; startMove(); } show('map'); fitRoute(); gotoStep(i); });
    $('#btn-prev-step').addEventListener('click', () => gotoStep(state.step - 1)); $('#btn-next-step').addEventListener('click', () => gotoStep(state.step + 1));
    $('#zoom-in').addEventListener('click', () => main.zoomCentre(1.35)); $('#zoom-out').addEventListener('click', () => main.zoomCentre(1 / 1.35));
    $('#btn-locate').addEventListener('click', () => { const s = byId[state.startId]; if (s.floor !== state.floor) { state.floor = s.floor; renderMapUI(); } main.fitBounds(bounds([nodes[s.node]], 230), 0.9, 1.3); main.userMoved = true; main.onChange(); });
    $('#map-chip').addEventListener('click', e => { const f = e.currentTarget.dataset.floor; if (f) setFloor(f); });
    $('#pick-card').addEventListener('click', e => { const b = e.target.closest('[data-pc]'); if (!b) return; const p = byId[state.pickedId], a = b.dataset.pc;
      if (a === 'close') { state.pickedId = null; renderMapUI(); main.onChange(); } else if (a === 'go') setDest(p.id); else if (a === 'here') { setStart(p.id); toast('Location set to ' + p.name); } });
    $('#sw-acc').setAttribute('aria-pressed', String(store.get('prefAccessible', false)));
    $('#sw-acc').addEventListener('click', e => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); store.set('prefAccessible', on); setMode(on ? 'accessible' : 'fastest'); toast(on ? 'Step-free routes preferred' : 'Fastest routes'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { $('#floor-menu').hidden = true; if (state.pickedId) { state.pickedId = null; renderMapUI(); main.onChange(); } } if (e.shiftKey && e.key.toLowerCase() === 'd' && !/input|textarea/i.test(e.target.tagName)) { state.debug = !state.debug; main.onChange(); toast('Graph debug overlay ' + (state.debug ? 'on' : 'off')); } });
    window.matchMedia('(min-width: 900px)').addEventListener('change', () => { placeSheets(); show(state.screen); });
  }

  /* ------------------------------------------------------------------ boot */
  const bad = Eng.validateGraph(); if (bad.length) console.warn('MediPath: navigation graph has geometry problems', bad);
  $('#hospital-name').textContent = CONFIG.hospitalName;
  $('#notice-dot').hidden = !unverifiedNotices().length;
  placeSheets(); bind(); computeRoute(); state.floor = byId[state.startId].floor;
  show(qs.get('screen') || 'home'); renderMapUI();
  if (state.destId && qs.get('screen') === 'map') afterRouteChange(true);
  const splash = $('#splash'); setTimeout(() => splash.classList.add('hide'), qs.has('nosplash') ? 0 : 1250); if (qs.has('nosplash')) splash.remove();
  window.MediPathApp = { state, show, setDest, setStart, setMode, setFloor, gotoStep, startNav, endNav, computeRoute, renderMapUI };
})();
