// FGC Dashboard frontend — vanilla JS, no build step.
const POLL_MS = 30_000;
const $ = (sel, root = document) => root.querySelector(sel);

const state = {
  overview: null,
  info: null,
  games: { q: '', store: '', group: '', user: '', sort: 'date', dir: 'desc', page: 1 },
  tab: 'games',
};

// ---------- helpers ----------
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dtFull = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dtDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const dtMonth = new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' });
const dtMonthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const fmt = (iso, f = dtFull) => (iso ? f.format(new Date(iso)) : '—');

function relative(iso) {
  if (!iso) return '—';
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [u, s] of units) if (abs >= s) return rtf.format(Math.round(diff / s), u);
  return rtf.format(Math.round(diff), 'second');
}

function duration(sec) {
  if (sec == null) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function countdown(ms) {
  if (ms <= 0) return 'any moment';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (d) return `${d}d ${h}h ${pad(m)}m`;
  if (h) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  return `${m}m ${pad(sec)}s`;
}

async function api(path) {
  const res = await fetch(path, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

const GROUP_LABEL = { claimed: 'Claimed', owned: 'Already owned', failed: 'Failed', pending: 'Pending', info: 'Other' };

function chip(g) {
  const title = g.status && g.status !== GROUP_LABEL[g.group]?.toLowerCase() ? ` title="${esc(g.status)}"` : '';
  let label = GROUP_LABEL[g.group] ?? g.group;
  // Surface the specific reason for failures / info rows.
  if (g.group === 'failed' && g.status.includes(':')) label = `Failed · ${g.status.split(':').slice(1).join(':').replace(/_/g, ' ')}`;
  if (g.group === 'info') label = g.status.replace(/_/g, ' ');
  if (g.status === 'claimed and redeemed') label = 'Claimed & redeemed';
  return `<span class="chip ${esc(g.group)}"${title}>${esc(label)}</span>`;
}

// ---------- overview ----------
async function refresh() {
  try {
    state.overview = await api('/api/overview');
    renderOverview();
    $('#updated').textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch (err) {
    showBanner([`Could not load dashboard data: ${esc(err.message)}`], true);
  }
}

function showBanner(messages, critical = false) {
  const el = $('#banner');
  el.hidden = messages.length === 0;
  el.className = `banner${critical ? ' critical' : ''}`;
  el.innerHTML = messages.map((m) => `<div>${m}</div>`).join('');
}

function renderOverview() {
  const { status, schedule, services, stats } = state.overview;

  // Banners
  const msgs = [];
  let critical = false;
  if (status.database === 'missing') msgs.push('No <code>fgc.db</code> found in the data directory yet. Has the claimer run at least once? Check the <code>/fgc/data</code> volume mount.');
  if (status.database === 'error') { msgs.push(`Database error: ${esc(status.databaseError)}`); critical = true; }
  if (status.docker === 'error') msgs.push(`Docker API unreachable (${esc(status.dockerError)}). Schedule shown from the .env file and may be estimated.`);
  if (status.container && !status.container.running) {
    if (schedule.runOnce) {
      msgs.push(`The claimer container <b>${esc(status.container.name)}</b> is <b>${esc(status.container.state)}</b>. It runs in run-once mode, so it stops after each run until something starts it again (cron, Ofelia or a restart policy).`);
    } else {
      msgs.push(`The claimer container <b>${esc(status.container.name)}</b> is <b>${esc(status.container.state)}</b>, so no runs will happen.`);
      critical = true;
    }
  }
  if (services.catalogError) msgs.push(`Couldn't read the store list from the claimer (${esc(services.catalogError)}), so the dashboard's built-in list is shown. Stores added in newer claimer versions may be missing.`);
  if (status.dryRun) msgs.push('<b>DRYRUN</b> is enabled: the claimer only checks for games and does not claim them.');
  if (services.unknownStores.length) msgs.push(`Unrecognised entries in <code>STORES</code>: ${services.unknownStores.map(esc).join(', ')}`);
  if (!schedule.timezoneValid) msgs.push('<code>SCHEDULER_TIMEZONE</code> is not a valid IANA zone; showing fixed times in UTC.');
  if (status.stale) msgs.push('Showing cached data: the database was busy or unreadable on the last refresh.');
  showBanner(msgs, critical);

  // Container pill
  const pill = $('#container-pill');
  if (status.container) {
    const c = status.container;
    const tone = !c.running ? 'critical' : c.health === 'unhealthy' ? 'critical' : c.health === 'starting' ? 'warning' : 'good';
    const label = !c.running ? c.state : c.health ? c.health : 'running';
    pill.innerHTML = `<span class="dot ${tone}"></span>${esc(c.name)} · ${esc(label)}${c.version ? ` · v${esc(c.version.replace(/^v/i, ''))}` : ''}`;
    pill.title = [c.image, c.commit && `commit ${c.commit}`, c.branch].filter(Boolean).join(' · ');
    pill.hidden = false;
  } else {
    pill.innerHTML = `<span class="dot"></span>${status.docker === 'disabled' ? 'Docker status off' : 'Container unknown'}`;
    pill.title = 'Set DOCKER_HOST (e.g. a docker-socket-proxy) to show the container state, exact next run and run history.';
    pill.hidden = false;
  }

  renderSchedule();

  // Run info
  const run = status.run;
  $('#running').hidden = !run?.inProgress;
  if (run?.inProgress) $('#running-since').textContent = ` · started ${relative(run.current.start)}`;
  $('#last-run').textContent = run?.last ? relative(run.last.start) : status.lastActivity ? `activity ${relative(status.lastActivity)}` : '—';
  $('#last-run').title = run?.last ? fmt(run.last.start) : status.lastActivity ? `Latest database change: ${fmt(status.lastActivity)}` : '';
  $('#last-duration').textContent = run?.last ? duration(run.last.durationSec) : '—';
  $('#started-at').textContent = status.container?.startedAt ? relative(status.container.startedAt) : '—';
  $('#started-at').title = status.container?.startedAt ? fmt(status.container.startedAt) : '';

  // Tiles
  const enabled = services.services.filter((s) => s.enabled).length;
  $('#t-claimed').textContent = stats.claimedTotal;
  $('#t-month').textContent = stats.thisMonth;
  $('#t-services').textContent = `${enabled}`;
  $('#t-failed').textContent = stats.totals.failed ?? 0;

  renderChart(stats.months);
  renderServices(services);
  renderRuns(status);
  loadGames();
}

function scheduleText(s) {
  if (s.mode === 'once') {
    return 'Run-once mode (RUN_ONCE, or no SCHEDULER_HOURS/SCHEDULER_FIXED_TIMES): the claimer runs once when the container starts, then stops. Something outside it, like cron or Ofelia, decides when it runs next.';
  }
  const parts = [];
  if (s.intervalHours > 0) parts.push(`every ${s.intervalHours} h from container start`);
  if (s.fixedTimes.length) parts.push(`daily at ${s.fixedTimes.join(', ')} (${s.timezone})`);
  let text = `Runs ${parts.join(' and ')}`;
  text += s.runOnStartup ? '. Also runs when the container starts.' : '.';
  return text;
}

function renderSchedule() {
  const s = state.overview.schedule;
  $('#schedule-desc').textContent = scheduleText(s);
  const badge = $('#next-source');
  const badges = {
    exact: ['exact', 'Computed from the container start time and the schedule.'],
    estimated: ['estimated', 'Docker is not connected, so the interval is anchored on the last observed run or database activity. Connect a docker-socket-proxy for exact times.'],
    partial: ['partial', 'Fixed times are exact, but an interval run may come sooner. Connect a docker-socket-proxy for exact times.'],
  };
  const b = badges[s.nextRunSource];
  badge.hidden = !b;
  if (b) {
    badge.className = `badge ${s.nextRunSource}`;
    badge.textContent = b[0];
    badge.title = b[1];
  }
  $('#upcoming-list').innerHTML = s.upcoming
    .map((u) => `<li>${esc(fmt(u.at))} <span>· ${u.kind === 'fixed' ? 'fixed time' : 'interval'}${u.source === 'estimated' ? ' (est.)' : ''}</span></li>`)
    .join('') || '<li>None scheduled</li>';
  tick();
}

function tick() {
  const o = state.overview;
  if (!o) return;
  const s = o.schedule;
  const el = $('#countdown');
  if (s.mode === 'once') {
    el.textContent = 'On demand';
    $('#next-abs').textContent = 'Run-once mode: the next run is whenever the container is started';
  } else if (o.status.container && !o.status.container.running) {
    el.textContent = 'Stopped';
    $('#next-abs').textContent = 'The claimer container is not running';
  } else if (s.nextRun) {
    el.textContent = countdown(Date.parse(s.nextRun) - Date.now());
    $('#next-abs').textContent = fmt(s.nextRun);
  } else if (s.unknownReason === 'no-anchor') {
    el.textContent = 'Unknown';
    $('#next-abs').textContent = 'Interval schedule needs the container start time. Enable Docker access.';
  } else {
    el.textContent = 'Not scheduled';
    $('#next-abs').textContent = '';
  }
}

// ---------- chart (single series → one hue, no legend) ----------
function renderChart(months) {
  const host = $('#chart');
  const W = Math.max(280, host.clientWidth || 600);
  const H = 220;
  const pad = { t: 18, r: 8, b: 26, l: 30 };
  const max = Math.max(1, ...months.map((m) => m.count));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 4 / 5) * 5;
  const top = Math.ceil(max / step) * step;
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const slot = iw / months.length;
  const bw = Math.min(36, Math.max(6, slot - 6));
  const y = (v) => pad.t + ih - (v / top) * ih;

  let grid = '';
  for (let v = 0; v <= top; v += step) {
    grid += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text class="axis-y" x="${pad.l - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }

  const maxIdx = months.reduce((bi, m, i) => (m.count >= months[bi].count ? i : bi), 0);
  let bars = '';
  months.forEach((m, i) => {
    const x = pad.l + i * slot + (slot - bw) / 2;
    const h = ih - (y(m.count) - pad.t);
    const r = Math.min(4, h / 2, bw / 2);
    const yb = pad.t + ih;
    const path = h > 0
      ? `M${x},${yb} V${yb - h + r} Q${x},${yb - h} ${x + r},${yb - h} H${x + bw - r} Q${x + bw},${yb - h} ${x + bw},${yb - h + r} V${yb} Z`
      : '';
    const label = dtMonthYear.format(new Date(`${m.month}-01T00:00:00Z`));
    bars += `<rect class="hit" x="${pad.l + i * slot}" y="${pad.t}" width="${slot}" height="${ih}" data-tip="${esc(`${label}: ${m.count} claimed`)}"/>`;
    bars += path ? `<path class="bar" d="${path}"/>` : '';
    // Selective direct labels: the peak and the current month only.
    if (m.count > 0 && (i === maxIdx || i === months.length - 1)) {
      bars += `<text class="value" x="${x + bw / 2}" y="${yb - h - 5}" text-anchor="middle">${m.count}</text>`;
    }
    const showTick = months.length <= 12 && (W > 480 || i % 2 === (months.length - 1) % 2);
    if (showTick) bars += `<text class="axis-x" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(dtMonth.format(new Date(`${m.month}-01T00:00:00Z`)))}</text>`;
  });

  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Games claimed per month, last 12 months: ${months.map((m) => `${m.month} ${m.count}`).join(', ')}">
    <g class="grid axis">${grid}</g><g class="axis">${bars}</g></svg>`;
}

function setupTooltip() {
  const tip = $('#tooltip');
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    t.nextElementSibling?.classList?.add('active');
  });
  document.addEventListener('pointermove', (e) => {
    if (tip.hidden) return;
    const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 12);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${e.clientY - tip.offsetHeight - 10}px`;
  });
  document.addEventListener('pointerout', (e) => {
    const t = e.target.closest?.('[data-tip]');
    if (!t) return;
    tip.hidden = true;
    t.nextElementSibling?.classList?.remove('active');
  });
}

// ---------- services ----------
function renderServices(data) {
  const list = [...data.services].sort((a, b) => Number(b.enabled) - Number(a.enabled) || (b.counts.claimed - a.counts.claimed));
  const notify = [data.notify.apprise && 'Apprise', data.notify.discord && 'Discord'].filter(Boolean);
  const storeList = data.catalogSource === 'built-in' ? 'built-in store list' : `stores read from ${data.catalogSource}`;
  $('#services-meta').textContent = `Config from ${data.source} · ${storeList} · Notifications: ${notify.length ? notify.join(' + ') : 'off'}`;
  $('#services').innerHTML = list.map((s) => {
    const flags = [];
    if (s.enabled === true) flags.push('<span class="flag ok">✓ Enabled</span>');
    else if (s.enabled === false) flags.push(`<span class="flag">${s.optIn ? 'Opt-in · off' : 'Disabled'}</span>`);
    if (s.credentialsConfigured === true) flags.push('<span class="flag ok">✓ Credentials</span>');
    else if (s.credentialsConfigured === false && s.enabled) flags.push('<span class="flag" title="No credentials in env. Login happens via noVNC and is stored in the browser profile.">Manual login</span>');
    if (s.otpConfigured) flags.push('<span class="flag ok">✓ 2FA</span>');
    if (s.enabled && s.profileExists) flags.push('<span class="flag" title="A browser profile exists, so this store has been used">Profile</span>');
    const accounts = s.accounts?.length ? `<span class="note">${s.accounts.map(esc).join(', ')}</span>` : '';
    return `<button type="button" class="service${s.enabled !== true ? ' disabled' : ''}" data-store="${esc(s.id)}" aria-label="Show ${esc(s.label)} games">
      <div class="service-head">
        <div><div class="service-name">${esc(s.label)}</div>${s.note ? `<div class="note">${esc(s.note)}</div>` : accounts}${s.discovered ? '<div class="note" title="This store is new to the dashboard. It was found in the claimer\'s own store list.">New in your claimer version</div>' : ''}</div>
      </div>
      <div class="service-flags">${flags.join('')}</div>
      <div class="counts">
        <div><b>${s.counts.claimed}</b><span>claimed</span></div>
        <div><b>${s.counts.owned}</b><span>owned</span></div>
        <div><b>${s.counts.failed}</b><span>failed</span></div>
      </div>
      <div class="last">${s.lastClaim ? `Last claim ${esc(relative(s.lastClaim))}` : 'No claims yet'}</div>
    </button>`;
  }).join('');
}

// ---------- runs ----------
function renderRuns(status) {
  const el = $('#runs');
  if (status.docker === 'disabled') {
    el.innerHTML = '<p class="empty">Run history is read from the claimer container\'s logs. Set <code>DOCKER_HOST</code> to a docker-socket-proxy to enable it.</p>';
    return;
  }
  const hist = status.run?.history ?? [];
  if (!hist.length) {
    el.innerHTML = `<p class="empty">${status.runError ? `Could not read logs: ${esc(status.runError)}` : 'No claiming runs since the container started.'}</p>`;
    return;
  }
  el.innerHTML = `<ul class="runs-list">${hist.map((r) => {
    const state = r.end ? `<span class="chip claimed">${esc(duration(r.durationSec))}</span>` : r.aborted ? '<span class="chip failed">No completion logged</span>' : '<span class="chip pending">Running</span>';
    return `<li><div><div>${esc(fmt(r.start))} <span class="muted small">· ${esc(relative(r.start))}</span></div>${r.stores ? `<div class="stores">${esc(r.stores)}</div>` : ''}</div>${state}</li>`;
  }).join('')}</ul>`;
}

// ---------- games ----------
function gamesQuery() {
  const g = state.games;
  const p = new URLSearchParams();
  for (const k of ['q', 'store', 'group', 'user', 'sort', 'dir', 'page']) if (g[k]) p.set(k, g[k]);
  p.set('pageSize', '25');
  return p.toString();
}

async function loadGames() {
  let data;
  try {
    data = await api(`/api/games?${gamesQuery()}`);
  } catch (err) {
    $('#games-body').innerHTML = `<tr><td colspan="5" class="empty">${esc(err.message)}</td></tr>`;
    return;
  }
  fillFacets(data.facets);
  state.games.page = data.page;
  const body = $('#games-body');
  if (!data.rows.length) {
    body.innerHTML = `<tr><td colspan="5" class="empty">${data.total === 0 && !Object.keys(data.facets.stores).length ? 'No games recorded yet.' : 'No games match these filters.'}</td></tr>`;
  } else {
    body.innerHTML = data.rows.map((g) => {
      const title = g.url ? `<a href="${esc(g.url)}" target="_blank" rel="noopener noreferrer">${esc(g.title)}</a>` : esc(g.title);
      const ext = g.externalStore ? `<span class="ext">Redeem on ${esc(g.externalStore)}</span>` : '';
      const code = g.code ? `<button type="button" class="code-btn" data-code="${esc(g.code)}">Show code</button>` : g.hasCode ? '<span class="ext" title="Set SHOW_CODES=true on the dashboard to reveal codes">Code hidden</span>' : '';
      return `<tr>
        <td class="title">${title}<span class="ext show-sm">${esc(g.storeLabel)} · ${esc(fmt(g.at, dtDate))}</span>${ext}${code}</td>
        <td class="hide-sm">${esc(g.storeLabel)}</td>
        <td class="hide-sm">${esc(g.user)}</td>
        <td>${chip(g)}</td>
        <td class="date hide-sm" title="${esc(g.at ? new Date(g.at).toLocaleString() : '')}">${esc(fmt(g.at, dtDate))}</td>
      </tr>`;
    }).join('');
  }
  $('#games-count').textContent = `${data.total} game${data.total === 1 ? '' : 's'}`;
  $('#page-info').textContent = `${data.page} / ${data.pages}`;
  $('#prev').disabled = data.page <= 1;
  $('#next').disabled = data.page >= data.pages;
  document.querySelectorAll('.games th button').forEach((b) => {
    if (b.dataset.sort === state.games.sort) b.setAttribute('aria-sort', state.games.dir === 'asc' ? 'ascending' : 'descending');
    else b.removeAttribute('aria-sort');
  });
}

function fillFacets(f) {
  const labels = Object.fromEntries((state.overview?.services.services ?? []).map((s) => [s.id, s.label]));
  const fill = (sel, entries, first) => {
    const el = $(sel);
    const cur = el.value;
    el.innerHTML = `<option value="">${first}</option>${entries.map(([v, l, n]) => `<option value="${esc(v)}">${esc(l)} (${n})</option>`).join('')}`;
    el.value = entries.some(([v]) => v === cur) ? cur : '';
  };
  fill('select[name=store]', Object.entries(f.stores).map(([k, n]) => [k, labels[k] ?? k, n]).sort((a, b) => a[1].localeCompare(b[1])), 'All stores');
  fill('select[name=user]', Object.entries(f.users).map(([k, n]) => [k, k, n]).sort((a, b) => a[1].localeCompare(b[1])), 'All accounts');
  $('select[name=store]').value = state.games.store;
  $('select[name=user]').value = state.games.user;
}

function setupGames() {
  const form = $('#filters');
  let timer;
  form.addEventListener('input', (e) => {
    state.games[e.target.name] = e.target.value;
    state.games.page = 1;
    clearTimeout(timer);
    timer = setTimeout(loadGames, e.target.name === 'q' ? 250 : 0);
  });
  form.addEventListener('submit', (e) => e.preventDefault());
  document.querySelectorAll('.games th button').forEach((b) => b.addEventListener('click', () => {
    const g = state.games;
    if (g.sort === b.dataset.sort) g.dir = g.dir === 'asc' ? 'desc' : 'asc';
    else { g.sort = b.dataset.sort; g.dir = b.dataset.sort === 'date' ? 'desc' : 'asc'; }
    g.page = 1;
    loadGames();
  }));
  $('#prev').addEventListener('click', () => { state.games.page--; loadGames(); });
  $('#next').addEventListener('click', () => { state.games.page++; loadGames(); });
  $('#games-body').addEventListener('click', (e) => {
    const b = e.target.closest('.code-btn');
    if (!b) return;
    const code = document.createElement('span');
    code.className = 'code';
    code.textContent = ` ${b.dataset.code}`;
    b.replaceWith(code);
  });
  $('#services').addEventListener('click', (e) => {
    const card = e.target.closest('.service');
    if (!card) return;
    state.games = { ...state.games, store: card.dataset.store, group: '', page: 1 };
    $('select[name=store]').value = card.dataset.store;
    $('select[name=group]').value = '';
    selectTab('games');
    loadGames();
    $('.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ---------- tabs & screenshots ----------
function selectTab(name) {
  state.tab = name;
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== name; });
  if (name === 'shots') loadShots();
}

async function loadShots() {
  const el = $('#shots');
  try {
    const { screenshots } = await api('/api/screenshots');
    el.innerHTML = screenshots.length
      ? screenshots.map((s) => {
        const src = `/api/screenshots/${s.path.split('/').map(encodeURIComponent).join('/')}`;
        return `<a class="shot" href="${esc(src)}" target="_blank" rel="noopener"><img src="${esc(src)}" alt="${esc(s.name)}" loading="lazy"><div class="cap"><b>${esc(s.store)}</b> · ${esc(s.name)}<br><span class="muted">${esc(relative(s.mtime))}</span></div></a>`;
      }).join('')
      : '<p class="empty">No failure screenshots. FGC-R saves one here when a claim fails.</p>';
  } catch (err) {
    el.innerHTML = `<p class="empty">${esc(err.message)}</p>`;
  }
}

function setupTheme() {
  $('#theme-toggle').addEventListener('click', () => {
    const root = document.documentElement;
    const isDark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = isDark ? 'light' : 'dark';
    try { localStorage.setItem('fgc-theme', root.dataset.theme); } catch { /* ignore */ }
  });
}

// ---------- boot ----------
async function main() {
  setupTheme();
  setupTooltip();
  setupGames();
  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => selectTab(t.dataset.tab)));
  api('/api/info').then((i) => { state.info = i; $('#dash-version').textContent = `v${i.version}`; }).catch(() => {});
  await refresh();
  setInterval(refresh, POLL_MS);
  setInterval(tick, 1000);
  let w = 0;
  new ResizeObserver(() => {
    const nw = $('#chart').clientWidth;
    if (state.overview && Math.abs(nw - w) > 4) { w = nw; renderChart(state.overview.stats.months); }
  }).observe($('#chart'));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
}

main();
