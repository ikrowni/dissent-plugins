// rl-sidebar-profile.js — profile card: ranks, stats, MMR chart, season selector
import { esc } from '../plugin-sdk.js';
import { scrapeRLStats, getPlaylistData, getSeasonNums, getSeasonLabel } from '../rl-scraper.js';
import { MODES } from './rl-sidebar-main.js';

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function setPanel(id, html) {
  const el = document.getElementById(`panel-${id}`);
  if (el) el.innerHTML = html;
}

// ── Ranks grid ────────────────────────────────────────────────────────────────

function renderRanksGrid(data, seasonNum) {
  let html = '<div class="ranks-grid">';
  MODES.forEach(mode => {
    const playlist = getPlaylistData(data, mode.id, seasonNum);
    const mmr      = playlist?.mmr ?? null;
    const rankName = playlist?.rankName ?? (mmr !== null ? 'Ranked' : 'Unranked');
    const division = playlist?.division ?? '';
    const iconSrc  = playlist?.iconSrc ?? null;

    html += `
      <div class="rank-card">
        ${iconSrc
          ? `<img class="rank-icon" src="${esc(Dissent.imageUrl(iconSrc))}" alt="${esc(rankName)}" loading="lazy">`
          : `<div class="rank-icon-placeholder"></div>`}
        <div class="rank-info">
          <div class="rank-mode">${esc(mode.short)}</div>
          <div class="rank-name">${esc(rankName)}${division ? ' ' + esc(division) : ''}</div>
          ${mmr !== null ? `<div class="rank-mmr">${mmr} MMR</div>` : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';
  return html;
}

// ── Season progression chart ──────────────────────────────────────────────────

function buildSeasonChart(data, modeId) {
  const seasonNums = getSeasonNums(data).slice().reverse(); // ascending chronological

  const points = seasonNums
    .map(s => {
      const pl = getPlaylistData(data, modeId, s);
      return pl?.mmr != null ? { season: s, mmr: pl.mmr, current: s === data.currentSeason } : null;
    })
    .filter(Boolean);

  if (points.length < 2) {
    const cur = getPlaylistData(data, modeId, data.currentSeason)?.mmr;
    const msg = cur != null ? `${cur} MMR — only one season of data` : 'No season data';
    return `<text x="8" y="65" fill="rgba(255,255,255,0.32)" font-size="9" font-family="system-ui">${msg}</text>`;
  }

  const W = 300, H = 130;
  const PL = 36, PR = 10, PT = 10, PB = 20;
  const CW = W - PL - PR, CH = H - PT - PB;

  const values  = points.map(p => p.mmr);
  const rawMin  = Math.min(...values), rawMax = Math.max(...values);
  const spread  = rawMax - rawMin;
  const interval = spread < 100 ? 25 : spread < 300 ? 50 : spread < 600 ? 100 : 200;
  const yMin    = Math.floor(rawMin / interval) * interval;
  const yMax    = Math.ceil(rawMax / interval) * interval;
  const yRange  = yMax - yMin || interval;

  const toY = v  => PT + CH - ((v - yMin) / yRange) * CH;
  const toX = i  => PL + (points.length > 1 ? (i / (points.length - 1)) * CW : CW / 2);

  const ySteps = Math.round(yRange / interval);
  let grid = '';
  for (let i = 0; i <= ySteps; i++) {
    const v = yMin + i * interval;
    const y = toY(v).toFixed(1);
    grid += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(255,255,255,0.055)" stroke-width="1"/>`;
    const lbl = v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
    grid += `<text x="${PL - 4}" y="${y}" text-anchor="end" dominant-baseline="middle" fill="rgba(255,255,255,0.28)" font-size="7.5" font-family="system-ui">${lbl}</text>`;
  }

  let xLabels = '';
  points.forEach((p, i) => {
    const x = toX(i).toFixed(1);
    xLabels += `<text x="${x}" y="${H - 5}" text-anchor="middle" fill="rgba(255,255,255,${p.current ? '0.6' : '0.28'})" font-size="7.5" font-family="system-ui" font-weight="${p.current ? '700' : '400'}">S${p.season - 14}</text>`;
  });

  const pts   = points.map((p, i) => `${toX(i).toFixed(1)},${toY(p.mmr).toFixed(1)}`);
  const baseY = (PT + CH).toFixed(1);
  const areaD = `M${PL},${baseY} L${pts.join(' L')} L${toX(points.length - 1).toFixed(1)},${baseY} Z`;

  let dots = '';
  points.forEach((p, i) => {
    const x = toX(i).toFixed(1), y = toY(p.mmr).toFixed(1);
    if (p.current) {
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="#f76c1b" stroke="rgba(9,9,18,0.85)" stroke-width="1.5"/>`;
      const lx = Math.min(parseFloat(x) + 6, W - PR - 22);
      const ly = Math.max(PT + 8, parseFloat(y) - 7);
      dots += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="rgba(255,255,255,0.8)" font-size="8.5" font-family="system-ui" font-weight="700">${p.mmr}</text>`;
    } else {
      dots += `<circle cx="${x}" cy="${y}" r="2.5" fill="#1a6fdb" stroke="rgba(9,9,18,0.85)" stroke-width="1"/>`;
    }
  });

  return `
    <defs>
      <linearGradient id="sg${modeId}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a6fdb" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="#1a6fdb" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${grid}${xLabels}
    <path d="${areaD}" fill="url(#sg${modeId})"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="#1a6fdb" stroke-width="1.5"
              stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}
  `;
}

// ── Chart section ─────────────────────────────────────────────────────────────

let _chartMode = 13; // default 3v3

function renderChartSection(data, season, isInCard, dissentUserId) {
  const modesWithData = MODES.filter(m => getPlaylistData(data, m.id, season)?.mmr != null);
  if (modesWithData.length === 0) return '';

  if (isInCard) {
    // For in-card rendering: prefer 3v3, else first available — no interactive pills
    const preferredMode = modesWithData.find(m => m.id === 13) ?? modesWithData[0];
    const svgContent = buildSeasonChart(data, preferredMode.id);
    return `
      <div class="sect-label">Season Progression (${esc(preferredMode.short)})</div>
      <div class="chart-wrap">
        <div class="chart-svg-wrap">
          <svg viewBox="0 0 300 130" width="100%" height="130" xmlns="http://www.w3.org/2000/svg">
            ${svgContent}
          </svg>
        </div>
      </div>
    `;
  }

  // Interactive mode pills for main overview tab
  if (!modesWithData.find(m => m.id === _chartMode)) {
    _chartMode = modesWithData[0].id;
  }

  const modePills = modesWithData.map(m => `
    <button class="chart-mode-btn ${m.id === _chartMode ? 'active' : ''}"
            onclick="setChartMode(${m.id})">${esc(m.short)}</button>
  `).join('');

  const svgContent = buildSeasonChart(data, _chartMode);

  return `
    <div class="sect-label">Season Progression</div>
    <div class="chart-wrap">
      <div class="chart-mode-row">${modePills}</div>
      <div class="chart-svg-wrap">
        <svg viewBox="0 0 300 130" width="100%" height="130" xmlns="http://www.w3.org/2000/svg">
          ${svgContent}
        </svg>
      </div>
    </div>
  `;
}

window.setChartMode = (modeId) => {
  _chartMode = modeId;
  const state = window._rlSidebarState;
  if (state) renderOverviewPanel(state.meta, state.data, state.season);
};

window.copyEpic = (name) => {
  navigator.clipboard.writeText(name).catch(() => {});
};

// ── Career stats HTML ─────────────────────────────────────────────────────────

function buildCareerStatsHTML(data) {
  const c = data.career ?? {};
  if (Object.keys(c).length === 0) return '';

  const stats = [
    { label: 'Wins',    value: fmtNum(c.wins)    },
    { label: 'Goals',   value: fmtNum(c.goals)   },
    { label: 'Assists', value: fmtNum(c.assists)  },
    { label: 'Saves',   value: fmtNum(c.saves)   },
    { label: 'Shots',   value: fmtNum(c.shots)   },
    { label: 'MVPs',    value: fmtNum(c.mvps)    },
  ];

  return `
    <div class="sect-label">Career Stats</div>
    <div class="stats-grid">
      ${stats.map(st => `
        <div class="stat-card">
          <div class="stat-value">${esc(st.value)}</div>
          <div class="stat-label">${esc(st.label)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Build Overview HTML (used by main panel AND member cards) ─────────────────

function buildOverviewHTML(meta, data, selectedSeason, opts = {}) {
  const { isInCard = false, dissentUserId = '', isLive = false } = opts;

  let html = '';

  // 1. Epic friend row
  if (meta.epicFriendName) {
    html += `
      <div class="epic-row">
        <div>
          <div class="epic-label">Add on Epic</div>
          <div class="epic-name">${esc(meta.epicFriendName)}</div>
        </div>
        <button class="copy-btn" onclick="copyEpic('${esc(meta.epicFriendName)}')">Copy</button>
      </div>
    `;
  }

  // 2. Season picker
  const seasonNums = getSeasonNums(data);
  if (seasonNums.length > 0) {
    const onchangeHandler = isInCard
      ? `selectMemberSeason('${esc(dissentUserId)}', this.value)`
      : `selectSeason(this.value)`;
    html += `
      <select class="season-selector" onchange="${onchangeHandler}">
        ${seasonNums.map(s => `<option value="${s}" ${s === selectedSeason ? 'selected' : ''}>${esc(getSeasonLabel(data, s))}</option>`).join('')}
      </select>
    `;
  }

  // 3. Ranks label + grid
  html += '<div class="sect-label">Ranks</div>';
  html += renderRanksGrid(data, selectedSeason);

  // 4. Season reward
  const reward = data.seasons?.[selectedSeason]?.reward;
  if (reward?.level) {
    const wins    = reward.wins ?? 0;
    const maxWins = 10;
    const pct     = Math.min(100, Math.round((wins / maxWins) * 100));
    html += `
      <div class="sect-label">Season Reward</div>
      <div class="reward-row">
        <div class="reward-top">
          <div>
            <div class="reward-label">${esc(reward.level)}</div>
            <div class="reward-level">${wins} / ${maxWins} wins</div>
          </div>
        </div>
        <div class="reward-bar-bg"><div class="reward-bar-fill" style="width:${pct}%"></div></div>
      </div>
    `;
  }

  // 5. Season Progression chart
  html += renderChartSection(data, selectedSeason, isInCard, dissentUserId);

  // 6. Career Stats
  html += buildCareerStatsHTML(data);

  // 7. Watch Live button (only in card context)
  if (isInCard) {
    html += `
      <button class="watch-live-btn${isLive ? ' live' : ''}" ${isLive ? `onclick="viewLiveMatch('${esc(dissentUserId)}')"` : 'disabled'}>
        ${isLive ? '● WATCH LIVE' : 'NOT LIVE'}
      </button>
    `;
  }

  return html;
}

// ── Overview panel ────────────────────────────────────────────────────────────

function renderOverviewPanel(meta, data, selectedSeason) {
  const panel = document.getElementById('panel-overview');
  if (!panel) return;
  panel.innerHTML = buildOverviewHTML(meta, data, selectedSeason, { isInCard: false });
}

// ── Season picker handlers ────────────────────────────────────────────────────

window.selectSeason = (season) => {
  const s = parseInt(season, 10);
  const state = window._rlSidebarState;
  if (!state) return;
  state.season = s;
  renderOverviewPanel(state.meta, state.data, s);
};

window.selectMemberSeason = (dissentUserId, season) => {
  const s = parseInt(season, 10);
  const states = window._memberCardStates ?? {};
  const state = states[dissentUserId];
  if (!state) return;
  state.season = s;
  const el = document.getElementById(`memexp-${dissentUserId}`);
  if (!el) return;
  el.innerHTML = buildOverviewHTML(state.meta, state.data, s, { isInCard: true, dissentUserId, isLive: state.isLive });
};

// ── Fetch profile ─────────────────────────────────────────────────────────────

async function fetchAndRenderProfile(meta) {
  setPanel('overview', '<div class="sidebar-loading"><div class="spinner"></div><span>Fetching stats…</span></div>');
  try {
    const profile = await scrapeRLStats(meta.platform, meta.rlUsername);
    renderAllPanels(meta, profile);
  } catch (err) {
    setPanel('overview', `<div class="empty-state">Could not load stats.<br><small>${esc(err.message)}</small></div>`);
  }
}

// ── Orchestrate all panels ────────────────────────────────────────────────────

function renderAllPanels(meta, data) {
  const seasonNums    = getSeasonNums(data);
  const currentSeason = seasonNums[0] ?? null;
  window._rlSidebarState = { meta, data, season: currentSeason };
  renderOverviewPanel(meta, data, currentSeason);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function renderProfile(meta, data, _config) {
  if (data) {
    renderAllPanels(meta, data);
  } else {
    fetchAndRenderProfile(meta);
  }
}

export function renderMemberCardContent(container, meta, data, selectedSeason, dissentUserId, isLive) {
  container.innerHTML = buildOverviewHTML(meta, data, selectedSeason, { isInCard: true, dissentUserId, isLive });
}

export async function fetchAndRenderMemberCard(container, member, isLive) {
  container.innerHTML = '<div class="sidebar-loading"><div class="spinner"></div><span>Fetching stats…</span></div>';
  try {
    const data = await scrapeRLStats(member.platform, member.rlUsername);
    const seasonNums = getSeasonNums(data);
    const currentSeason = seasonNums[0] ?? null;
    if (!window._memberCardStates) window._memberCardStates = {};
    const meta = { platform: member.platform, rlUsername: member.rlUsername, displayName: member.displayName, epicFriendName: member.epicFriendName ?? '' };
    window._memberCardStates[member.dissentUserId] = { meta, data, season: currentSeason, isLive };
    container.innerHTML = buildOverviewHTML(meta, data, currentSeason, { isInCard: true, dissentUserId: member.dissentUserId, isLive });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">Could not load stats.<br><small>${esc(err.message)}</small></div>`;
  }
}
