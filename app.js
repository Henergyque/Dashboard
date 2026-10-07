'use strict';

/* ===================================================================
   SuccubusStats — Nether Ops Console
   Reskin fidèle de la maquette, branché sur le vrai backend telemetry.
   Toute la logique (WebSocket, endpoints, auto-update, packaging NW.js)
   est conservée ; seul le rendu change.
=================================================================== */

// ---------- NW.js modules (desktop only) ----------
let _nw = null;
try { _nw = { path: require('path'), fs: require('fs'), os: require('os'), https: require('https'), http: require('http'), cp: require('child_process') }; } catch (e) {}

// ---------- Zone / map labels ----------
let ZONE_LABELS = {
  intro: 'Intro / Maison', jeu1: 'Trial 1', jeu2_hub: 'Trial 2 — Hub',
  jeu2_gauche: 'Trial 2 — Left', jeu2_droite: 'Trial 2 — Right', jeu2_arbre: 'Trial 2 — Tree',
  endgame: 'Endgame', speciales: 'Special rooms', unknown: 'Unknown'
};
const ZONE_ORDER = ['intro','jeu1','jeu2_hub','jeu2_gauche','jeu2_droite','jeu2_arbre','endgame','speciales','unknown'];
const MAP_NAMES = {
  1:'Introduction',2:'Maison MC',3:'Chambre Succube - 1',4:'Recollection Room',5:'Chambre Succube - 3',
  6:'Jeu 1-1',7:'Jeu 1-2',8:'Jeu 1-4',9:'Jeu 1-3',10:'Jeu 1-5',11:'Jeu 1-6',12:'Jeu 1-7',
  13:'Chambre MC - Etage',14:'Chambre Succube - 2',15:'Chambre Succube - 4',16:'Chambre Succube - 5',
  17:'Chambre Succube - Final',18:'Jeu 2-1 (Hub)',19:'Jeu 2-2 (Gauche)',20:'Game Over Room',
  21:'Jeu 2-2 (Bonus Gauche)',22:'Jeu 2-2 (Grotte)',23:'Jeu 2-3 (Droite)',24:'Jeu 2-3 (Grotte)',
  25:'Jeu 2-3 (Bonus)',26:'Jeu 2-3 (Sommet)',27:'Jeu 2-3 (Grotte Fin)',28:'Jeu 2-2 (Buissons)',
  29:'Jeu 2-2 (Bonus Buissons)',30:'Jeu 2-4 (Arbre Outside)',31:'Jeu 2-4 (Arbre Inside)',
  32:'Jeu 2-4 (Bonus Rocher)',33:'Jeu 2-3 (Grotte Bonus)',34:'Jeu 2-4 (Bonus Trigger)',35:'Jeu 1-4 (Bonus)'
};

/* Versions publiees. Le selecteur de version suivie liste celles que le serveur
   a deja vues ; sans cette liste, une version qui vient de sortir n'y
   apparaitrait qu'apres les premieres sessions de joueurs. A completer a chaque
   sortie, la plus recente en tete. */
const RELEASES = ['0.5.1', '0.4.1'];
const mapLabel = (id) => MAP_NAMES[id] ? `${MAP_NAMES[id]} (#${id})` : `Map ${id}`;

const LANG_NAMES = {
  en:'Anglais', fr:'Français', ru:'Russe', ko:'Coréen', ja:'Japonais', zh:'Chinois',
  es:'Espagnol', de:'Allemand', pt:'Portugais', it:'Italien', nl:'Néerlandais', pl:'Polonais',
  tr:'Turc', ar:'Arabe', hi:'Hindi', id:'Indonésien', th:'Thaï', vi:'Vietnamien', uk:'Ukrainien',
  cs:'Tchèque', sv:'Suédois', ro:'Roumain', hu:'Hongrois', el:'Grec', fi:'Finnois', da:'Danois',
  no:'Norvégien', nb:'Norvégien', fa:'Persan', hr:'Croate', ms:'Malais', sl:'Slovène', sk:'Slovaque',
  bg:'Bulgare', sr:'Serbe', he:'Hébreu', ca:'Catalan', et:'Estonien', lv:'Letton', lt:'Lituanien',
  is:'Islandais', ga:'Irlandais', af:'Afrikaans', bn:'Bengali', ta:'Tamoul', ur:'Ourdou',
  tl:'Philippin', fil:'Philippin', unknown:'Inconnu'
};

const PLATFORMS = [
  { key:'win32',   name:'Windows', color:'linear-gradient(180deg,#ff5e97,#d92665)' },
  { key:'android', name:'Android', color:'linear-gradient(180deg,#7dffc4,#27b578)' },
  { key:'darwin',  name:'macOS',   color:'linear-gradient(180deg,#ffd98a,#d99b2f)' },
  { key:'linux',   name:'Linux',   color:'linear-gradient(180deg,#b98aff,#7c3aed)' }
];

const APP_VERSION = (function () {
  try {
    if (_nw) {
      const vf = _nw.path.join(_nw.path.dirname(process.execPath), 'package.nw', '.sg_version');
      if (_nw.fs.existsSync(vf)) return _nw.fs.readFileSync(vf, 'utf8').trim();
    }
  } catch (e) {}
  try { return require('./package.json').version; } catch (e) {}
  return '1.0.0';
})();
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// ---------- Config ----------
function loadCfg() { try { return JSON.parse(localStorage.getItem('cfg') || '{}'); } catch (e) { return {}; } }
function saveCfg(c) { localStorage.setItem('cfg', JSON.stringify(c)); }
let cfg = loadCfg();

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtN = (n) => (n | 0).toLocaleString('en-US');
function durShort(ms) {
  const s = Math.floor((ms || 0) / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${h}h`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}
// « il y a » compact, pour les colonnes étroites (retardataires, morts)
function agoShort(ts) {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ---------- State ----------
let ws = null, reconnectTimer = null;
let lastRecord = 0, lastWsTs = 0;
let lastLiveSnapshot = null;
let currentTab = 'live';
let ccRange = '24h', npRange = 7;
let zoneEditMode = false;
let lastReportCount = 0, _reportCountInitialized = false;
let currentAnnouncementData = null;
const DISMISSED_ANNOUNCEMENT_KEY = 'dismissedAnnouncementId';
const RANGE_MS = { '24h': 24*3600*1000, '7d': 7*24*3600*1000, '30d': 30*24*3600*1000 };
const BUCKET_MS = { '24h': 5*60*1000, '7d': 30*60*1000, '30d': 2*3600*1000 };
const counts = { online: 0, record: 0, unique: 0, today: 0 };
let onlineOnceReported = false;

// ===================================================================
//  API
// ===================================================================
async function api(path) {
  if (!cfg.url || !cfg.token) return null;
  const res = await fetch(cfg.url.replace(/\/+$/, '') + path, { headers: { 'Authorization': 'Bearer ' + cfg.token } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// ===================================================================
//  SVG CHARTS (port du buildChart de la maquette)
// ===================================================================
function smoothPath(pts) {
  if (pts.length < 3) return 'M' + pts.map(p => p.join(' ')).join(' L');
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i-1] || pts[i], p1 = pts[i], p2 = pts[i+1], p3 = pts[i+2] || p2;
    const c1 = [p1[0] + (p2[0]-p0[0])/6, p1[1] + (p2[1]-p0[1])/6];
    const c2 = [p2[0] - (p3[0]-p1[0])/6, p2[1] - (p3[1]-p1[1])/6];
    d += `C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
function buildChartSVG(id, vals, labels, color, glowColor, h, zeroBase) {
  if (!vals || vals.length === 0) {
    return `<svg viewBox="0 0 1000 ${h}" style="width:100%;height:auto;display:block"><text x="500" y="${h/2}" text-anchor="middle" fill="#6f5a80" font-size="26" font-family="Sora">loading…</text></svg>`;
  }
  if (vals.length === 1) vals = [vals[0], vals[0]];
  const W = 1000, padL = 52, padR = 20, padT = 16, padB = 34;
  const mx = Math.max(...vals);
  const lo = Math.min(...vals);
  let mn = zeroBase ? 0 : lo * 0.86;
  let top = mx * 1.06;
  /* Courbe parfaitement plate : etaler l'echelle autour de la valeur ferait
     apparaitre des graduations que personne n'a jamais atteintes (un axe
     "6, 7" pour une courbe constante a 7). On la serre sur la seule valeur. */
  if (lo === mx && !zeroBase) { mn = mx - 0.5; top = mx + 0.5; }
  if (top <= mn) top = mn + 1;
  const vdenom = Math.max(1, vals.length - 1);
  const ldenom = Math.max(1, labels.length - 1);
  const X = i => padL + (i / vdenom) * (W - padL - padR);
  const Y = v => padT + (1 - (v - mn) / (top - mn)) * (h - padT - padB);
  const pts = vals.map((v, i) => [X(i), Y(v)]);
  const line = smoothPath(pts);
  const area = line + `L${X(vals.length-1).toFixed(1)} ${h-padB}L${padL} ${h-padB}Z`;
  /* Sur une plage etroite — tout le monde a 1 joueur — les quatre graduations
     arrondissaient a la meme valeur et l'axe affichait "1 1 1 1". On ne garde
     que les valeurs entieres distinctes. */
  let ticks;
  if (lo === mx) {
    // courbe plate : une seule graduation, sur la valeur reelle
    ticks = [mx];
  } else {
    ticks = [0,1,2,3].map(i => mn + ((top - mn) * i) / 3);
    const seen = new Set();
    ticks = ticks.filter((tv) => {
      const k = Math.round(tv);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  const last = pts[pts.length - 1];
  let svg = `<svg viewBox="0 0 ${W} ${h}" style="width:100%;height:auto;display:block;overflow:visible">`;
  svg += `<defs><linearGradient id="g${id}" x1="0" y1="0" x2="0" y2="1">`;
  svg += `<stop offset="0%" stop-color="${color}" stop-opacity="0.34"></stop>`;
  svg += `<stop offset="100%" stop-color="${color}" stop-opacity="0"></stop></linearGradient></defs>`;
  ticks.forEach((tv, i) => {
    svg += `<line x1="${padL}" x2="${W-padR}" y1="${Y(tv).toFixed(1)}" y2="${Y(tv).toFixed(1)}" stroke="rgba(255,255,255,.06)" stroke-width="1"${i===0?'':' stroke-dasharray="3 6"'}></line>`;
    svg += `<text x="${padL-10}" y="${(Y(tv)+8).toFixed(1)}" text-anchor="end" fill="#8a719c" font-size="24" font-family="Sora">${Math.round(tv).toLocaleString('en-US')}</text>`;
  });
  svg += `<path d="${area}" fill="url(#g${id})" style="animation:chartFade 1.4s .55s both"></path>`;
  svg += `<path d="${line}" fill="none" stroke="${glowColor}" stroke-width="9" stroke-linecap="round" opacity="0.22" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1;animation:chartDraw 1.8s cubic-bezier(.6,0,.3,1) forwards"></path>`;
  svg += `<path d="${line}" fill="none" stroke="${color}" stroke-width="3.4" stroke-linecap="round" pathLength="1" style="stroke-dasharray:1;stroke-dashoffset:1;animation:chartDraw 1.8s cubic-bezier(.6,0,.3,1) forwards"></path>`;
  svg += `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="7" fill="none" stroke="${color}" stroke-width="2" style="animation:endPulse 2s 1.9s ease-out infinite"></circle>`;
  svg += `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="5.5" fill="${color}" style="filter:drop-shadow(0 0 8px ${color});animation:chartFade .4s 1.7s both"></circle>`;
  labels.forEach((lb, i) => {
    const x = padL + (i / ldenom) * (W - padL - padR);
    const anchor = i === 0 ? 'start' : i === labels.length-1 ? 'end' : 'middle';
    svg += `<text x="${x.toFixed(1)}" y="${h-8}" text-anchor="${anchor}" fill="#8a719c" font-size="23" font-family="Sora">${esc(lb)}</text>`;
  });
  svg += `</svg>`;
  return svg;
}
function sampleLabels(points, n, fmt) {
  if (!points.length) return [];
  const out = [];
  const count = Math.min(n, points.length);
  for (let i = 0; i < count; i++) {
    const idx = count === 1 ? points.length - 1 : Math.round(i / (count - 1) * (points.length - 1));
    out.push(fmt(points[idx], idx === points.length - 1));
  }
  return out;
}

// ===================================================================
//  RENDER — Live tab
// ===================================================================
const STAT_CARDS = [
  { id:'online', label:'Players Online', numTint:'#ffb3cd', rune:'linear-gradient(135deg,#5fffb2,#e9b95f)', runeGlow:'rgba(95,255,178,.5)', subColor:'#7dffc4', sub:'online now' },
  { id:'record', label:'Record Concurrent', numTint:'#c9a2ff', rune:'linear-gradient(135deg,#ff3d81,#a06bff)', runeGlow:'rgba(255,61,129,.5)', subColor:'#9d84ad', sub:'all-time peak' },
  { id:'unique', label:'Unique Players', numTint:'#ffd98a', rune:'linear-gradient(135deg,#a06bff,#e9b95f)', runeGlow:'rgba(160,107,255,.5)', subColor:'#9d84ad', sub:'all-time total' },
  { id:'today',  label:'Players Today', numTint:'#ffb3cd', rune:'linear-gradient(135deg,#e9b95f,#ff3d81)', runeGlow:'rgba(233,185,95,.5)', subColor:'#7dffc4', sub:'since midnight' }
];
function buildStatCards() {
  const el = $('statCards');
  if (!el) return;
  el.innerHTML = STAT_CARDS.map(c => `
    <div class="stat-card" data-card="${c.id}">
      <div class="glowfollow"></div>
      <div class="stat-rune" style="background:${c.rune};box-shadow:0 0 12px ${c.runeGlow}"></div>
      <div class="stat-label">${c.label}</div>
      <div class="stat-value" data-value="${c.id}" style="background:linear-gradient(180deg,#ffffff 20%,${c.numTint} 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;text-shadow:0 0 38px ${c.runeGlow}">—</div>
      <div class="stat-sub" style="color:${c.subColor}">${c.sub}</div>
    </div>`).join('');
  // 3D tilt
  el.querySelectorAll('.stat-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', (x*100)+'%');
      card.style.setProperty('--my', (y*100)+'%');
      card.style.transform = `perspective(900px) rotateX(${((0.5-y)*5).toFixed(2)}deg) rotateY(${((x-0.5)*7).toFixed(2)}deg) translateY(-3px)`;
    });
    card.addEventListener('mouseleave', () => { card.style.transform = ''; });
  });
}
const _tweens = {};
function setStat(id, target) {
  const el = document.querySelector(`.stat-value[data-value="${id}"]`);
  if (!el) return;
  const start = _tweens[id] != null ? _tweens[id] : target;
  const t0 = performance.now(), dur = 650;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    const val = Math.round(start + (target - start) * e);
    el.textContent = fmtN(val);
    if (k < 1) requestAnimationFrame(step); else _tweens[id] = target;
  };
  _tweens[id] = start;
  requestAnimationFrame(step);
}
function updateStatCards() {
  setStat('online', counts.online);
  setStat('record', counts.record);
  setStat('unique', counts.unique);
  setStat('today', counts.today);
}

function renderLive(live) {
  if (!live) return;
  lastLiveSnapshot = live;
  counts.online = live.totalOnline | 0;
  counts.record = live.record | 0;
  counts.unique = live.totalUniques | 0;
  updateStatCards();

  const badge = $('navOnline');
  if (badge) badge.textContent = fmtN(counts.online);

  if (live.record > lastRecord && lastRecord > 0) {
    const el = document.querySelector('.stat-value[data-value="record"]');
    if (el) { el.style.transition = 'filter .3s'; el.style.filter = 'brightness(1.6)'; setTimeout(() => el.style.filter = '', 900); }
  }
  lastRecord = live.record;

  if (!zoneEditMode) renderZones(live.byZone || {});
}

function renderZones(byZone) {
  const list = $('zoneList');
  if (!list) return;
  const max = Math.max(1, ...ZONE_ORDER.map(z => byZone[z] || 0));
  let total = 0;
  for (const z of ZONE_ORDER) {
    const c = byZone[z] || 0; total += c;
    const w = Math.round((c / max) * 100);
    // Update rows IN PLACE (never rebuild the HTML) so the flowing bar
    // animation is not restarted on every live snapshot.
    let row = list.querySelector('[data-zone="' + z + '"]');
    if (!row) {
      row = document.createElement('div');
      row.dataset.zone = z;
      row.innerHTML =
        '<div class="zone-row-label"><span class="zn" style="color:#e9d5f0"></span>' +
        '<span class="zc" style="font-variant-numeric:tabular-nums;color:#ffb3cd;font-weight:600"></span></div>' +
        '<div class="zone-bar-track"><div class="zone-bar-fill"><div class="sheen2"></div><div class="tip"></div></div></div>';
      list.appendChild(row);
    }
    row.querySelector('.zn').textContent = ZONE_LABELS[z] || z;
    row.querySelector('.zc').textContent = c;
    row.querySelector('.zone-bar-fill').style.width = w + '%';
  }
  const zt = $('zoneTotal'), zc = $('zoneCount');
  if (zt) zt.textContent = fmtN(total);
  if (zc) zc.textContent = ZONE_ORDER.length;
}

function renderConcurrent(points) {
  points = points || [];
  const vals = points.map(p => p.count | 0);
  /* Tant que l'historique tient dans une seule journee — au lendemain d'une
     sortie, par exemple — afficher la date donnait sept fois le meme jour.
     On bascule alors sur l'heure, quelle que soit la plage demandee. */
  const days = new Set(points.map(p => new Date(p.bucket).toDateString()));
  const sameDay = days.size <= 1;
  const labels = sampleLabels(points, 7, (p, isLast) => {
    if (isLast) return 'now';
    const d = new Date(p.bucket);
    return (ccRange === '24h' || sameDay)
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: '2-digit' });
  });
  $('ccChart').innerHTML = buildChartSVG('cc' + ccRange + Date.now(), vals, labels, '#ff3d81', '#a06bff', 300, false);
}

function renderNewPlayers(data) {
  const points = (data && data.points) || [];
  const vals = points.map(p => p.count | 0);
  const labels = sampleLabels(points, 5, (p, isLast) => {
    if (isLast) return 'today';
    const d = new Date(p.day + 'T00:00:00');
    return d.toLocaleDateString([], { month: 'short', day: '2-digit' });
  });
  $('npChart').innerHTML = buildChartSVG('np' + npRange + Date.now(), vals, labels, '#e9b95f', '#ff9d5f', 230, true);
}

function renderPlatforms(data) {
  if (!data) return;
  const total = data.total || {};
  const rows = PLATFORMS.map(p => ({ ...p, n: total[p.key] || 0 })).filter(p => p.n > 0);
  const sum = rows.reduce((a, p) => a + p.n, 0) || 1;
  rows.forEach(p => p.pct = Math.round(p.n / sum * 1000) / 10);
  const bar = $('platformBar'), listEl = $('platformList');
  if (bar) bar.innerHTML = rows.map(p => `<div style="width:${p.pct}%;background:${p.color};box-shadow:inset 0 0 12px rgba(255,255,255,.15);transition:width 1.2s cubic-bezier(.22,1,.36,1)"></div>`).join('');
  if (listEl) listEl.innerHTML = rows.map(p => `
    <div style="display:flex;align-items:center;gap:9px;font-size:12px">
      <span style="width:9px;height:9px;border-radius:3px;background:${p.color};flex:none"></span>
      <span style="color:#cdb8d8;flex:1">${p.name}</span>
      <span style="font-variant-numeric:tabular-nums;color:#f6ecf7;font-weight:600">${p.pct}%</span>
    </div>`).join('') || '<span style="color:#6f5a80;font-size:12px">no data yet</span>';
}

// Palette tournante : le nombre de versions n'est pas connu d'avance, contrairement
// aux plateformes qui ont chacune leur couleur fixe.
const VERSION_COLORS = [
  'linear-gradient(180deg,#ff5e97,#d92665)',
  'linear-gradient(180deg,#b98aff,#7c3aed)',
  'linear-gradient(180deg,#ffd98a,#d99b2f)',
  'linear-gradient(180deg,#7dffc4,#27b578)',
  'linear-gradient(180deg,#7ec8ff,#2b7fd4)'
];

function renderVersions(data) {
  if (!data) return;
  const total = data.total || {}, online = data.online || {};
  // tri décroissant : la version la plus répandue en tête, comme les plateformes
  const rows = Object.entries(total).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const sum = rows.reduce((s, [, n]) => s + n, 0) || 1;

  const latestEl = $('verLatest');
  if (latestEl) latestEl.textContent = data.latest || '—';

  const bar = $('versionBar'), listEl = $('versionList');
  if (bar) bar.innerHTML = rows.map(([v, n], i) =>
    `<div style="width:${Math.round(n / sum * 1000) / 10}%;background:${VERSION_COLORS[i % VERSION_COLORS.length]};box-shadow:inset 0 0 12px rgba(255,255,255,.15);transition:width 1.2s cubic-bezier(.22,1,.36,1)" title="${esc(v)}"></div>`
  ).join('');

  if (listEl) listEl.innerHTML = rows.map(([v, n], i) => {
    const pct = Math.round(n / sum * 1000) / 10;
    const live = online[v] || 0;
    return `<div style="display:flex;align-items:center;gap:9px;font-size:12px">
      <span style="width:9px;height:9px;border-radius:3px;background:${VERSION_COLORS[i % VERSION_COLORS.length]};flex:none"></span>
      <span style="color:#cdb8d8;flex:1">${esc(v)}${v === data.latest ? ' <span style="color:#7dffc4;font-size:10px">· latest</span>' : ''}</span>
      ${live ? `<span style="font-size:10px;color:#7dffc4">${live} live</span>` : ''}
      <span style="font-variant-numeric:tabular-nums;color:#f6ecf7;font-weight:600">${fmtN(n)}</span>
      <span style="font-variant-numeric:tabular-nums;color:#9d84ad;width:42px;text-align:right">${pct}%</span>
    </div>`;
  }).join('') || '<span style="color:#6f5a80;font-size:12px">no data yet</span>';

  /* Les retardataires : c'est la liste à pinger vers itch quand une MAJ sort.
     Le pseudo Discord n'est là que pour ceux qui ont lié leur compte ; sinon on
     retombe sur l'UUID tronqué, qui ne sert qu'à distinguer les lignes. */
  const lag = data.laggards || [];
  const cnt = $('lagCount'), lagEl = $('lagList');
  if (cnt) cnt.textContent = fmtN(lag.length);
  if (lagEl) lagEl.innerHTML = lag.map(p => {
    const who = p.discord_username
      ? `<span style="color:#d6c2f5">${esc(p.discord_username)}</span>`
      : `<span class="mono" style="color:#6f5a80">${esc(String(p.player_id).slice(0, 8))}</span>`;
    return `<div style="display:flex;align-items:center;gap:8px;font-size:11.5px">
      ${who}
      <span style="flex:1"></span>
      <span class="lang-pill" style="padding:2px 8px;font-size:10px">${esc(p.version)}</span>
      <span style="color:#6f5a80;font-size:10px;width:58px;text-align:right">${agoShort(p.last_seen)}</span>
    </div>`;
  }).join('') || '<span style="color:#6f5a80;font-size:12px">everyone is up to date</span>';
}

function renderSessionStats(data) {
  if (!data) return;
  const a = $('sessAvg'), m = $('sessMedian'), l = $('sessLongest'), tot = $('sessTotal');
  if (!data.total_sessions) { if (a) a.textContent = '—'; if (m) m.textContent = '—'; if (l) l.textContent = '—'; if (tot) tot.textContent = '—'; return; }
  if (a) a.textContent = durShort(data.avg_ms);
  if (m) m.textContent = durShort(data.median_ms);
  if (l) l.textContent = durShort(data.longest_ms);
  if (tot) tot.textContent = Math.round((data.total_ms || 0) / 3600000).toLocaleString('en-US') + 'h';
}

function renderLanguages(data) {
  const langs = (data && data.languages) || {};
  const all = Object.entries(langs).filter(([, n]) => n > 0);

  /* "unknown" regroupe les sessions ouvertes avant que le serveur ne sache
     stocker la langue choisie dans le jeu. Les afficher noyait tout le reste
     sous une barre grise ; les compter dans le total ferait mentir les
     pourcentages dans l'autre sens, d'ou la ligne de couverture plus bas. */
  const entries = all.filter(([code]) => code !== 'unknown').sort((a, b) => b[1] - a[1]);

  const total = entries.reduce((s, [, n]) => s + n, 0) || 1;
  const grand = all.reduce((s, [, n]) => s + n, 0);
  const max = entries.length ? entries[0][1] : 1;
  const regionEl = $('regionList'), langEl = $('langList');

  if (regionEl) regionEl.innerHTML = entries.slice(0, 5).map(([code, n]) => {
    const name = LANG_NAMES[code] || code.toUpperCase();
    const pct = Math.round(n / total * 100);
    const w = Math.round(n / max * 100);
    return `<div class="region-row"><span class="region-name">${esc(name)}</span><div class="region-track"><div class="region-fill" style="width:${w}%"></div></div><span class="region-pct">${pct}%</span></div>`;
  }).join('') || '<span style="color:#6f5a80;font-size:12px">no language reported yet</span>';

  if (langEl) {
    const pills = entries.slice(0, 10).map(([code, n]) => {
      const pct = Math.round(n / total * 100);
      return `<span class="lang-pill">${esc(code.toUpperCase())} <span>${pct}%</span></span>`;
    }).join('');
    // sans ce rappel, 3 joueurs francophones sur 5000 afficheraient "FR 100%"
    const hidden = grand - entries.reduce((s, [, n]) => s + n, 0);
    const note = hidden > 0
      ? `<div style="width:100%;font-size:10px;color:#6f5a80;margin-top:6px">based on ${fmtN(grand - hidden)} of ${fmtN(grand)} players · ${fmtN(hidden)} reported none</div>`
      : '';
    langEl.innerHTML = pills + note;
  }
}

function renderDropoff(d) {
  const fill = (el, list, labeller) => {
    if (!el) return;
    const totalExits = (list || []).reduce((a, r) => a + (r.count | 0), 0) || 1;
    if (!list || !list.length) { el.innerHTML = '<div style="color:#6f5a80;font-size:12px;padding:8px 2px">no data yet</div>'; return; }
    el.innerHTML = list.map((r, i) => {
      const pct = Math.round(r.count / totalExits * 1000) / 10;
      return `<div class="drop-row"><span class="drop-i">${i+1}</span><span class="drop-name">${esc(labeller(r.key))}</span><span class="drop-exits">${r.count}</span><span class="drop-pct">${pct}%</span></div>`;
    }).join('');
  };
  fill($('dropZones'), d.byZone || [], k => ZONE_LABELS[k] || k);
  fill($('dropMaps'), d.byMap || [], k => mapLabel(parseInt(k, 10)));
}

// ---------- Zone editor (label editing → PUT /v1/admin/zones) ----------
function openZoneEditor() {
  zoneEditMode = true;
  const panel = $('zoneEditPanel'), list = $('zoneList'), btn = $('zoneEditBtn');
  panel.innerHTML = ZONE_ORDER.map(k => `
    <div style="display:flex;gap:8px;align-items:center">
      <span style="width:74px;flex:none;font-size:10px;color:#6f5a80;font-family:ui-monospace,monospace;overflow:hidden;text-overflow:ellipsis">${k}</span>
      <input class="field" data-zone="${k}" value="${esc(ZONE_LABELS[k] || k)}" style="flex:1;min-width:0;padding:8px 11px;font-size:12px">
    </div>`).join('');
  panel.classList.remove('hidden');
  list.classList.add('hidden');
  btn.textContent = 'DONE'; btn.classList.add('on');
}
async function closeZoneEditorAndSave() {
  const panel = $('zoneEditPanel'), list = $('zoneList'), btn = $('zoneEditBtn');
  const inputs = panel.querySelectorAll('input[data-zone]');
  const labels = {};
  inputs.forEach(inp => labels[inp.dataset.zone] = inp.value.trim());
  try {
    if (cfg.url && cfg.token) {
      const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/admin/zones', {
        method: 'PUT',
        headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(labels)
      });
      if (res.ok) { const j = await res.json(); ZONE_LABELS = Object.assign(ZONE_LABELS, j.labels || labels); }
    }
  } catch (e) { /* ignore */ }
  zoneEditMode = false;
  panel.classList.add('hidden'); list.classList.remove('hidden');
  btn.textContent = 'EDIT ZONES'; btn.classList.remove('on');
  if (lastLiveSnapshot) renderZones(lastLiveSnapshot.byZone || {});
  refreshDropoff();
}

// ===================================================================
//  FETCHERS
// ===================================================================
async function fetchZoneLabels() {
  try {
    const data = await api('/v1/admin/zones');
    if (data && data.labels) {
      ZONE_LABELS = Object.assign(ZONE_LABELS, data.labels);
      if (lastLiveSnapshot && !zoneEditMode) renderZones(lastLiveSnapshot.byZone || {});
    }
  } catch (e) {}
}
async function fetchPlatforms() { try { renderPlatforms(await api('/v1/stats/platforms')); } catch (e) {} }
async function fetchVersions() { try { renderVersions(await api('/v1/stats/versions')); } catch (e) {} }
async function fetchSessionStats() { try { renderSessionStats(await api('/v1/stats/sessions')); } catch (e) {} }
async function fetchLanguages() { try { renderLanguages(await api('/v1/stats/languages')); } catch (e) {} }
async function fetchToday() {
  try { const d = await api('/v1/stats/today'); if (d && d.today != null) { counts.today = d.today; setStat('today', counts.today); } } catch (e) {}
}
// depuis toujours (version suivie) : 24 h ne montrait que les joueurs du jour
async function refreshDropoff() { try { renderDropoff(await api('/v1/stats/dropoff?rangeMs=all')); } catch (e) {} }
async function refreshConcurrent() {
  try { renderConcurrent(await api(`/v1/stats/concurrent?rangeMs=${RANGE_MS[ccRange]}&bucketMs=${BUCKET_MS[ccRange]}`)); } catch (e) {}
}
async function refreshNewPlayers() { try { renderNewPlayers(await api(`/v1/stats/newplayers?days=${npRange}`)); } catch (e) {} }

// ===================================================================
//  ANNOUNCEMENTS
// ===================================================================
function renderActiveAnnouncement(a) {
  currentAnnouncementData = a || null;
  const t = $('activeTitle'), m = $('activeMessage'), ago = $('activeAgo'), tags = $('activeTags');
  const impr = $('reachImpressions'), onl = $('reachOnline'), clk = $('reachClicks'), ctr = $('reachCtr');
  if (onl) onl.textContent = fmtN(counts.online);
  if (!a || !a.title) {
    if (t) t.textContent = '— no active announcement —';
    if (m) m.textContent = '';
    if (ago) ago.textContent = 'none';
    if (tags) tags.innerHTML = '';
    if (impr) impr.textContent = '—';
    if (clk) clk.textContent = '—';
    if (ctr) ctr.textContent = '';
    return;
  }
  if (t) t.textContent = a.title;
  if (m) m.textContent = a.body || '';
  if (ago) ago.textContent = 'active';
  if (impr) impr.textContent = a.viewCount != null ? fmtN(a.viewCount) : '—';
  /* Clics sur « Voir les détails » : dit si mettre un lien Patreon / Itch dans
     une annonce sert à quelque chose. Sans lien, il n'y a rien à cliquer. */
  if (clk) clk.textContent = a.url ? fmtN(a.clickCount || 0) : 'no link';
  if (ctr) ctr.textContent = a.url && a.viewCount ? Math.round((a.clickCount || 0) / a.viewCount * 1000) / 10 + '% of views' : '';
  if (tags) {
    let h = '';
    if (a.version) h += `<span style="padding:4px 11px;border-radius:16px;font-size:10.5px;background:rgba(160,107,255,.12);border:1px solid rgba(160,107,255,.3);color:#d6c2f5">min v${esc(a.version)}</span>`;
    if (a.url) h += `<span style="padding:4px 11px;border-radius:16px;font-size:10.5px;background:rgba(233,185,95,.10);border:1px solid rgba(233,185,95,.3);color:#ffd98a">${esc(a.url.replace(/^https?:\/\//,''))}</span>`;
    tags.innerHTML = h;
  }
}
function populateAnnounceForm() {
  const a = currentAnnouncementData;
  if ($('annTitle')) $('annTitle').value = a && a.title || '';
  if ($('annBody')) $('annBody').value = a && a.body || '';
  if ($('annUrl')) $('annUrl').value = a && a.url || '';
  if ($('annVersion')) $('annVersion').value = a && a.version || '';
}
async function fetchAnnouncement() {
  try {
    const data = await api('/v1/announcement');
    const a = data && data.announcement || null;
    renderActiveAnnouncement(a);
    if (currentTab === 'announce') populateAnnounceForm();
  } catch (e) {}
}
async function publishAnnouncement() {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  const title = ($('annTitle').value || '').trim();
  const body = ($('annBody').value || '').trim();
  if (!title || !body) return alert('Title and message are required.');
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/announcement', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, body, url: ($('annUrl').value || '').trim() || undefined, version: ($('annVersion').value || '').trim() || undefined })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    renderActiveAnnouncement(j.announcement || null);
    const toast = $('annToast'); if (toast) { toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 4000); }
  } catch (e) { alert('Unable to publish announcement. Check URL/token.'); }
}
async function deleteAnnouncement() {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  if (!confirm('Delete the current active announcement?')) return;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/announcement', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + cfg.token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    renderActiveAnnouncement(null);
    populateAnnounceForm();
  } catch (e) { alert('Unable to delete announcement.'); }
}

// ===================================================================
//  GAMEPLAY — death map, enemy ranking, endings
// ===================================================================
let _mapIndex = null;          // index.json du jeu de cartes courant
let _mapDir = null;            // dossier de ce jeu de cartes ('maps/' ou 'maps/0.4.1/')
let _deathData = null;         // dernière réponse de /v1/stats/deaths
let _deathMapId = null;        // carte affichée
let _trackedVersion = null;    // version suivie, lue sur le serveur

/* Fonds de carte par version du jeu. Les coordonnées des captures sont
   relevées sur les cartes de LEUR version : plusieurs cartes ont changé de
   taille en 0.5.1 (6, 11, 12, 22), et des croix 0.4.1 posées sur un fond 0.5.1
   tomberaient à côté. maps/ porte la dernière version (et sert pour « toutes
   versions ») ; chaque version précédente garde ses rendus dans maps/<version>/. */
const MAP_SETS = { '0.4.1': 'maps/0.4.1/' };
const mapDir = () => MAP_SETS[_trackedVersion] || 'maps/';

const ENDING_LABELS = { chad: 'Chad Ending', gameover_jeu1: 'Game Over — Trial 1', gameover_jeu2: 'Game Over — Trial 2' };
// gameover_jeu3/4/5 arriveront tout seuls : le libellé retombe sur un formatage générique
function endingLabel(k) {
  if (ENDING_LABELS[k]) return ENDING_LABELS[k];
  const m = /^gameover_jeu(\d+)$/.exec(k);
  return m ? `Game Over — Trial ${m[1]}` : k;
}
const ENDING_COLORS = {
  chad: 'linear-gradient(180deg,#7dffc4,#27b578)',
  gameover_jeu1: 'linear-gradient(180deg,#ff5e97,#d92665)',
  gameover_jeu2: 'linear-gradient(180deg,#b98aff,#7c3aed)'
};

async function loadMapIndex() {
  const dir = mapDir();
  if (_mapIndex !== null && _mapDir === dir) return _mapIndex;
  try {
    const res = await fetch(dir + 'index.json');
    _mapIndex = res.ok ? await res.json() : { tileSize: 48, maps: {} };
  } catch (e) { _mapIndex = { tileSize: 48, maps: {} }; }
  _mapDir = dir;
  return _mapIndex;
}

function renderDeaths(data) {
  if (!data) return;
  _deathData = data;

  const totalEl = $('deathTotal');
  if (totalEl) totalEl.textContent = fmtN(data.total || 0);
  const fatalEl = $('deathFatal');
  if (fatalEl) fatalEl.textContent = fmtN(data.fatalTotal || 0);

  /* Classement des ennemis — le « counter de mort ». Il porte sur la carte
     affichée (le serveur filtre avec ?mapId=) et le pourcentage est la PART des
     captures de cette carte. Avant, chaque ligne était divisée par la première :
     le leader affichait donc toujours 100 %, d'où « Oneira - Gameplay 100 % ». */
  const scopeTotal = data.scopeTotal || data.total || 0;
  const share = (n) => scopeTotal ? (Math.round(n / scopeTotal * 1000) / 10) + '%' : '—';
  const scopeEl = $('enemyScope');
  if (scopeEl) scopeEl.textContent = data.mapId != null
    ? 'share of the ' + fmtN(scopeTotal) + ' captures on ' + mapLabel(data.mapId)
    : 'share of all ' + fmtN(scopeTotal) + ' captures';
  const enemies = data.byEnemy || [];
  const enemyEl = $('enemyList');
  if (enemyEl) enemyEl.innerHTML = enemies.slice(0, 12).map((r, i) => `
    <div class="drop-row">
      <span class="drop-i">${i + 1}</span>
      <span class="drop-name">${esc(r.enemy)}</span>
      <span class="drop-exits">${fmtN(r.count)}</span>
      <span class="drop-pct">${share(r.count)}</span>
    </div>`).join('') || '<div style="color:#6f5a80;font-size:12px;padding:8px 2px">no capture on this map</div>';

  /* Classement de l'ennemi précis. L'identifiant affiché est « map#event » :
     l'id d'événement n'est unique qu'au sein d'une carte, donc seul le couple
     désigne un ennemi sans ambiguïté. Le nom qui le précède n'est qu'une
     étiquette lisible, il peut être renommé sans que l'id ne bouge. */
  const insts = data.byInstance || [];
  const instEl = $('enemyInstanceList');
  if (instEl) instEl.innerHTML = insts.slice(0, 12).map((r, i) => `
    <div class="drop-row">
      <span class="drop-i">${i + 1}</span>
      <span class="drop-name">${esc(r.name || r.family || '?')}
        <span style="color:#6f5a80;font-size:11px">${r.map_id}#${r.enemy_event_id}</span>
      </span>
      <span class="drop-exits">${fmtN(r.count)}</span>
      <span class="drop-pct">${share(r.count)}</span>
    </div>`).join('') || '<div style="color:#6f5a80;font-size:12px;padding:8px 2px">no capture on this map</div>';

  // classement des cartes : global, en part de toutes les captures du jeu
  const byMap = data.byMap || [];
  const allTotal = data.total || 0;
  const rankEl = $('deathMapRank');
  if (rankEl) rankEl.innerHTML = byMap.slice(0, 8).map((r, i) => `
    <div class="drop-row">
      <span class="drop-i">${i + 1}</span>
      <span class="drop-name">${esc(mapLabel(r.map_id))}</span>
      <span class="drop-exits">${fmtN(r.count)}</span>
      <span class="drop-pct">${allTotal ? Math.round(r.count / allTotal * 1000) / 10 : 0}%</span>
    </div>`).join('') || '<div style="color:#6f5a80;font-size:12px;padding:8px 2px">no data yet</div>';

  /* Le sélecteur liste TOUTES les cartes rendues, pas seulement celles où
     quelqu'un s'est fait prendre : sinon, sur une base fraîche, il ne contient
     qu'une entrée et on ne peut plus explorer le reste du jeu. Les cartes sans
     capture restent affichées à 0. Tri par captures décroissantes, puis par id
     pour que l'ordre soit stable quand tout est à égalité. */
  const sel = $('deathMapSelect');
  if (sel) {
    const counts = {};
    for (const r of byMap) counts[r.map_id] = r.count;
    const ids = Object.keys((_mapIndex && _mapIndex.maps) || {}).map(Number);
    for (const r of byMap) if (!ids.includes(r.map_id)) ids.push(r.map_id);
    ids.sort((a, b) => (counts[b] || 0) - (counts[a] || 0) || a - b);

    const opts = ids.map(id =>
      `<option value="${id}">${esc(mapLabel(id))} · ${fmtN(counts[id] || 0)}</option>`).join('');
    if (sel.innerHTML !== opts) sel.innerHTML = opts;
    if (!ids.includes(_deathMapId)) _deathMapId = ids.length ? ids[0] : null;
    if (_deathMapId != null) sel.value = String(_deathMapId);
  }
  drawDeathMap();
  /* Réponse non filtrée (premier chargement) alors qu'une carte est choisie :
     on redemande aussitôt les classements de cette carte. `mapId === null`
     n'existe que sur un serveur qui sait filtrer — un ancien serveur renvoie
     undefined, ce qui évite de boucler. */
  if (_deathMapId != null && data.mapId === null) refreshDeaths();
}

async function refreshDeaths() {
  const q = _deathMapId != null ? '?mapId=' + _deathMapId : '';
  try { renderDeaths(await api('/v1/stats/deaths' + q)); } catch (e) {}
}

function drawDeathMap() {
  const wrap = $('deathMapWrap'), empty = $('deathMapEmpty');
  const img = $('deathMapImg'), svg = $('deathMapSvg'), cnt = $('deathMapCount');
  if (!wrap || !svg || !img) return;

  const info = _mapIndex && _mapIndex.maps ? _mapIndex.maps[String(_deathMapId)] : null;
  const points = ((_deathData && _deathData.points) || []).filter(p => p.map_id === _deathMapId);

  if (_deathMapId == null || !info) {
    wrap.classList.add('hidden');
    if (empty) {
      empty.classList.remove('hidden');
      /* Une carte sans PNG n'est pas un bug : le rendu ne couvre que les cartes
         où un événement retire des PV. Si une capture tombe ailleurs, on le dit. */
      empty.textContent = _deathMapId == null
        ? 'no captures recorded yet'
        : 'no background rendered for ' + mapLabel(_deathMapId) + ' — re-run tools/render-maps.js';
    }
    if (cnt) cnt.textContent = '0';
    return;
  }
  wrap.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  if (cnt) cnt.textContent = fmtN(points.reduce((s, p) => s + p.count, 0));

  const src = (_mapDir || 'maps/') + info.file;
  if (img.getAttribute('src') !== src) img.setAttribute('src', src);

  /* Le viewBox est en cases, pas en pixels : les croix se placent en coordonnées
     de jeu et suivent automatiquement l'échelle de l'image, quelle que soit la
     largeur du panneau. */
  const max = points.reduce((m, p) => Math.max(m, p.count), 1);
  const marks = points.map(p => {
    // racine carrée : l'aire de la croix suit le nombre de morts, pas sa longueur
    const t = Math.sqrt(p.count / max);
    const r = 0.22 + t * 0.30;                       // demi-diagonale, en cases
    const op = (0.45 + t * 0.55).toFixed(2);
    const cx = p.x + 0.5, cy = p.y + 0.5;
    const title = `${p.count} death${p.count > 1 ? 's' : ''}${p.enemy ? ' · ' + p.enemy : ''} (${p.x},${p.y})`;
    return `<g opacity="${op}"><title>${esc(title)}</title>` +
      `<path d="M${(cx-r).toFixed(2)} ${(cy-r).toFixed(2)} L${(cx+r).toFixed(2)} ${(cy+r).toFixed(2)} ` +
      `M${(cx+r).toFixed(2)} ${(cy-r).toFixed(2)} L${(cx-r).toFixed(2)} ${(cy+r).toFixed(2)}" ` +
      `stroke="#ff2d55" stroke-width="${(0.10 + t * 0.10).toFixed(3)}" stroke-linecap="round" ` +
      `style="filter:drop-shadow(0 0 ${(r * 0.5).toFixed(2)}px rgba(255,45,85,.9))"/></g>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${info.width} ${info.height}`);
  svg.innerHTML = marks;
}

function renderEndings(data) {
  if (!data) return;
  const endings = data.endings || {};
  const reached = data.reached || 0;
  const rows = Object.entries(endings).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const sum = rows.reduce((s, [, n]) => s + n, 0) || 1;

  const reachedEl = $('endReached');
  if (reachedEl) reachedEl.textContent = fmtN(reached);

  /* « 50% fin Chad » : sur les joueurs qui ont atteint UNE fin. Rapporter au
     total des joueurs mélangerait ceux qui n'ont simplement pas fini. */
  const chadEl = $('chadPct');
  if (chadEl) chadEl.textContent = reached ? Math.round((endings.chad || 0) / reached * 100) + '%' : '—';

  const color = (k, i) => ENDING_COLORS[k] || VERSION_COLORS[i % VERSION_COLORS.length];
  const bar = $('endingBar'), listEl = $('endingList');
  if (bar) bar.innerHTML = rows.map(([k, n], i) =>
    `<div style="width:${Math.round(n / sum * 1000) / 10}%;background:${color(k, i)};box-shadow:inset 0 0 12px rgba(255,255,255,.15)" title="${esc(endingLabel(k))}"></div>`).join('');
  if (listEl) listEl.innerHTML = rows.map(([k, n], i) => `
    <div style="display:flex;align-items:center;gap:9px;font-size:12px">
      <span style="width:9px;height:9px;border-radius:3px;background:${color(k, i)};flex:none"></span>
      <span style="color:#cdb8d8;flex:1">${esc(endingLabel(k))}</span>
      <span style="font-variant-numeric:tabular-nums;color:#f6ecf7;font-weight:600">${fmtN(n)}</span>
      <span style="font-variant-numeric:tabular-nums;color:#9d84ad;width:52px;text-align:right">${reached ? Math.round(n / reached * 100) : 0}%</span>
    </div>`).join('') || '<span style="color:#6f5a80;font-size:12px">no ending reached yet</span>';

  const favs = Object.entries(data.favourites || {}).sort((a, b) => b[1] - a[1]);
  const favTotal = favs.reduce((s, [, n]) => s + n, 0) || 1;
  const favEl = $('favouriteList');
  if (favEl) favEl.innerHTML = favs.map(([name, n]) =>
    `<span class="lang-pill">${esc(name)} <span>${Math.round(n / favTotal * 100)}% · ${fmtN(n)}</span></span>`).join('')
    || '<span style="color:#6f5a80;font-size:12px">nobody answered yet</span>';

  const ad = data.afterDeath || {};
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v ? fmtN(v) : '—'; };
  set('adRetry', ad.retry); set('adLoad', ad.load); set('adTitle', ad.title);
}

/* Bonus : part des joueurs de la version qui ont trouvé chacun des 15 bonus.
   Les 15 sont toujours listés, même à 0 : un bonus que personne ne trouve est
   précisément l'information recherchée. */
const BONUS_COUNT = 15;
// carte du coffre de chaque bonus en 0.5.1 (objet « Bonus N », id 20 + N)
const BONUS_MAPS = { 1: 35, 2: 10, 3: 11, 4: 12, 5: 12, 6: 21, 7: 29, 8: 22, 9: 33, 10: 25, 11: 25, 12: 26, 13: 26, 14: 34, 15: 32 };
function renderBonuses(data) {
  if (!data) return;
  const total = data.totalPlayers || 0;
  const by = {};
  for (const r of data.bonuses || []) by[r.bonus] = r;
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  set('bonusCollectors', fmtN(data.collectors || 0));
  set('bonusPlayers', fmtN(total));
  set('bonusCollectorsPct', total ? Math.round((data.collectors || 0) / total * 100) + '%' : '—');

  const listEl = $('bonusList');
  if (!listEl) return;
  const rows = [];
  for (let b = 1; b <= BONUS_COUNT; b++) {
    const r = Object.assign({ bonus: b, players: 0 }, by[b] || {});
    r.mapId = BONUS_MAPS[b] || r.mapId;
    const pct = total ? r.players / total * 100 : 0;
    rows.push(`
    <div style="display:grid;grid-template-columns:70px 1fr 120px 54px 46px;align-items:center;gap:10px;font-size:12px">
      <span style="color:#f6ecf7;font-weight:600">Bonus ${b}</span>
      <div style="height:8px;border-radius:5px;background:rgba(255,255,255,.05);overflow:hidden">
        <div style="width:${Math.min(100, pct).toFixed(1)}%;height:100%;background:linear-gradient(90deg,#c9a2ff,#ff5e97)"></div>
      </div>
      <span style="color:#6f5a80;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.mapId ? esc(MAP_NAMES[r.mapId] || ('Map ' + r.mapId)) : ''}</span>
      <span style="font-variant-numeric:tabular-nums;color:#cdb8d8;text-align:right">${fmtN(r.players)}</span>
      <span style="font-variant-numeric:tabular-nums;color:#9d84ad;text-align:right">${total ? (Math.round(pct * 10) / 10) + '%' : '—'}</span>
    </div>`);
  }
  listEl.innerHTML = rows.join('');
}

/* Clics sur les liens externes du jeu, et rendement des liens d'annonces. */
const LINK_LABELS = { discord: 'Discord', patreon: 'Patreon', itch: 'Itch.io', announcement: 'Announcement link', changelog: 'Changelog link' };
const SOURCE_LABELS = { title: 'title screen', exit: 'exit screen', announcement: 'announcement', changelog: 'changelog' };
function renderLinks(data) {
  if (!data) return;
  const total = data.totalPlayers || 0;
  const tEl = $('linkTargets');
  if (tEl) {
    const by = {};
    for (const r of data.byTarget || []) by[r.target] = r;
    tEl.innerHTML = Object.keys(LINK_LABELS).map(k => {
      const r = by[k] || { clicks: 0, players: 0 };
      const from = (data.bySource || []).filter(s => s.target === k && s.source && s.source !== k)
        .map(s => (SOURCE_LABELS[s.source] || s.source) + ' ' + fmtN(s.clicks)).join(' · ');
      return `<div class="drop-row">
        <span class="drop-name">${esc(LINK_LABELS[k])}${from ? ` <span style="color:#6f5a80;font-size:11px">${esc(from)}</span>` : ''}</span>
        <span class="drop-exits" title="clicks">${fmtN(r.clicks)}</span>
        <span class="drop-pct" title="share of players who clicked">${total ? Math.round(r.players / total * 1000) / 10 + '%' : '—'}</span>
      </div>`;
    }).join('');
  }
  const aEl = $('linkAnnouncements');
  if (aEl) {
    const anns = (data.announcements || []).filter(a => a.url);
    aEl.innerHTML = anns.map(a => `
      <div class="drop-row">
        <span class="drop-name">${esc(a.title)}${a.active ? ' <span style="color:#7dffc4;font-size:10px">● active</span>' : ''}</span>
        <span class="drop-exits" title="clicks / views">${fmtN(a.clicks)} / ${fmtN(a.views)}</span>
        <span class="drop-pct" title="click-through rate">${a.views ? Math.round(a.clicks / a.views * 1000) / 10 + '%' : '—'}</span>
      </div>`).join('') || '<div style="color:#6f5a80;font-size:12px;padding:8px 2px">no announcement with a link yet</div>';
  }
}
async function fetchLinks() { try { renderLinks(await api('/v1/stats/links')); } catch (e) {} }

async function refreshGameplay() {
  await loadMapIndex();
  await refreshDeaths();
  try { renderEndings(await api('/v1/stats/endings')); } catch (e) {}
  try { renderBonuses(await api('/v1/stats/bonuses')); } catch (e) {}
}

// ===================================================================
//  SURVEYS
// ===================================================================
const SV_LANGS = ['en', 'fr', 'ru', 'ja', 'ko', 'zh'];

/* Le brouillon vit ici et pas dans le DOM : avec 6 langues, les champs affichés
   ne montrent qu'une tranche de la question à la fois. Basculer de langue écrit
   la tranche courante puis relit la nouvelle. */
let svDraft = null;
let svLang = 'en';
let svPool = [];

function svBlank() {
  return { id: '', type: 'choice', label: {}, lowLabel: {}, highLabel: {}, options: [] };
}

// Lit les champs visibles vers le brouillon, pour la langue affichée.
function svCapture() {
  if (!svDraft) return;
  svDraft.id = $('svSlug').value.trim().toLowerCase();
  svDraft.type = $('svType').value;
  svDraft.label[svLang] = $('svLabel').value.trim();
  svDraft.lowLabel[svLang] = $('svLow').value.trim();
  svDraft.highLabel[svLang] = $('svHigh').value.trim();
  $('svOptionList').querySelectorAll('[data-oi]').forEach(row => {
    const i = parseInt(row.dataset.oi, 10);
    if (!svDraft.options[i]) return;
    svDraft.options[i].id = row.querySelector('.slug').value.trim().toLowerCase();
    svDraft.options[i].label[svLang] = row.querySelector('.lab').value.trim();
  });
}

function svRenderEditor() {
  if (!svDraft) svDraft = svBlank();
  $('svSlug').value = svDraft.id || '';
  $('svType').value = svDraft.type;
  $('svLabel').value = svDraft.label[svLang] || '';
  $('svLow').value = (svDraft.lowLabel || {})[svLang] || '';
  $('svHigh').value = (svDraft.highLabel || {})[svLang] || '';

  const isScale = svDraft.type === 'scale';
  $('svScaleBox').classList.toggle('hidden', !isScale);
  $('svOptionsBox').classList.toggle('hidden', isScale);

  // pastilles : plein = cette langue est traduite, creux = trou à combler
  $('svLangTabs').innerHTML = SV_LANGS.map(l => {
    const filled = !!(svDraft.label[l] || '').trim();
    return `<button class="sv-lang${filled ? ' filled' : ''}${l === svLang ? ' active' : ''}" data-lang="${l}">${l.toUpperCase()}</button>`;
  }).join('');
  $('svLangTabs').querySelectorAll('[data-lang]').forEach(b => {
    b.addEventListener('click', () => { svCapture(); svLang = b.dataset.lang; svRenderEditor(); });
  });

  $('svOptionList').innerHTML = svDraft.options.map((o, i) => `
    <div class="sv-opt" data-oi="${i}">
      <input class="slug" value="${esc(o.id || '')}" placeholder="slug" spellcheck="false">
      <input class="lab" value="${esc((o.label || {})[svLang] || '')}" placeholder="option label">
      <button class="rm" data-ro="${i}">&times;</button>
    </div>`).join('');
  $('svOptionList').querySelectorAll('[data-ro]').forEach(b => {
    b.addEventListener('click', () => {
      svCapture();
      svDraft.options.splice(parseInt(b.dataset.ro, 10), 1);
      svRenderEditor();
    });
  });

  $('svEditorMode').textContent = svDraft.id && svPool.some(q => q.id === svDraft.id)
    ? 'editing "' + svDraft.id + '" — saving keeps existing answers'
    : 'new question';
}

function svShowError(msg) {
  const el = $('svError');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('hidden', !msg);
}

async function svSave() {
  svCapture();
  svShowError('');
  const d = svDraft;
  if (!d.id) return svShowError('A slug is required.');
  if (!(d.label.en || '').trim()) return svShowError('The English question is required — it is the fallback for every other language.');

  const body = { id: d.id, type: d.type, label: svClean(d.label) };
  if (d.type === 'scale') {
    body.lowLabel = svClean(d.lowLabel);
    body.highLabel = svClean(d.highLabel);
  } else {
    const opts = d.options.filter(o => o.id && (o.label.en || '').trim());
    if (opts.length < 2) return svShowError('At least 2 options with a slug and an English label.');
    body.options = opts.map(o => ({ id: o.id, label: svClean(o.label) }));
  }

  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/survey/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return svShowError(data.error || ('HTTP ' + res.status));
    svDraft = svBlank(); svLang = 'en'; svRenderEditor();
    const t = $('svToast');
    if (t) { t.classList.remove('hidden'); setTimeout(() => t.classList.add('hidden'), 2600); }
    refreshSurveys();
  } catch (e) { svShowError('Unable to reach the server.'); }
}

// Retire les langues vides : le jeu retombe sur l'anglais tout seul.
function svClean(dict) {
  const out = {};
  for (const l of SV_LANGS) if ((dict[l] || '').trim()) out[l] = dict[l].trim();
  return out;
}

function svFillFromEn() {
  svCapture();
  const fill = (d) => { for (const l of SV_LANGS) if (!(d[l] || '').trim() && d.en) d[l] = d.en; };
  fill(svDraft.label); fill(svDraft.lowLabel); fill(svDraft.highLabel);
  svDraft.options.forEach(o => fill(o.label));
  svRenderEditor();
}

function renderSurveyPool(questions) {
  svPool = questions || [];
  const cnt = $('svPoolCount');
  if (cnt) cnt.textContent = svPool.length;
  const el = $('svPoolList');
  if (!el) return;
  el.innerHTML = svPool.map(q => {
    const missing = SV_LANGS.filter(l => !(q.label || {})[l]);
    return `
    <div class="sv-q${q.active ? '' : ' off'}">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:10px;letter-spacing:1.2px;color:#e9b95f;text-transform:uppercase">${esc(q.type)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:11px;color:#6f5a80">${esc(q.id)}</span>
        <div style="flex:1"></div>
        <span style="font-size:11px;color:#9d84ad">${fmtN(q.responses || 0)} answers</span>
        <button class="btn-ghost" data-sv-edit="${esc(q.id)}" style="padding:4px 10px;font-size:11px">EDIT</button>
        <button class="btn-ghost" data-sv-toggle="${esc(q.id)}" style="padding:4px 10px;font-size:11px">${q.active ? 'DISABLE' : 'ENABLE'}</button>
        <button class="rm" data-sv-del="${esc(q.id)}" style="width:26px;height:26px;border-radius:7px;border:1px solid rgba(255,71,87,.35);background:rgba(255,71,87,.10);color:#ff8a97;cursor:pointer">&times;</button>
      </div>
      <div style="font-size:13px;color:#e9d5f0;margin-top:8px">${esc((q.label || {}).en || '—')}</div>
      ${missing.length ? `<div style="font-size:10.5px;color:#6f5a80;margin-top:6px">missing: ${missing.join(', ').toUpperCase()} · these players will see English</div>` : ''}
    </div>`;
  }).join('') || '<div style="color:#6f5a80;font-size:12px">no question yet — write one on the left</div>';

  el.querySelectorAll('[data-sv-edit]').forEach(b => b.addEventListener('click', () => {
    const q = svPool.find(x => x.id === b.dataset.svEdit);
    if (!q) return;
    svDraft = {
      id: q.id, type: q.type,
      label: Object.assign({}, q.label), lowLabel: Object.assign({}, q.lowLabel || {}),
      highLabel: Object.assign({}, q.highLabel || {}),
      options: (q.options || []).map(o => ({ id: o.id, label: Object.assign({}, o.label) }))
    };
    svLang = 'en'; svRenderEditor();
    $('svSlug').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }));
  el.querySelectorAll('[data-sv-toggle]').forEach(b => b.addEventListener('click', () => {
    const q = svPool.find(x => x.id === b.dataset.svToggle);
    if (q) svPostQuestion(Object.assign({}, q, { active: !q.active }));
  }));
  el.querySelectorAll('[data-sv-del]').forEach(b => b.addEventListener('click', () => svDeleteQuestion(b.dataset.svDel)));
}

async function svPostQuestion(q) {
  try {
    await fetch(cfg.url.replace(/\/+$/, '') + '/v1/survey/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.token },
      body: JSON.stringify(q)
    });
    refreshSurveys();
  } catch (e) {}
}

async function svDeleteQuestion(id) {
  // La suppression emporte les réponses : c'est irréversible, d'où le rappel.
  if (!confirm('Delete "' + id + '" and all its collected answers?')) return;
  try {
    await fetch(cfg.url.replace(/\/+$/, '') + '/v1/survey/question/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + cfg.token }
    });
    refreshSurveys();
  } catch (e) {}
}

function renderSurveyResults(data) {
  const el = $('svResults');
  if (!el) return;
  const qs = (data && data.questions) || [];
  const withAnswers = qs.filter(q => q.respondents > 0);
  if (!withAnswers.length) {
    el.innerHTML = '<div style="color:#6f5a80;font-size:12px">no answer collected yet</div>';
    return;
  }
  el.innerHTML = withAnswers.map(q => {
    const labelOf = (key) => {
      if (q.type === 'scale') return key + ' / 5';
      const o = (q.options || []).find(x => x.id === key);
      return o ? ((o.label || {}).en || o.id) : key;
    };
    /* Pour l'échelle on force l'ordre 1→5 : trier par popularité rendrait la
       distribution illisible. Pour le reste, le plus choisi en premier. */
    let keys = q.type === 'scale' ? ['1', '2', '3', '4', '5']
      : Object.keys(q.counts).sort((a, b) => q.counts[b] - q.counts[a]);
    const max = Math.max(1, ...keys.map(k => q.counts[k] || 0));

    return `
    <div>
      <div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap">
        <span style="font-size:13.5px;color:#f6ecf7;font-weight:600">${esc((q.label || {}).en || q.id)}</span>
        <span style="font-family:ui-monospace,monospace;font-size:10.5px;color:#6f5a80">${esc(q.id)}</span>
        <div style="flex:1"></div>
        ${q.average != null ? `<span style="font-size:12px;color:#7dffc4">avg ${q.average} / 5</span>` : ''}
        <span style="font-size:11px;color:#9d84ad">${fmtN(q.respondents)} respondents</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:7px;margin-top:12px">
        ${keys.map(k => {
          const n = q.counts[k] || 0;
          return `<div style="display:flex;align-items:center;gap:10px;font-size:12px">
            <span style="width:34%;color:#cdb8d8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(labelOf(k))}</span>
            <span class="sv-bar" style="flex:1"><i style="width:${Math.round(n / max * 100)}%"></i></span>
            <span style="width:42px;text-align:right;font-variant-numeric:tabular-nums;color:#f6ecf7">${fmtN(n)}</span>
            <span style="width:46px;text-align:right;font-variant-numeric:tabular-nums;color:#9d84ad">${Math.round(n / q.respondents * 100)}%</span>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

async function refreshSurveys() {
  try { renderSurveyPool((await api('/v1/survey/admin')).questions); } catch (e) {}
  try { renderSurveyResults(await api('/v1/stats/survey')); } catch (e) {}
}

// ===================================================================
//  REPORTS
// ===================================================================
let _reportsCache = [];
function renderReports(reports) {
  _reportsCache = reports || [];
  const wrap = $('reportsWrap'), empty = $('reportsEmpty'), table = $('reportsTable');
  const countEl = $('reportCount'); if (countEl) countEl.textContent = _reportsCache.length;
  const badge = $('navReports');
  if (badge) { if (_reportsCache.length > 0) { badge.textContent = _reportsCache.length; } }
  if (_reportsCache.length === 0) {
    if (wrap) wrap.classList.add('hidden');
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (wrap) wrap.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  if (!table) return;
  table.innerHTML = _reportsCache.map(r => {
    const time = new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const err = esc(String(r.error || '').slice(0, 120));
    const zone = esc(ZONE_LABELS[r.zone] || r.zone || '—');
    const ver = esc(r.version || '—');
    const plat = esc(r.platform || '—');
    const pid = r.player_id ? esc(r.player_id.slice(0, 8)) + '…' : '—';
    const shot = r.screenshot
      ? `<span class="rep-shot" style="background:rgba(233,185,95,.10);border:1px solid rgba(233,185,95,.4);color:#ffd98a" data-shot="${esc(r.id)}">view</span>`
      : `<span class="rep-shot" style="background:transparent;border:1px solid rgba(255,255,255,.08);color:#6f5a80">—</span>`;
    return `<div class="rep-row">
      <span style="font-variant-numeric:tabular-nums;color:#9d84ad">${time}</span>
      <span style="color:#ff8a97;font-family:ui-monospace,monospace" class="rep-ell" title="${esc(r.error || '')}">${err}</span>
      <span style="color:#e9d5f0" class="rep-ell">${zone}</span>
      <span style="color:#cdb8d8;font-variant-numeric:tabular-nums">${ver}</span>
      <span><span class="plat-tag">${plat}</span></span>
      <span style="color:#ffd98a" class="rep-ell">${pid}</span>
      <span style="text-align:right">${shot}</span>
      <span><button class="rm" data-del="${esc(r.id)}" title="Delete this report">×</button></span>
    </div>`;
  }).join('');
  table.querySelectorAll('[data-shot]').forEach(el => {
    el.addEventListener('click', () => {
      const rep = _reportsCache.find(r => String(r.id) === el.dataset.shot);
      if (rep && rep.screenshot) showScreenshot(rep.screenshot);
    });
  });
  table.querySelectorAll('[data-del]').forEach(el => {
    el.addEventListener('click', () => deleteReport(el.dataset.del));
  });
}

/* Suppression d'une seule ligne. Le motif « armed » à double-clic de CLEAR ALL
   est trop lourd ici : un confirm() suffit, comme pour les annonces.
   api() est GET-only, d'où le fetch écrit à la main. */
async function deleteReport(id) {
  if (!confirm('Delete this report?')) return;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/reports/' + encodeURIComponent(id), {
      method: 'DELETE', headers: { 'Authorization': 'Bearer ' + cfg.token }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const left = _reportsCache.filter(r => String(r.id) !== String(id));
    lastReportCount = left.length;                     // sinon le badge rejoue « nouveau rapport »
    renderReports(left);
    const badge = $('navReports');
    if (badge && left.length === 0) badge.classList.add('hidden');
  } catch (e) { alert('Unable to delete this report.'); }
}
async function fetchReports() {
  try {
    const data = await api('/v1/reports');
    renderReports(data && data.reports || []);
  } catch (e) {}
}
let _clearArmed = false, _clearTO = null;
async function clearReports() {
  if (!_clearArmed) {
    _clearArmed = true;
    const btn = $('reportsClear'); if (btn) { btn.textContent = 'SURE? CLICK AGAIN'; btn.classList.add('armed'); }
    _clearTO = setTimeout(() => { _clearArmed = false; const b = $('reportsClear'); if (b) { b.textContent = 'CLEAR ALL'; b.classList.remove('armed'); } }, 3500);
    return;
  }
  clearTimeout(_clearTO); _clearArmed = false;
  const btn = $('reportsClear'); if (btn) { btn.textContent = 'CLEAR ALL'; btn.classList.remove('armed'); }
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/reports', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + cfg.token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lastReportCount = 0;
    renderReports([]);
    const badge = $('navReports'); if (badge) badge.classList.add('hidden');
  } catch (e) { alert('Unable to clear reports.'); }
}
function exportReportsCSV() {
  const header = ['Time','Error','Zone','Version','Platform','Player','Screenshot'];
  const rows = _reportsCache.map(r => [
    new Date(r.ts).toLocaleString(), String(r.error || '').replace(/"/g,'""'),
    r.zone || '', r.version || '', r.platform || '', r.player_id || '', r.screenshot ? 'yes' : 'no'
  ].map(v => `"${v}"`).join(','));
  const csv = [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `reports-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}
function showScreenshot(base64) {
  const ex = document.getElementById('sg-shot-lb'); if (ex) ex.remove();
  const lb = document.createElement('div');
  lb.id = 'sg-shot-lb';
  lb.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  lb.innerHTML = '<img src="data:image/jpeg;base64,' + base64 + '" style="max-width:90%;max-height:90%;border-radius:8px;box-shadow:0 0 50px rgba(255,61,129,.3)">';
  lb.addEventListener('click', () => lb.remove());
  document.body.appendChild(lb);
}
async function checkReportsBadge() {
  if (!cfg.url || !cfg.token) return;
  try {
    const data = await api('/v1/reports');
    const count = (data && data.reports || []).length;
    if (!_reportCountInitialized) { _reportCountInitialized = true; lastReportCount = count; if (count > 0) { const b = $('navReports'); if (b) { b.textContent = count; b.classList.remove('hidden'); } } return; }
    if (count > lastReportCount && currentTab !== 'reports') {
      const b = $('navReports'); if (b) { b.textContent = count; b.classList.remove('hidden'); }
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification('SuccubusStats — Bug report', { body: (count - lastReportCount) === 1 ? '1 nouveau rapport.' : `${count - lastReportCount} nouveaux rapports.`, silent: false });
      }
    }
    lastReportCount = count;
  } catch (e) {}
}

// ===================================================================
//  GAME UPDATE
// ===================================================================
const _updateStagedFiles = [];
function formatBytes(n) { if (n < 1024) return n + ' B'; if (n < 1048576) return (n/1024).toFixed(1)+' KB'; return (n/1048576).toFixed(1)+' MB'; }
function guessDir(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'js') return 'www/js/plugins/';
  if (ext === 'json') return 'www/data/';
  if (['png','jpg','jpeg','gif','webp'].includes(ext)) return 'www/img/';
  if (['ogg','mp3','wav','m4a'].includes(ext)) return 'www/audio/';
  return 'www/';
}
async function fetchCurrentUpdate() {
  try {
    const data = await api('/v1/game/update/admin');
    const m = data && data.manifest;
    const ver = $('curUpdVersion'), name = $('curUpdName'), files = $('curUpdFiles');
    if (!m || !m.version) { if (ver) ver.textContent = '—'; if (name) name.textContent = 'no update staged'; if (files) files.innerHTML = '<div style="color:#6f5a80">— none —</div>'; return; }
    if (ver) ver.textContent = 'v' + m.version;
    if (name) name.textContent = Array.isArray(m.files) ? `${m.files.length} file(s) on relay` : 'staged';
    if (files && Array.isArray(m.files)) files.innerHTML = m.files.map(f => `<div style="display:flex;gap:10px"><span style="color:#e9b95f;flex:none">✦</span>${esc(f.filename || (f.path||'').split('/').pop() || '?')}</div>`).join('');
  } catch (e) {}
}
function renderStagedFiles() {
  const el = $('updFileList');
  if (!el) return;
  el.innerHTML = _updateStagedFiles.map((f, i) => `
    <div class="upd-file">
      <span style="flex:none;font-size:12px;color:#e9d5f0;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}</span>
      <input data-idx="${i}" value="${esc(f.dir)}" spellcheck="false">
      <span style="font-size:11px;color:#9d84ad;flex:none">${formatBytes(f.size)}</span>
      <button class="rm" data-idx="${i}">&times;</button>
    </div>`).join('');
  el.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => { _updateStagedFiles.splice(parseInt(b.dataset.idx,10),1); renderStagedFiles(); }));
  el.querySelectorAll('input[data-idx]').forEach(inp => inp.addEventListener('change', () => {
    let v = inp.value.replace(/\\/g,'/').trim(); if (v && !v.endsWith('/')) v += '/';
    _updateStagedFiles[parseInt(inp.dataset.idx,10)].dir = v;
  }));
}
function addUpdateFiles(fileList) {
  for (const file of fileList) {
    if (_updateStagedFiles.some(f => f.name === file.name)) continue;
    const dir = guessDir(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = btoa(new Uint8Array(reader.result).reduce((s, b) => s + String.fromCharCode(b), ''));
      _updateStagedFiles.push({ name: file.name, dir, size: file.size, content: base64 });
      renderStagedFiles();
    };
    reader.readAsArrayBuffer(file);
  }
}
async function publishUpdate() {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  const version = ($('updVersion').value || '').trim();
  if (!version) return alert('Enter a version number.');
  if (_updateStagedFiles.length === 0) return alert('Add at least one file.');
  const files = _updateStagedFiles.map(f => ({ name: f.name, path: f.dir + f.name, content: f.content }));
  const btn = $('updPublish'); if (btn) btn.style.opacity = '0.6';
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/game/update', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, files })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _updateStagedFiles.length = 0; renderStagedFiles();
    $('updVersion').value = '';
    fetchCurrentUpdate();
    const toast = $('updToast'); if (toast) { toast.textContent = `✦ v${version} deployed — players will receive it on next launch.`; toast.classList.remove('hidden'); setTimeout(() => toast.classList.add('hidden'), 5000); }
  } catch (e) { alert('Failed to publish: ' + e.message); }
  finally { if (btn) btn.style.opacity = ''; }
}
async function clearUpdate() {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  if (!confirm('Clear the current game update? Players will no longer receive it.')) return;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/game/update', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + cfg.token } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fetchCurrentUpdate();
  } catch (e) { alert('Failed to clear: ' + e.message); }
}

// ===================================================================
//  SETTINGS
// ===================================================================
function populateSettings() {
  if ($('cfgUrl')) $('cfgUrl').value = cfg.url || '';
  if ($('cfgToken')) $('cfgToken').value = cfg.token || '';
  refreshTrackedVersion();
  const el = $('appVersionLabel');
  if (el) el.innerHTML = 'SuccubusStats v' + esc(APP_VERSION) + ' · made by Henergyque · Kutushmurf est un enculé';
}
/* Le selecteur liste les versions que le serveur a reellement vues, plutot
   qu'une liste ecrite en dur qu'il faudrait maintenir a chaque sortie. */
async function refreshTrackedVersion() {
  const sel = $('cfgTracked');
  if (!sel) return;
  try {
    const [state, versions] = await Promise.all([
      api('/v1/admin/tracked-version'),
      api('/v1/stats/versions')
    ]);
    const current = (state && state.trackedVersion) || 'all';
    // versions vues par le serveur + versions publiees, meme sans session encore
    const seen = Array.from(new Set(Object.keys((versions && versions.total) || {}).concat(RELEASES)))
      .filter(Boolean)
      .sort((a, b) => (b || '').localeCompare(a || '', undefined, { numeric: true }));

    sel.innerHTML = '<option value="all">All versions</option>' +
      seen.map(v => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');
    sel.value = current;
    // une version suivie qui n'a plus aucune session ne serait dans aucune option
    if (sel.value !== current) {
      sel.insertAdjacentHTML('beforeend', '<option value="' + esc(current) + '">' + esc(current) + '</option>');
      sel.value = current;
    }
    setTrackedHint(current);
  } catch (e) {}
}

function setTrackedHint(v) {
  /* Le jeu de cartes de l'onglet GAMEPLAY suit la version affichée. */
  const tracked = (!v || v === 'all') ? null : v;
  if (tracked !== _trackedVersion) {
    _trackedVersion = tracked;
    if (currentTab === 'gameplay') refreshGameplay();
  }
  /* Pastille de l'en-tete : on voit d'un coup d'oeil quelle version tous les
     panneaux affichent, sans aller dans les reglages. */
  const pill = $('trackedPill');
  if (pill) {
    pill.textContent = (!v || v === 'all') ? 'ALL VERSIONS' : 'VIEWING ' + v;
    pill.classList.remove('hidden');
  }
  const el = $('trackedHint');
  if (!el) return;
  el.textContent = (!v || v === 'all')
    ? 'Showing every version at once.'
    : 'Every panel is showing ' + v + ' only.';
}

async function saveTrackedVersion() {
  const sel = $('cfgTracked'), btn = $('cfgTrackedSave');
  if (!sel) return;
  const label = btn && btn.childNodes[0];
  const chosen = sel.value || 'all';
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/admin/tracked-version', {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: chosen })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    setTrackedHint(data.trackedVersion || 'all');
    if (label) { label.textContent = '✦ APPLIED'; setTimeout(() => { label.textContent = 'APPLY'; }, 2200); }
    /* Le filtre vit cote serveur : tout ce qui est deja affiche est perime,
       on recharge au lieu de laisser cohabiter des chiffres de deux versions. */
    refreshAllPanels();
  } catch (e) {
    if (label) { label.textContent = '✗ ' + e.message; setTimeout(() => { label.textContent = 'APPLY'; }, 2600); }
  }
}

/* Rappelle tout ce qui depend de la version suivie. Le WebSocket poussera de
   lui-meme le prochain instantane, mais l'attendre laisserait les compteurs
   sur les anciennes valeurs pendant plusieurs secondes. */
async function refreshAllPanels() {
  /* En serie et non en rafale : lancer les quinze appels d'un coup saturait le
     limiteur, et les panneaux rejetes restaient vides sans message. */
  const steps = [
    () => api('/v1/live').then(d => d && d.live && renderLive(d.live)),
    refreshDropoff, refreshConcurrent, refreshNewPlayers,
    fetchToday, fetchPlatforms, fetchVersions, fetchSessionStats, fetchLanguages,
    refreshGameplay, refreshSurveys, fetchReports, fetchLinks
  ];
  for (const step of steps) {
    try { await step(); } catch (e) {}
  }
}

async function testConnection() {
  const btn = $('cfgTest');
  const url = ($('cfgUrl').value || '').trim(), token = ($('cfgToken').value || '').trim();
  if (!url || !token) { if (btn) btn.textContent = 'FILL URL + TOKEN'; return; }
  if (btn) btn.textContent = 'DIVINING…';
  try {
    const res = await fetch(url.replace(/\/+$/, '') + '/v1/version', { headers: { 'Authorization': 'Bearer ' + token } });
    if (btn) {
      if (res.ok) { btn.textContent = '✦ LINK BLESSED'; btn.style.color = '#7dffc4'; btn.style.borderColor = 'rgba(95,255,178,.5)'; }
      else { btn.textContent = '✗ HTTP ' + res.status; }
      setTimeout(() => { btn.textContent = 'TEST LINK'; btn.style.color = ''; btn.style.borderColor = ''; }, 2600);
    }
  } catch (e) { if (btn) { btn.textContent = '✗ NO LINK'; setTimeout(() => btn.textContent = 'TEST LINK', 2600); } }
}
function saveSettings() {
  cfg = { url: ($('cfgUrl').value || '').trim(), token: ($('cfgToken').value || '').trim() };
  saveCfg(cfg);
  if (ws) { try { ws.close(); } catch (e) {} }
  connect();
  const btn = $('cfgSave');
  if (btn) { const label = btn.childNodes[0]; if (label) label.textContent = '✦ SIGIL SEALED'; setTimeout(() => { if (label) label.textContent = 'SEAL THE PACT'; }, 2400); }
  switchTab('live');
}

// ===================================================================
//  TABS
// ===================================================================
const TAB_META = {
  live: ['Live', 'real-time player activity'],
  gameplay: ['Gameplay', 'where players die, what kills them, how they finish'],
  surveys: ['Surveys', 'ask players one question at a time — anonymously'],
  announce: ['Announcements', 'broadcast a message to all online players'],
  reports: ['Error Reports', 'bugs and stack traces from the game'],
  update: ['Game Update', 'deploy a new version to all players'],
  settings: ['Settings', 'connection and configuration']
};
function switchTab(tab) {
  if (!TAB_META[tab]) return;
  const changed = tab !== currentTab;
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  $('tabTitle').textContent = TAB_META[tab][0];
  $('tabSubtitle').textContent = TAB_META[tab][1];
  if (changed) { const veil = $('veil'); if (veil) { veil.classList.remove('on'); void veil.offsetWidth; veil.classList.add('on'); setTimeout(() => veil.classList.remove('on'), 760); } }
  if (tab === 'gameplay') refreshGameplay();
  if (tab === 'surveys') { svRenderEditor(); refreshSurveys(); }
  if (tab === 'announce') { fetchAnnouncement(); populateAnnounceForm(); fetchLinks(); }
  if (tab === 'reports') { fetchReports(); const b = $('navReports'); if (b) b.classList.add('hidden'); }
  if (tab === 'update') fetchCurrentUpdate();
  if (tab === 'settings') populateSettings();
}

// ===================================================================
//  PARTICLES (port de la maquette)
// ===================================================================
function startParticles() {
  const canvas = $('particles'); if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const density = 90;
  const hues = [316, 275, 350, 43];
  const sprites = hues.map(h => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, `hsla(${h},95%,72%,.9)`);
    g.addColorStop(0.35, `hsla(${h},90%,60%,.38)`);
    g.addColorStop(1, `hsla(${h},90%,55%,0)`);
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return c;
  });
  let W, H;
  const fit = () => { W = canvas.width = canvas.offsetWidth * devicePixelRatio; H = canvas.height = canvas.offsetHeight * devicePixelRatio; };
  fit(); window.addEventListener('resize', fit);
  const R = Math.random;
  const parts = Array.from({ length: density }, () => ({ x: R(), y: R(), z: 0.25 + R()*0.75, s: 0.5 + R()*1.4, hue: Math.floor(R()*sprites.length), drift: 0.4 + R()*1.2, ph: R()*Math.PI*2 }));
  const mouse = { x: 0.5, y: 0.5 };
  window.addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth; mouse.y = e.clientY / innerHeight; });
  let t = 0;
  const frame = () => {
    t += 0.008;
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of parts) {
      p.y -= 0.00035 * p.z * p.drift;
      p.x += Math.sin(t * p.drift + p.ph) * 0.00022;
      if (p.y < -0.05) { p.y = 1.05; p.x = R(); }
      const px = (p.x + (mouse.x - 0.5) * 0.055 * p.z) * W;
      const py = (p.y + (mouse.y - 0.5) * 0.045 * p.z) * H;
      const size = (10 + 42 * p.s) * p.z * devicePixelRatio * (1 + 0.18 * Math.sin(t * 2.2 + p.ph));
      ctx.globalAlpha = 0.28 + 0.5 * p.z;
      ctx.drawImage(sprites[p.hue], px - size/2, py - size/2, size, size);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// ---------- clock ----------
function tickClock() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  if ($('clock')) $('clock').textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  if ($('dateStr')) $('dateStr').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

// ---------- link status / latency ----------
const _pingHistory = [];   // rolling window: true = ok, false = fail
const _PING_WINDOW  = 100; // last 100 pings (~16 min at 10s interval)

function setLink(up) {
  const el = $('linkStatus'), lbl = $('linkLabel');
  if (!el) return;
  el.classList.toggle('down', !up);
  if (lbl) lbl.textContent = up ? 'LINK STABLE' : 'LINK LOST';
}

function _updateRelayUI(latencyMs, uptimeSec, success) {
  // relay name: extract first segment of hostname from configured URL
  const relayEl = $('relayName');
  if (relayEl && cfg.url) {
    try {
      const host = new URL(cfg.url).hostname;  // e.g. "succubus-games-production.up.railway.app"
      const slug = host.split('.')[0];          // "succubus-games-production"
      relayEl.textContent = slug;
    } catch (e) { relayEl.textContent = '—'; }
  }

  // latency
  if ($('latency')) $('latency').textContent = success ? latencyMs : '—';

  // rolling uptime %
  _pingHistory.push(success);
  if (_pingHistory.length > _PING_WINDOW) _pingHistory.shift();
  const pct = (_pingHistory.filter(Boolean).length / _pingHistory.length * 100).toFixed(2);
  const uptEl = $('linkUptime');
  if (uptEl) uptEl.textContent = pct + '%';

  // "up" badge text: server uptime if known, else "up"
  const badge = $('linkUpBadge');
  if (badge && success && uptimeSec != null) {
    const h = Math.floor(uptimeSec / 3600), m = Math.floor((uptimeSec % 3600) / 60);
    const upStr = h > 0 ? `${h}h${String(m).padStart(2,'0')}` : `${m}m`;
    badge.childNodes[0].textContent = upStr + '\n';
  }
}

async function pingLatency() {
  if (!cfg.url) return;
  const t0 = performance.now();
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/health', { cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    let uptimeSec = null;
    try { const j = await res.json(); uptimeSec = j.uptimeSec ?? null; } catch (e) {}
    _updateRelayUI(ms, uptimeSec, true);
  } catch (e) {
    _updateRelayUI(0, null, false);
  }
}

// ===================================================================
//  AUTO-UPDATE (desktop) — conservé de l'ancien dashboard
// ===================================================================
function hideUpdateNotice() { const el = $('updateNotice'); if (el) { el.classList.add('hidden'); el.innerHTML = ''; } }
function showUpdateModal(version, url, notes) {
  if (document.getElementById('sgUpdateModal')) return;
  const overlay = document.createElement('div');
  overlay.id = 'sgUpdateModal';
  const box = document.createElement('div');
  box.style.cssText = 'background:#1a0d2e;border:1px solid rgba(234,173,229,0.3);border-radius:12px;padding:32px;width:480px;max-width:90vw';
  box.innerHTML = `
    <h2 style="color:#eaade5;margin:0 0 10px;font-size:18px">Update available — v${esc(version)}</h2>
    ${notes ? `<p style="color:#9a7aaa;font-size:13px;margin:0 0 20px;white-space:pre-wrap;max-height:120px;overflow-y:auto">${esc(notes)}</p>` : '<p style="color:#9a7aaa;font-size:13px;margin:0 0 20px">A new version is ready to install.</p>'}
    <div id="sgUpdateProgress" style="display:none;margin-bottom:16px"><div style="background:#2c1a40;border-radius:4px;height:6px;overflow:hidden"><div id="sgUpdateBar" style="background:#eaade5;height:100%;width:0%;transition:width 0.3s"></div></div><p id="sgUpdateText" style="color:#9a7aaa;font-size:12px;margin:6px 0 0"></p></div>
    <div style="display:flex;gap:12px;justify-content:flex-end">
      <button id="sgUpdateLater" style="background:transparent;color:#6a4870;border:1px solid #3a2450;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:13px">Later</button>
      <button id="sgUpdateInstall" style="background:rgba(234,173,229,0.15);color:#eaade5;border:1px solid rgba(234,173,229,0.4);border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px">Install &amp; Restart</button>
    </div>`;
  overlay.appendChild(box); document.body.appendChild(overlay);
  document.getElementById('sgUpdateLater').onclick = () => overlay.remove();
  document.getElementById('sgUpdateInstall').onclick = () => {
    document.getElementById('sgUpdateLater').style.display = 'none';
    document.getElementById('sgUpdateInstall').disabled = true;
    document.getElementById('sgUpdateInstall').textContent = 'Installing…';
    document.getElementById('sgUpdateProgress').style.display = 'block';
    installUpdate(url, version);
  };
}
function installUpdate(url, targetVersion) {
  if (!_nw) return;
  const { path, fs, os, https, http, cp } = _nw;
  const bar = document.getElementById('sgUpdateBar'), txt = document.getElementById('sgUpdateText');
  const setTxt = t => { if (txt) txt.textContent = t; }, setBar = p => { if (bar) bar.style.width = p + '%'; };
  const tmpZip = path.join(os.tmpdir(), 'sg-dashboard-update.zip');
  const exePath = process.execPath, packageNwDir = path.join(path.dirname(exePath), 'package.nw');
  setTxt('Downloading…');
  function doGet(getUrl, cb) {
    const parsed = new URL(getUrl); const transport = parsed.protocol === 'https:' ? https : http;
    transport.get(getUrl, (res) => {
      if ([301,302,307,308].includes(res.statusCode) && res.headers.location) { res.resume(); doGet(res.headers.location, cb); }
      else cb(null, res);
    }).on('error', err => cb(err));
  }
  doGet(url, (err, res) => {
    if (err) { setTxt('✗ ' + err.message); return; }
    const total = parseInt(res.headers['content-length'] || '0', 10); let done = 0;
    const file = fs.createWriteStream(tmpZip);
    res.on('data', c => { done += c.length; if (total > 0) setBar(Math.round(done/total*100)); });
    res.pipe(file);
    file.on('finish', () => {
      file.close(); setBar(100); setTxt('Extracting…');
      const ps = `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g,"''")}' -DestinationPath '${packageNwDir.replace(/'/g,"''")}' -Force`;
      cp.execFile('powershell', ['-NoProfile','-NonInteractive','-Command', ps], (err2) => {
        try { fs.unlinkSync(tmpZip); } catch (e) {}
        if (err2) { setTxt('✗ Failed: ' + err2.message); return; }
        try { if (targetVersion) fs.writeFileSync(path.join(packageNwDir, '.sg_version'), targetVersion); } catch (e) {}
        setTxt('Restarting…');
        const bat = `@echo off\r\ntimeout /t 2 /nobreak > nul\r\nstart "" "${exePath}"\r\ndel "%~f0"\r\n`;
        const batPath = path.join(os.tmpdir(), 'sg-relaunch.bat');
        fs.writeFileSync(batPath, bat);
        cp.spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => nw.App.quit(), 600);
      });
    });
    file.on('error', e => { fs.unlink(tmpZip, () => {}); setTxt('✗ ' + e.message); });
  });
}
async function checkVersion() {
  try {
    const data = await api('/v1/version');
    const latest = String(data && data.latest || '').trim();
    const url = String(data && data.url || '').trim();
    const notes = String(data && data.notes || '').trim();
    if (!latest) return;
    if (latest !== APP_VERSION) {
      if (_nw && url) showUpdateModal(latest, url, notes);
      else { const el = $('updateNotice'); if (el) { el.classList.remove('hidden'); el.innerHTML = `New version available: <strong>${esc(latest)}</strong>`; } }
    } else hideUpdateNotice();
  } catch (e) {}
}

// ===================================================================
//  WEBSOCKET
// ===================================================================
function connect() {
  if (!cfg.url || !cfg.token) { setLink(false); switchTab('settings'); return; }
  setLink(false);
  const wsUrl = cfg.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/v1/stream?token=' + encodeURIComponent(cfg.token);
  try { ws = new WebSocket(wsUrl); } catch (e) { setLink(false); return; }
  ws.onopen = () => {
    setLink(true);
    refreshDropoff(); refreshConcurrent(); refreshNewPlayers();
    checkVersion(); fetchAnnouncement(); fetchToday(); checkReportsBadge();
    fetchZoneLabels(); fetchPlatforms(); fetchVersions(); fetchSessionStats(); fetchLanguages();
    refreshTrackedVersion();
    pingLatency();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'snapshot') { lastWsTs = Date.now(); renderLive(msg.live); }
      if (msg.type === 'bug_report') {
        if (currentTab === 'reports') fetchReports();
        else { const b = $('navReports'); if (b) { b.classList.remove('hidden'); } checkReportsBadge(); }
      }
      /* Une capture vient de tomber. On ne rafraîchit que si l'onglet est
         ouvert : sinon il se rechargera de toute façon à l'affichage, et
         recharger en arrière-plan ne ferait que consommer des requêtes.
         Le serveur groupe déjà les rafales, inutile de temporiser ici. */
      if (msg.type === 'capture' && currentTab === 'gameplay') refreshGameplay();
    } catch (e) {}
  };
  ws.onclose = () => { setLink(false); if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = setTimeout(connect, 3000); };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

// live polling fallback
let _liveEndpointExists = true;
async function pollLive() {
  if (!cfg.url || !cfg.token || !_liveEndpointExists) return;
  if (Date.now() - lastWsTs < 4000) return;
  try { const data = await api('/v1/live'); if (data && data.live) renderLive(data.live); }
  catch (e) { if (e.message && e.message.includes('404')) _liveEndpointExists = false; }
}

// ===================================================================
//  EVENT WIRING
// ===================================================================
document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => switchTab(n.dataset.tab)));
$('ccPills').querySelectorAll('.pill').forEach(b => b.addEventListener('click', () => {
  $('ccPills').querySelectorAll('.pill').forEach(x => x.classList.remove('active-cc'));
  b.classList.add('active-cc'); ccRange = b.dataset.r; refreshConcurrent();
}));
$('npPills').querySelectorAll('.pill').forEach(b => b.addEventListener('click', () => {
  $('npPills').querySelectorAll('.pill').forEach(x => x.classList.remove('active-np'));
  b.classList.add('active-np'); npRange = parseInt(b.dataset.r, 10); refreshNewPlayers();
}));
$('zoneEditBtn').addEventListener('click', () => { if (zoneEditMode) closeZoneEditorAndSave(); else openZoneEditor(); });
$('svType').addEventListener('change', () => { svCapture(); svRenderEditor(); });
$('svAddOption').addEventListener('click', () => {
  svCapture();
  svDraft.options.push({ id: '', label: {} });
  svRenderEditor();
});
$('svSave').addEventListener('click', svSave);
$('svFillEn').addEventListener('click', svFillFromEn);
$('svReset').addEventListener('click', () => { svDraft = svBlank(); svLang = 'en'; svShowError(''); svRenderEditor(); });
$('deathMapSelect').addEventListener('change', (e) => {
  _deathMapId = parseInt(e.target.value, 10);
  drawDeathMap();                                    // croix tout de suite...
  refreshDeaths();                                   // ...classements de la carte ensuite
});
$('annPublish').addEventListener('click', publishAnnouncement);
$('annDelete').addEventListener('click', deleteAnnouncement);
$('reportsExport').addEventListener('click', exportReportsCSV);
$('reportsClear').addEventListener('click', clearReports);
$('updPublish').addEventListener('click', publishUpdate);
$('updClear').addEventListener('click', clearUpdate);
$('cfgSave').addEventListener('click', saveSettings);
$('cfgTest').addEventListener('click', testConnection);
if ($('cfgTrackedSave')) $('cfgTrackedSave').addEventListener('click', saveTrackedVersion);
if ($('trackedPill')) $('trackedPill').addEventListener('click', () => switchTab('settings'));
$('tokenToggle').addEventListener('click', () => {
  const inp = $('cfgToken'), btn = $('tokenToggle');
  if (inp.type === 'password') { inp.type = 'text'; btn.textContent = 'HIDE'; } else { inp.type = 'password'; btn.textContent = 'REVEAL'; }
});
// update dropzone
const _dz = $('updDropzone'), _fi = $('updFileInput');
if (_dz && _fi) {
  _fi.addEventListener('change', () => { if (_fi.files.length) addUpdateFiles(_fi.files); _fi.value = ''; });
  _dz.addEventListener('dragover', (e) => { e.preventDefault(); _dz.classList.add('drag'); $('dropTitle').textContent = 'Release to bind the archive'; });
  _dz.addEventListener('dragleave', () => { _dz.classList.remove('drag'); $('dropTitle').textContent = 'Drag the plugin files here'; });
  _dz.addEventListener('drop', (e) => { e.preventDefault(); _dz.classList.remove('drag'); $('dropTitle').textContent = 'Drag the plugin files here'; if (e.dataTransfer.files.length) addUpdateFiles(e.dataTransfer.files); });
}
// Fullscreen F11
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); if (typeof nw !== 'undefined') { const win = nw.Window.get(); if (win.isFullscreen) win.leaveFullscreen(); else win.enterFullscreen(); } }
});

// ===================================================================
//  INTERVALS
// ===================================================================
setInterval(pollLive, 3000);
setInterval(refreshDropoff, 60 * 1000);
// Des totaux cumulatifs bougent lentement : inutile de les recharger quand
// l'onglet n'est même pas affiché.
setInterval(() => { if (currentTab === 'gameplay') refreshGameplay(); }, 60 * 1000);
// Idem pour les sondages : rafraîchir l'onglet caché n'apporte rien, et ça
// écraserait le brouillon en cours d'écriture.
setInterval(() => { if (currentTab === 'surveys') refreshSurveys(); }, 60 * 1000);
setInterval(refreshConcurrent, 5 * 60 * 1000);
setInterval(refreshNewPlayers, 5 * 60 * 1000);
/* Ces cinq-la tournaient toutes les 5 s, soit 60 requetes/minute a eux seuls,
   au-dessus du quota admin du serveur : les panneaux rejetes echouaient en
   silence, faute de remontee d'erreur. Aucune de ces donnees ne bouge a la
   seconde — repartition par plateforme, par version, par langue, libelles de
   zones, cumuls de sessions. */
setInterval(fetchPlatforms, 30 * 1000);
setInterval(fetchVersions, 30 * 1000);
setInterval(fetchSessionStats, 30 * 1000);
setInterval(fetchZoneLabels, 30 * 1000);
setInterval(fetchLanguages, 30 * 1000);
setInterval(fetchToday, 60 * 1000);
setInterval(checkReportsBadge, 60 * 1000);
setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
setInterval(fetchAnnouncement, 5 * 60 * 1000);
setInterval(() => { if (currentTab === 'announce') { fetchAnnouncement(); fetchLinks(); } }, 60 * 1000);
setInterval(tickClock, 1000);
setInterval(pingLatency, 10 * 1000);

// ===================================================================
//  BOOT
// ===================================================================
if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission();
buildStatCards();
startParticles();
tickClock();
if ($('buildVer')) $('buildVer').textContent = APP_VERSION;
populateSettings();
checkReportsBadge();
connect();
