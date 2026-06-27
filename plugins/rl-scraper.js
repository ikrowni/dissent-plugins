// rl-scraper.js — shared rlstats.net HTML scraping utilities
// Imported by rl-hub and rl-sidebar to avoid duplicating parsing logic.
import { request } from './plugin-sdk.js';

// ── Platform URL mapping ──────────────────────────────────────────────────────

const PLATFORM_URL_MAP = {
  epic:   'Epic',
  steam:  'Steam',
  psn:    'PS4',
  xbl:    'Xbox',
  switch: 'Switch',
};

// ── Playlist name → mode ID mapping ──────────────────────────────────────────

const PLAYLIST_NAME_TO_ID = {
  '1v1 Duel':     11,
  '2v2 Doubles':  12,
  '3v3 Standard': 13,
  'Tournaments':  34,
  '2v2 Hoops':    27,
  '3v3 Rumble':   28,
  '3v3 Dropshot': 29,
  '3v3 Snow Day': 30,
  // Keep bare names as fallback in case the site varies
  'Hoops':        27,
  'Rumble':       28,
  'Dropshot':     29,
  'Snow Day':     30,
};

const HISTORY_COL_TO_MODE_ID = {
  'Duel': 11, 'Doubles': 12, 'Standard': 13, 'Tournament': 34,
  'Hoops': 27, 'Rumble': 28, 'Dropshot': 29, 'Snow Day': 30,
};

// ── MMR extraction ─────────────────────────────────────────────────────────────
// Cell text may be plain "752" or "<mmr>~17</mmr> 752 <mmr>~4</mmr>".
// textContent strips tags; we then discard delta tokens (prefixed with ~).

function extractMMR(td) {
  const text = td.textContent.trim();
  if (!text || text === '—' || text === '-') return null;
  const tokens = text.split(/\s+/).filter(t => t && !t.startsWith('~'));
  const numToken = tokens.find(t => /^\d{3,4}$/.test(t));
  return numToken ? parseInt(numToken, 10) : null;
}

// ── Season reward ─────────────────────────────────────────────────────────────

function parseSeasonReward(blockReward) {
  const img = blockReward.querySelector('img[alt]');
  const level = img ? img.getAttribute('alt') : 'Bronze';
  const progressEl = blockReward.querySelector('progress');
  let wins = 0;
  if (progressEl) {
    wins = parseInt(progressEl.getAttribute('value') ?? '0', 10) || 0;
  } else {
    const m = blockReward.textContent.match(/(\d+)\s*\/\s*10/);
    if (m) wins = parseInt(m[1], 10);
  }
  return { level, wins };
}

// ── Playlist table parsing ────────────────────────────────────────────────────
// Row structure from rlstats.net:
//   rows[0]: <th> playlist names
//   rows[1]: <td> rank names
//   rows[2]: <td> divisions
//   rows[3]: <td> MMR (may contain <mmr> delta tags)
//   rows[4]: <th> rank images
//   rows[5]: <td> matches played
//   rows[6]: <td> streak

function parseSkillsTable(table) {
  const rows = table.querySelectorAll('tr');
  if (rows.length < 5) return {};

  const result = {};
  const headerCells = rows[0].querySelectorAll('th');

  headerCells.forEach((th, i) => {
    const playlistName = th.textContent.trim();
    const modeId = PLAYLIST_NAME_TO_ID[playlistName];
    if (!modeId) return;

    const rankCell    = rows[1]?.querySelectorAll('td')[i];
    const divCell     = rows[2]?.querySelectorAll('td')[i];
    const mmrCell     = rows[3]?.querySelectorAll('td')[i];
    const imgRow      = rows[4]?.querySelectorAll('th')[i];
    const matchesCell = rows[5]?.querySelectorAll('td')[i];

    const rankName = rankCell?.textContent.trim() ?? '';
    const division = divCell?.textContent.trim() ?? '';
    const mmr      = mmrCell ? extractMMR(mmrCell) : null;

    let iconSrc = null;
    if (imgRow) {
      const imgs = imgRow.querySelectorAll('img');
      if (imgs.length > 0) {
        const firstImg = imgs[0];
        if (firstImg.getAttribute('alt') === 'Unranked') {
          // Use the estimated rank image for unranked players
          const estimateImg = imgRow.querySelector('img.unranked-estimate');
          if (estimateImg) {
            const src = estimateImg.getAttribute('src');
            iconSrc = src ? (src.startsWith('http') ? src : `https://rlstats.net${src}`) : null;
          }
        } else {
          const src = firstImg.getAttribute('src');
          iconSrc = src ? (src.startsWith('http') ? src : `https://rlstats.net${src}`) : null;
        }
      }
    }

    const matches = parseInt(matchesCell?.textContent.trim() ?? '0', 10) || 0;

    result[modeId] = { mmr, rankName, division, iconSrc, matches };
  });

  return result;
}

// ── Season block parsing ──────────────────────────────────────────────────────

function parseSeasonBlock(block) {
  const rewardEl = block.querySelector('.block-reward');
  const reward = rewardEl ? parseSeasonReward(rewardEl) : { level: 'Bronze', wins: 0 };

  const playlists = {};
  block.querySelectorAll('.block-skills table').forEach(table => {
    Object.assign(playlists, parseSkillsTable(table));
  });

  return { reward, playlists };
}

// ── Season label mapping (e.g. internal 36 → "Season 22") ────────────────────

function parseSeasonLabels(doc) {
  const labels = {};
  doc.querySelectorAll('[data-season]').forEach(el => {
    const num = parseInt(el.getAttribute('data-season'), 10);
    if (isNaN(num)) return;
    const text = el.textContent.trim();
    if (/^Season\s+\d+$/i.test(text)) labels[num] = text;
  });
  return labels;
}

// ── Career stats ──────────────────────────────────────────────────────────────
// Table row format: <td>8,956 Wins</td>

function parseCareerStats(doc) {
  const statsSection = doc.querySelector('#stats section') ?? doc.querySelector('#stats');
  if (!statsSection) return {};
  const blockStats = statsSection.querySelector('div.block-stats[data-season]');
  if (!blockStats) return {};
  const rows = blockStats.querySelectorAll('tr');
  if (rows.length < 2) return {};

  const result = {};
  rows[1].querySelectorAll('td').forEach(td => {
    const text = td.textContent.trim();
    const match = text.match(/^([\d,]+)\s+(.+)$/);
    if (!match) return;
    const num = parseInt(match[1].replace(/,/g, ''), 10);
    const label = match[2].toLowerCase();
    if (label.includes('win'))       result.wins    = num;
    else if (label.includes('goal'))   result.goals   = num;
    else if (label.includes('assist')) result.assists = num;
    else if (label.includes('save'))   result.saves   = num;
    else if (label.includes('shot'))   result.shots   = num;
    else if (label.includes('mvp'))    result.mvps    = num;
  });
  return result;
}

// ── MMR history table ─────────────────────────────────────────────────────────
// Hidden accessible table: div[aria-label="A tabular representation..."]
// Columns: Day, Duel, Doubles, Standard, Tournament, Quads, Heatseeker,
//          Hoops, Rumble, Dropshot, Snow Day

function parseHistory(doc) {
  const tableDiv = doc.querySelector('[aria-label="A tabular representation of the data in the chart."]');
  if (!tableDiv) return [];
  const table = tableDiv.querySelector('table');
  if (!table) return [];

  const rows = table.querySelectorAll('tr');
  if (rows.length < 2) return [];

  const headers = [];
  rows[0].querySelectorAll('th,td').forEach(cell => headers.push(cell.textContent.trim()));

  const history = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i].querySelectorAll('td');
    const entry = {};
    headers.forEach((header, j) => {
      const val = cells[j]?.textContent.trim() ?? '';
      if (header === 'Day') {
        entry.day = val;
      } else {
        const modeId = HISTORY_COL_TO_MODE_ID[header];
        if (modeId) {
          const num = parseInt(val, 10);
          if (!isNaN(num)) entry[modeId] = num;
        }
      }
    });
    if (entry.day) history.push(entry);
  }
  return history;
}

// ── Full page parse ────────────────────────────────────────────────────────────

function parseRLStatsPage(doc, platform, rlUsername) {
  const data = {
    platform, rlUsername,
    currentSeason: null,
    seasonLabels: {},
    seasons: {},
    career: {},
    history: [],
  };

  data.seasonLabels = parseSeasonLabels(doc);

  // Use #skills section if present, fall back to #skills directly
  const skillsContainer = doc.querySelector('#skills section') ?? doc.querySelector('#skills');
  if (skillsContainer) {
    skillsContainer.querySelectorAll('div.block-body[data-season]').forEach(block => {
      const seasonNum = parseInt(block.getAttribute('data-season'), 10);
      if (isNaN(seasonNum)) return;
      data.seasons[seasonNum] = parseSeasonBlock(block);
    });
  }

  // Current season = highest season number present
  const seasonNums = Object.keys(data.seasons).map(Number).sort((a, b) => b - a);
  data.currentSeason = seasonNums[0] ?? null;

  data.career = parseCareerStats(doc);
  data.history = parseHistory(doc);

  return data;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Fetch and parse an rlstats.net profile page. Returns normalized data object. */
export async function scrapeRLStats(platform, rlUsername) {
  const urlPlatform = PLATFORM_URL_MAP[platform] ?? platform;
  const url = `https://rlstats.net/profile/${encodeURIComponent(urlPlatform)}/${encodeURIComponent(rlUsername)}`;
  const result = await request('fetch:external', { url });
  if (!result || result.status !== 200) throw new Error(`HTTP ${result?.status ?? 'unknown'}`);

  const body = result.body;
  const doc  = new DOMParser().parseFromString(body, 'text/html');


  return parseRLStatsPage(doc, platform, rlUsername);
}

/** Get playlist data for a given mode and season (defaults to currentSeason). */
export function getPlaylistData(data, modeId, seasonNum = null) {
  const season = seasonNum ?? data?.currentSeason;
  return data?.seasons?.[season]?.playlists?.[modeId] ?? null;
}

/** Get sorted season numbers (descending — most recent first). */
export function getSeasonNums(data) {
  return Object.keys(data?.seasons ?? {}).map(Number).sort((a, b) => b - a);
}

/** Get display label for a season number (e.g. "Season 22").
 *  rlstats.net internal numbers are 14 ahead of display numbers (36 → Season 22). */
export function getSeasonLabel(data, seasonNum) {
  return data?.seasonLabels?.[seasonNum] ?? `Season ${seasonNum - 14}`;
}
