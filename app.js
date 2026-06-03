'use strict';

// ---------- NW.js modules (desktop only) ----------
let _nw = null;
try { _nw = { path: require('path'), fs: require('fs'), os: require('os'), https: require('https'), http: require('http'), cp: require('child_process') }; } catch(e) {}

// ---------- Zone display names + map names (mirrors SG_Telemetry.js + MapInfos.json) ----------
const ZONE_LABELS = {
  intro: 'Intro / Maison',
  jeu1: 'Trial 1',
  jeu2_hub: 'Trial 2 — Hub',
  jeu2_gauche: 'Trial 2 — Left',
  jeu2_droite: 'Trial 2 — Right',
  jeu2_arbre: 'Trial 2 — Tree',
  endgame: 'Endgame',
  speciales: 'Special rooms',
  unknown: 'Unknown'
};
const ZONE_ORDER = ['intro','jeu1','jeu2_hub','jeu2_gauche','jeu2_droite','jeu2_arbre','endgame','speciales','unknown'];
const APP_VERSION = (function() {
  try {
    if (_nw) {
      const vf = _nw.path.join(_nw.path.dirname(process.execPath), 'package.nw', '.sg_version');
      if (_nw.fs.existsSync(vf)) return _nw.fs.readFileSync(vf, 'utf8').trim();
    }
  } catch(e) {}
  try { return require('./package.json').version; } catch(e) {}
  return '1.0.0';
})();
const VERSION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

const MAP_NAMES = {
  1:'Introduction',2:'Maison MC',3:'Chambre Succube - 1',4:'Recollection Room',5:'Chambre Succube - 3',
  6:'Jeu 1-1',7:'Jeu 1-2',8:'Jeu 1-4',9:'Jeu 1-3',10:'Jeu 1-5',11:'Jeu 1-6',12:'Jeu 1-7',
  13:'Chambre MC - Etage',14:'Chambre Succube - 2',15:'Chambre Succube - 4',16:'Chambre Succube - 5',
  17:'Chambre Succube - Final',18:'Jeu 2-1 (Hub)',19:'Jeu 2-2 (Gauche)',20:'Game Over Room',
  21:'Jeu 2-2 (Bonus Gauche)',22:'Jeu 2-2 (Grotte)',23:'Jeu 2-3 (Droite)',24:'Jeu 2-3 (Grotte)',
  25:'Jeu 2-3 (Bonus)',26:'Jeu 2-3 (Sommet)',27:'Jeu 2-3 (Grotte Fin)',28:'Jeu 2-2 (Buissons)',
  29:'Jeu 2-2 (Bonus Buissons)',30:'Jeu 2-4 (Arbre Outside)',31:'Jeu 2-4 (Arbre Inside)'
};
const mapLabel = (id) => MAP_NAMES[id] ? `${MAP_NAMES[id]} (#${id})` : `Map ${id}`;

// ---------- Config (stored locally) ----------
function loadCfg() {
  try { return JSON.parse(localStorage.getItem('cfg') || '{}'); } catch (e) { return {}; }
}
function saveCfg(c) { localStorage.setItem('cfg', JSON.stringify(c)); }
let cfg = loadCfg();

// ---------- DOM refs ----------
const $ = (id) => document.getElementById(id);
const elOnline = $('onlineCount');
const elOnlineSub = $('onlineSub');
const elRecord = $('recordCount');
const elUnique = $('uniqueCount');
const elToday = $('todayCount');
const elZoneBars = $('zoneBars');
const elConn = $('connStatus');
const elUpdateNotice = $('updateNotice');
const elAnnouncementView = $('announcementView');
const elAnnounceTitle = $('announceTitle');
const elAnnounceBody = $('announceBody');
const elAnnounceUrl = $('announceUrl');
const elAnnounceVersion = $('announceVersion');
const elNavLive = $('navLive');
const elNavAnnouncement = $('navAnnouncement');
const elNavReports = $('navReports');
const elNavSettings = $('navSettings');
const elDropZones = $('dropoffZones').querySelector('tbody');
const elDropMaps = $('dropoffMaps').querySelector('tbody');

const DISMISSED_ANNOUNCEMENT_KEY = 'dismissedAnnouncementId';
let currentAnnouncementData = null;

// ---------- State ----------
let ws = null;
let reconnectTimer = null;
let lastRecord = 0;
let lastAnnouncementIdNotified = null;
let currentRange = '24h';
let prevOnline = null;
let lastWsTs = 0;
let lastReportCount = 0;
let _reportCountInitialized = false;
let reportsTabOpen = false;
const RANGE_MS = { '24h': 24*3600*1000, '7d': 7*24*3600*1000, '30d': 30*24*3600*1000 };
const BUCKET_MS = { '24h': 5*60*1000, '7d': 30*60*1000, '30d': 2*3600*1000 };

// ---------- Chart ----------
const chartCtx = $('concurrentChart').getContext('2d');
const chart = new Chart(chartCtx, {
  type: 'line',
  data: { labels: [], datasets: [{
    label: 'Online', data: [],
    borderColor: '#eaade5', backgroundColor: 'rgba(234,173,229,0.15)',
    fill: true, tension: 0.25, pointRadius: 0, borderWidth: 2
  }]},
  options: {
    responsive: true, maintainAspectRatio: false, resizeDelay: 200,
    animation: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#8a7891', maxTicksLimit: 8 }, grid: { color: '#2c2233' } },
      y: { ticks: { color: '#8a7891', precision: 0 }, grid: { color: '#2c2233' }, beginAtZero: true }
    }
  }
});

// ---------- Rendering ----------
function renderLive(live) {
  if (!live) return;
  // Online + flash if record beaten
  const n = live.totalOnline | 0;
  elOnline.textContent = n;
  elOnlineSub.textContent = n === 1 ? 'player' : 'players';
  elRecord.textContent = live.record | 0;
  elUnique.textContent = live.totalUniques | 0;
  if (live.record > lastRecord && lastRecord > 0) {
    elRecord.classList.add('flash');
    setTimeout(() => elRecord.classList.remove('flash'), 1200);
  }
  lastRecord = live.record;

  // Delta indicator
  const elDelta = $('onlineDelta');
  if (elDelta) {
    if (prevOnline !== null) {
      const d = n - prevOnline;
      elDelta.className = 'big-delta ' + (d > 0 ? 'delta-up' : d < 0 ? 'delta-down' : 'delta-eq');
      elDelta.textContent = d > 0 ? '+' + d : d < 0 ? String(d) : '—';
    }
    prevOnline = n;
  }

  // Zone bars
  const total = Math.max(1, n);
  const byZone = live.byZone || {};
  const existing = new Map();
  elZoneBars.querySelectorAll('.zone-row').forEach(row => existing.set(row.dataset.zone, row));

  for (const zone of ZONE_ORDER) {
    const count = byZone[zone] || 0;
    let row = existing.get(zone);
    if (!row) {
      row = document.createElement('div');
      row.className = 'zone-row';
      row.dataset.zone = zone;
      row.innerHTML = `
        <div class="zone-name">${ZONE_LABELS[zone] || zone}</div>
        <div class="zone-bar-wrap"><div class="zone-bar"></div></div>
        <div class="zone-count">0</div>`;
      elZoneBars.appendChild(row);
    }
    row.querySelector('.zone-bar').style.width = ((count / total) * 100).toFixed(1) + '%';
    row.querySelector('.zone-count').textContent = count;
    existing.delete(zone);
  }
}

function renderDropoff(d) {
  const fillRows = (tbody, list, labeller) => {
    tbody.innerHTML = '';
    for (const r of list) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${labeller(r.key)}</td><td>${r.count}</td>`;
      tbody.appendChild(tr);
    }
    if (list.length === 0) tbody.innerHTML = '<tr><td colspan="2" style="opacity:0.5">no data yet</td></tr>';
  };
  fillRows(elDropZones, d.byZone || [], k => ZONE_LABELS[k] || k);
  fillRows(elDropMaps, d.byMap || [], k => mapLabel(parseInt(k, 10)));
}

function renderConcurrent(points) {
  const labels = points.map(p => {
    const d = new Date(p.bucket);
    return currentRange === '24h'
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit' });
  });
  chart.data.labels = labels;
  chart.data.datasets[0].data = points.map(p => p.count);
  chart.update('none');
}

// ---------- API ----------
async function api(path) {
  if (!cfg.url || !cfg.token) return null;
  const res = await fetch(cfg.url.replace(/\/+$/, '') + path, {
    headers: { 'Authorization': 'Bearer ' + cfg.token }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

async function fetchReports() {
  const tbody = document.querySelector('#reportsTable tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8a7891">Loading…</td></tr>';
  try {
    const data = await api('/v1/reports');
    if (!data) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8a7891">Not connected — configure settings first.</td></tr>';
      return;
    }
    const reports = data.reports || [];
    if (reports.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#8a7891">No reports yet</td></tr>';
      return;
    }
    tbody.innerHTML = reports.map(function(r) {
      var time = new Date(r.ts).toLocaleString();
      var errFull = String(r.error || '').replace(/</g, '&lt;');
      var errShort = errFull.slice(0, 80);
      var errMore = errFull.length > 80
        ? '<details style="margin-top:2px"><summary style="font-size:11px;cursor:pointer;color:#8a7891">show more</summary><div style="font-size:12px;margin-top:4px;color:#d4bede">' + errFull + '</div></details>'
        : '';
      var zone = ZONE_LABELS[r.zone] || r.zone || '—';
      var ver = r.version || '—';
      var plat = r.platform || '—';
      var pid = r.player_id ? r.player_id.slice(0, 8) + '…' : '—';
      var stack = r.stack ? '<details style="margin-top:4px"><summary style="font-size:11px;cursor:pointer;color:#8a7891">stack trace</summary><pre style="font-size:10px;white-space:pre-wrap;margin:4px 0 0;color:#a08aaa;max-width:600px">' + String(r.stack).replace(/</g, '&lt;').slice(0, 2000) + '</pre></details>' : '';
      var shot = r.screenshot
        ? '<img src="data:image/jpeg;base64,' + r.screenshot + '" style="max-height:48px;border-radius:4px;cursor:pointer;display:block" onclick="showScreenshot(\'' + r.screenshot + '\')" />'
        : '<span style="color:#4a3a5a">—</span>';
      return '<tr>'
        + '<td style="white-space:nowrap;font-size:11px;color:#8a7891">' + time + '</td>'
        + '<td style="color:#d4bede"><div style="font-size:12px">' + errShort + '</div>' + errMore + stack + '</td>'
        + '<td>' + zone + '</td>'
        + '<td>' + ver + '</td>'
        + '<td>' + plat + '</td>'
        + '<td style="font-size:11px;color:#6a5472">' + pid + '</td>'
        + '<td>' + shot + '</td>'
        + '</tr>';
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#c87070">Error: ' + e.message + '</td></tr>';
  }
}

async function refreshDropoff() {
  try { renderDropoff(await api('/v1/stats/dropoff?rangeMs=' + (24*3600*1000))); }
  catch (e) { /* ignore */ }
}
async function refreshConcurrent() {
  try {
    const range = RANGE_MS[currentRange], bucket = BUCKET_MS[currentRange];
    renderConcurrent(await api(`/v1/stats/concurrent?rangeMs=${range}&bucketMs=${bucket}`));
  } catch (e) { /* ignore */ }
}

// ---------- WebSocket ----------
function setConn(state, text) {
  elConn.className = 'status ' + state;
  const t = elConn.querySelector('.status-text');
  if (t) t.textContent = text; else elConn.textContent = text;
}

function hideUpdateNotice() {
  if (!elUpdateNotice) return;
  elUpdateNotice.classList.add('hidden');
  elUpdateNotice.innerHTML = '';
}

function showUpdateModal(version, url, notes) {
  const existing = document.getElementById('sgUpdateModal');
  if (existing) return;

  const overlay = document.createElement('div');
  overlay.id = 'sgUpdateModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,4,20,0.92);display:flex;align-items:center;justify-content:center;z-index:10000;';

  const box = document.createElement('div');
  box.style.cssText = 'background:#1a0d2e;border:1px solid rgba(234,173,229,0.3);border-radius:12px;padding:32px;width:480px;max-width:90vw;';
  box.innerHTML = `
    <h2 style="color:#eaade5;margin:0 0 10px;font-size:18px;">Update available — v${version}</h2>
    ${notes ? `<p style="color:#9a7aaa;font-size:13px;margin:0 0 20px;white-space:pre-wrap;max-height:120px;overflow-y:auto;">${notes}</p>` : '<p style="color:#9a7aaa;font-size:13px;margin:0 0 20px;">A new version is ready to install.</p>'}
    <div id="sgUpdateProgress" style="display:none;margin-bottom:16px;">
      <div style="background:#2c1a40;border-radius:4px;height:6px;overflow:hidden;">
        <div id="sgUpdateBar" style="background:#eaade5;height:100%;width:0%;transition:width 0.3s;"></div>
      </div>
      <p id="sgUpdateText" style="color:#9a7aaa;font-size:12px;margin:6px 0 0;"></p>
    </div>
    <div style="display:flex;gap:12px;justify-content:flex-end;">
      <button id="sgUpdateLater" style="background:transparent;color:#6a4870;border:1px solid #3a2450;border-radius:6px;padding:8px 18px;cursor:pointer;font-size:13px;">Later</button>
      <button id="sgUpdateInstall" style="background:rgba(234,173,229,0.15);color:#eaade5;border:1px solid rgba(234,173,229,0.4);border-radius:6px;padding:8px 20px;cursor:pointer;font-size:13px;">Install & Restart</button>
    </div>
  `;

  overlay.appendChild(box);
  document.body.appendChild(overlay);

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
  const bar = document.getElementById('sgUpdateBar');
  const txt = document.getElementById('sgUpdateText');
  const setTxt = (t) => { if (txt) txt.textContent = t; };
  const setBar = (pct) => { if (bar) bar.style.width = pct + '%'; };

  const tmpZip = path.join(os.tmpdir(), 'sg-dashboard-update.zip');
  const exePath = process.execPath;
  const packageNwDir = path.join(path.dirname(exePath), 'package.nw');

  setTxt('Downloading…');

  function doGet(getUrl, cb) {
    const parsed = new URL(getUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    transport.get(getUrl, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        doGet(res.headers.location, cb);
      } else {
        cb(null, res);
      }
    }).on('error', (err) => cb(err));
  }

  doGet(url, (err, res) => {
    if (err) { setTxt('✗ ' + err.message); return; }
    const total = parseInt(res.headers['content-length'] || '0', 10);
    let done = 0;
    const file = fs.createWriteStream(tmpZip);
    res.on('data', (chunk) => {
      done += chunk.length;
      if (total > 0) setBar(Math.round(done / total * 100));
    });
    res.pipe(file);
    file.on('finish', () => {
      file.close();
      setBar(100); setTxt('Extracting…');
      const ps = `Expand-Archive -LiteralPath '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${packageNwDir.replace(/'/g, "''")}' -Force`;
      cp.execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], (err2) => {
        try { fs.unlinkSync(tmpZip); } catch(e) {}
        if (err2) { setTxt('✗ Failed: ' + err2.message); return; }
        try { if (targetVersion) fs.writeFileSync(path.join(packageNwDir, '.sg_version'), targetVersion); } catch(e) {}
        setTxt('Restarting…');
        const bat = `@echo off\r\ntimeout /t 2 /nobreak > nul\r\nstart "" "${exePath}"\r\ndel "%~f0"\r\n`;
        const batPath = path.join(os.tmpdir(), 'sg-relaunch.bat');
        fs.writeFileSync(batPath, bat);
        cp.spawn('cmd.exe', ['/c', batPath], { detached: true, stdio: 'ignore' }).unref();
        setTimeout(() => nw.App.quit(), 600);
      });
    });
    file.on('error', (e) => { fs.unlink(tmpZip, () => {}); setTxt('✗ ' + e.message); });
  });
}

function populateAnnouncementForm() {
  const announcement = currentAnnouncementData;
  if (!elAnnounceTitle) return;
  elAnnounceTitle.value = announcement?.title || '';
  elAnnounceBody.value = announcement?.body || '';
  elAnnounceUrl.value = announcement?.url || '';
  elAnnounceVersion.value = announcement?.version || '';

  const statsEl = $('announceStats');
  if (statsEl) {
    if (announcement && announcement.viewCount != null) {
      const n = announcement.viewCount;
      statsEl.innerHTML = `
        <span class="stat-label">Annonce active</span>
        <span class="stat-views">${n}<span class="stat-views-label">&nbsp;vue${n !== 1 ? 's' : ''}</span></span>
      `;
      statsEl.classList.remove('hidden');
    } else {
      statsEl.classList.add('hidden');
    }
  }
}

function populateSettings() {
  $('cfgUrl').value = cfg.url || '';
  $('cfgToken').value = cfg.token || '';
  const el = $('appVersionLabel');
  if (el) el.innerHTML = 'SuccubusStats v' + APP_VERSION + ' &nbsp;·&nbsp; made by Henergyque &nbsp;·&nbsp; Kutushmurf est un enculé';
}

const TAB_NAV_MAP = {
  'tab-live': 'navLive',
  'tab-announcement': 'navAnnouncement',
  'tab-reports': 'navReports',
  'tab-update': 'navUpdate',
  'tab-settings': 'navSettings'
};

const ALL_TABS = Object.keys(TAB_NAV_MAP);

function showTab(tabId) {
  ALL_TABS.forEach(id => {
    const tab = document.getElementById(id);
    if (tab) tab.classList.add('hidden');
    const nav = document.getElementById(TAB_NAV_MAP[id]);
    if (nav) nav.classList.remove('active');
  });
  const target = document.getElementById(tabId);
  if (target) target.classList.remove('hidden');
  const activeNav = document.getElementById(TAB_NAV_MAP[tabId]);
  if (activeNav) activeNav.classList.add('active');
  if (tabId === 'tab-announcement') {
    fetchAnnouncement();
  }
  if (tabId === 'tab-reports') {
    fetchReports();
    reportsTabOpen = true;
    const badge = $('reportsBadge');
    if (badge) badge.classList.add('hidden');
  } else {
    reportsTabOpen = false;
  }
  if (tabId === 'tab-settings') {
    populateSettings();
  }
  if (tabId === 'tab-update') {
    fetchCurrentUpdate();
  }
}

async function publishAnnouncement() {
  if (!elAnnounceTitle || !elAnnounceBody) return;
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  const title = elAnnounceTitle.value.trim();
  const body = elAnnounceBody.value.trim();
  if (!title || !body) {
    return alert('Title and message are required to publish an announcement.');
  }
  try {
    const payload = {
      title,
      body,
      url: elAnnounceUrl.value.trim() || undefined,
      version: elAnnounceVersion.value.trim() || undefined
    };
    const data = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/announcement', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + cfg.token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!data.ok) throw new Error('HTTP ' + data.status);
    const json = await data.json();
    currentAnnouncementData = json.announcement || null;
    renderAnnouncement(currentAnnouncementData);
    populateAnnouncementForm();
    alert('Announcement published.');
  } catch (e) {
    alert('Unable to publish announcement. Check the URL/token and try again.');
  }
}

async function deleteAnnouncement() {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  if (!confirm('Delete the current active announcement?')) return;
  try {
    const data = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/announcement', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + cfg.token }
    });
    if (!data.ok) throw new Error('HTTP ' + data.status);
    currentAnnouncementData = null;
    renderAnnouncement(null);
    populateAnnouncementForm();
    alert('Announcement deleted.');
  } catch (e) {
    alert('Unable to delete announcement. Check the URL/token and try again.');
  }
}


function loadDismissedAnnouncementId() {
  return localStorage.getItem(DISMISSED_ANNOUNCEMENT_KEY);
}
function saveDismissedAnnouncementId(id) {
  if (!id) return localStorage.removeItem(DISMISSED_ANNOUNCEMENT_KEY);
  localStorage.setItem(DISMISSED_ANNOUNCEMENT_KEY, String(id));
}
function renderAnnouncement(announcement) {
  if (!elAnnouncementView) return;
  if (!announcement || !announcement.title || String(announcement.id) === loadDismissedAnnouncementId()) {
    elAnnouncementView.classList.add('hidden');
    elAnnouncementView.innerHTML = '';
    return;
  }

  const actionLink = announcement.url ? `<a href="${announcement.url}" target="_blank">Open announcement</a>` : '';
  const versionTag = announcement.version ? ` <span style="opacity:.75">(${announcement.version})</span>` : '';
  const _esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  elAnnouncementView.innerHTML = `
    <div class="announce-title">${_esc(announcement.title)}${versionTag}</div>
    <div class="announce-text">${_esc(announcement.body)}</div>
    <div class="announce-actions">
      ${actionLink}
      <button id="dismissAnnouncement">Got it</button>
    </div>
  `;
  elAnnouncementView.classList.remove('hidden');
  const btn = document.getElementById('dismissAnnouncement');
  if (btn) {
    btn.addEventListener('click', () => {
      saveDismissedAnnouncementId(announcement.id);
      renderAnnouncement(null);
    });
  }
}

async function fetchAnnouncement() {
  try {
    const data = await api('/v1/announcement');
    const announcement = data?.announcement || null;
    currentAnnouncementData = announcement;
    renderAnnouncement(announcement);
    populateAnnouncementForm();
    if (announcement && announcement.id && announcement.id !== lastAnnouncementIdNotified && String(announcement.id) !== loadDismissedAnnouncementId()) {
      lastAnnouncementIdNotified = announcement.id;
      if (Notification && Notification.permission === 'granted') {
        new Notification('SuccubusStats', {
          body: announcement.body,
          silent: true
        });
      }
    }
  } catch (e) {
    // ignore
  }
}

async function checkVersion() {
  try {
    const data = await api('/v1/version');
    const latest = String(data?.latest || '').trim();
    const url = String(data?.url || '').trim();
    const notes = String(data?.notes || '').trim();
    if (!latest) return;
    if (latest !== APP_VERSION) {
      if (_nw && url) {
        showUpdateModal(latest, url, notes);
      } else {
        if (!elUpdateNotice) return;
        elUpdateNotice.classList.remove('hidden');
        elUpdateNotice.innerHTML = `New version available: <strong>${latest}</strong>`;
      }
    } else {
      hideUpdateNotice();
    }
  } catch (e) {
    // ignore version check failures
  }
}

function connect() {
  if (!cfg.url || !cfg.token) {
    setConn('err', 'configure settings');
    showTab('tab-settings');
    return;
  }
  setConn('', 'connecting…');
  const wsUrl = cfg.url.replace(/^http/, 'ws').replace(/\/+$/, '') + '/v1/stream?token=' + encodeURIComponent(cfg.token);
  try {
    ws = new WebSocket(wsUrl);
  } catch (e) {
    setConn('err', 'invalid URL');
    return;
  }
  ws.onopen = () => {
    setConn('ok', 'live');
    refreshDropoff();
    refreshConcurrent();
    checkVersion();
    fetchAnnouncement();
    fetchToday();
    checkReportsBadge();
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'snapshot') {
        lastWsTs = Date.now();
        const elLU = $('lastUpdate');
        if (elLU) elLU.textContent = 'updated just now';
        renderLive(msg.live);
      }
      if (msg.type === 'bug_report') {
        if (reportsTabOpen) {
          fetchReports();
        } else {
          const badge = $('reportsBadge');
          if (badge) badge.classList.remove('hidden');
        }
      }
    } catch (e) {}
  };
  ws.onclose = () => {
    setConn('err', 'disconnected');
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

// Live data polling — fallback when WebSocket snapshot is slow (server may batch pushes)
let _liveEndpointExists = true;
async function pollLive() {
  if (!cfg.url || !cfg.token || !_liveEndpointExists) return;
  // Skip if WebSocket delivered a fresh snapshot recently (within 4s)
  if (Date.now() - lastWsTs < 4000) return;
  try {
    const data = await api('/v1/live');
    if (data && data.live) renderLive(data.live);
  } catch (e) {
    // 404 = endpoint doesn't exist, stop polling to avoid noise
    if (e.message && e.message.includes('404')) _liveEndpointExists = false;
  }
}
setInterval(pollLive, 3000);

// dropoff refresh every 60s, concurrent every 5min
setInterval(refreshDropoff, 60 * 1000);
setInterval(refreshConcurrent, 5 * 60 * 1000);
setInterval(checkVersion, VERSION_CHECK_INTERVAL_MS);
setInterval(fetchAnnouncement, 5 * 60 * 1000);

// Reports badge + notification Windows — poll count every 60s
async function checkReportsBadge() {
  if (!cfg.url || !cfg.token) return;
  try {
    const data = await api('/v1/reports');
    const count = (data?.reports || []).length;
    if (!_reportCountInitialized) { _reportCountInitialized = true; lastReportCount = count; return; }
    if (count > lastReportCount) {
      const diff = count - lastReportCount;
      if (!reportsTabOpen) {
        const badge = $('reportsBadge');
        if (badge) badge.classList.remove('hidden');
      }
      if (Notification && Notification.permission === 'granted') {
        new Notification('SuccubusStats — Bug report', {
          body: diff === 1 ? '1 nouveau rapport reçu.' : `${diff} nouveaux rapports reçus.`,
          silent: false
        });
      }
    }
    lastReportCount = count;
  } catch (e) { /* ignore */ }
}
setInterval(checkReportsBadge, 60 * 1000);

// Joueurs du jour
async function fetchToday() {
  if (!cfg.url || !cfg.token) return;
  try {
    const data = await api('/v1/stats/today');
    if (elToday && data?.today != null) elToday.textContent = data.today;
  } catch (e) { /* ignore */ }
}
setInterval(fetchToday, 60 * 1000);

// Export CSV
function exportReportsCSV(reports) {
  const header = ['Time', 'Error', 'Zone', 'Version', 'Platform', 'Player', 'Screenshot'];
  const rows = reports.map(r => [
    new Date(r.ts).toLocaleString(),
    String(r.error || '').replace(/"/g, '""'),
    r.zone || '',
    r.version || '',
    r.platform || '',
    r.player_id || '',
    r.screenshot ? '[screenshot attached]' : ''
  ].map(v => `"${v}"`).join(','));
  const csv = [header.join(','), ...rows].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reports-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Screenshot lightbox
function showScreenshot(base64) {
  var existing = document.getElementById('sg-screenshot-lightbox');
  if (existing) existing.remove();
  var lb = document.createElement('div');
  lb.id = 'sg-screenshot-lightbox';
  lb.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out';
  lb.innerHTML = '<img src="data:image/jpeg;base64,' + base64 + '" style="max-width:90%;max-height:90%;border-radius:6px;box-shadow:0 0 40px rgba(0,0,0,0.8)">';
  lb.addEventListener('click', function() { lb.remove(); });
  document.body.appendChild(lb);
}

// Last-updated ticker
setInterval(() => {
  const el = $('lastUpdate');
  if (!el || !lastWsTs) return;
  const s = Math.floor((Date.now() - lastWsTs) / 1000);
  el.textContent = s < 60 ? `updated ${s}s ago` : `updated ${Math.floor(s / 60)}m ago`;
}, 10 * 1000);

// ---------- Range tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentRange = btn.dataset.range;
    refreshConcurrent();
  });
});

elNavLive?.addEventListener('click', () => showTab('tab-live'));
elNavAnnouncement?.addEventListener('click', () => showTab('tab-announcement'));
elNavReports?.addEventListener('click', () => showTab('tab-reports'));
$('navUpdate')?.addEventListener('click', () => showTab('tab-update'));
elNavSettings?.addEventListener('click', () => showTab('tab-settings'));
$('reportsClear')?.addEventListener('click', async () => {
  if (!confirm('Clear all bug reports?')) return;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/reports', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + cfg.token }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lastReportCount = 0;
    fetchReports();
  } catch (e) {
    alert('Unable to clear reports. Check URL/token.');
  }
});
$('cfgSave')?.addEventListener('click', () => {
  cfg = { url: $('cfgUrl').value.trim(), token: $('cfgToken').value.trim() };
  saveCfg(cfg);
  if (ws) { try { ws.close(); } catch (e) {} }
  connect();
  showTab('tab-live');
});
$('announcePublish')?.addEventListener('click', publishAnnouncement);
$('announceDelete')?.addEventListener('click', deleteAnnouncement);

// ---------- Fullscreen (F11) ----------
document.addEventListener('keydown', (e) => {
  if (e.key === 'F11') {
    e.preventDefault();
    if (typeof nw !== 'undefined') {
      const win = nw.Window.get();
      if (win.isFullscreen) win.leaveFullscreen();
      else win.enterFullscreen();
    }
  }
});

// ---------- Boot ----------
if (Notification && Notification.permission === 'default') Notification.requestPermission();
checkReportsBadge();
fetchToday();
$('reportsExport')?.addEventListener('click', async () => {
  try {
    const data = await api('/v1/reports');
    exportReportsCSV(data?.reports || []);
  } catch (e) { alert('Unable to fetch reports.'); }
});

// ---------- Game Update ----------
const _updateStagedFiles = [];

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

async function fetchCurrentUpdate() {
  const el = $('updateCurrentInfo');
  if (!el) return;
  try {
    const data = await api('/v1/game/update/admin');
    const m = data?.manifest;
    if (!m || !m.version) {
      el.innerHTML = '<span class="update-none">No update published</span>';
      return;
    }
    let html = '<span class="update-version">v' + m.version + '</span>';
    if (Array.isArray(m.files)) {
      for (const f of m.files) {
        const name = f.filename || f.path?.split('/').pop() || '?';
        html += '<div class="update-file-entry">' + name + '</div>';
      }
    }
    el.innerHTML = html;
  } catch(e) {
    el.innerHTML = '<span class="update-none">Unable to fetch</span>';
  }
}

function renderStagedFiles() {
  const el = $('updateFileList');
  if (!el) return;
  if (_updateStagedFiles.length === 0) { el.innerHTML = ''; return; }
  el.innerHTML = _updateStagedFiles.map((f, i) => `
    <div class="update-file-item">
      <span class="file-name">${f.name}</span>
      <span class="file-size">${formatBytes(f.size)}</span>
      <button class="file-remove" data-idx="${i}">&times;</button>
    </div>
  `).join('');
  el.querySelectorAll('.file-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      _updateStagedFiles.splice(parseInt(btn.dataset.idx, 10), 1);
      renderStagedFiles();
    });
  });
}

function addFiles(fileList) {
  for (const file of fileList) {
    if (_updateStagedFiles.some(f => f.name === file.name)) continue;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = btoa(new Uint8Array(reader.result).reduce((s, b) => s + String.fromCharCode(b), ''));
      _updateStagedFiles.push({ name: file.name, size: file.size, content: base64 });
      renderStagedFiles();
    };
    reader.readAsArrayBuffer(file);
  }
}

// Drop zone
const dropZone = $('updateDropZone');
const fileInput = $('updateFileInput');
if (dropZone && fileInput) {
  dropZone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ''; });
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

// Publish
$('updatePublish')?.addEventListener('click', async () => {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  const version = ($('updateVersion')?.value || '').trim();
  if (!version) return alert('Enter a version number.');
  if (_updateStagedFiles.length === 0) return alert('Add at least one file.');

  const files = _updateStagedFiles.map(f => {
    let dir = 'www/js/plugins/';
    if (f.name.endsWith('.json')) dir = 'www/data/';
    else if (/\.(png|jpg|jpeg|gif|webp)$/i.test(f.name)) dir = 'www/img/';
    else if (/\.(ogg|mp3|wav|m4a)$/i.test(f.name)) dir = 'www/audio/';
    return { name: f.name, path: dir + f.name, content: f.content };
  });

  const btn = $('updatePublish');
  if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }

  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/game/update', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, files })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    _updateStagedFiles.length = 0;
    renderStagedFiles();
    if ($('updateVersion')) $('updateVersion').value = '';
    fetchCurrentUpdate();
    alert('Update v' + version + ' published!');
  } catch(e) {
    alert('Failed to publish: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Publish update'; }
  }
});

// Clear
$('updateClear')?.addEventListener('click', async () => {
  if (!cfg.url || !cfg.token) return alert('Configure settings first.');
  if (!confirm('Clear the current game update? Players will no longer receive it.')) return;
  try {
    const res = await fetch(cfg.url.replace(/\/+$/, '') + '/v1/game/update', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + cfg.token }
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    fetchCurrentUpdate();
    alert('Update cleared.');
  } catch(e) {
    alert('Failed to clear: ' + e.message);
  }
});

connect();
