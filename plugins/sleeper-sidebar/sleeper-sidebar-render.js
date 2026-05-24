// sleeper-sidebar/sleeper-sidebar-render.js

export function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function timeAgo(epochMs) {
  const diff = Date.now() - epochMs;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function renderSpinner() {
  return '<div class="spinner"></div>';
}

export function renderError(msg) {
  return `<div class="s-empty">${esc(msg)}</div>`;
}

export function renderSectionHeader(icon, label) {
  return `<div class="s-sect">${esc(icon)} ${esc(label)}</div>`;
}

export function renderSetupScreen() {
  return `
    <div class="setup-screen">
      <div class="setup-icon">🏈</div>
      <div class="setup-title">Sleeper Fantasy</div>
      <div class="setup-desc">Connect your Sleeper account to see your leagues, matchups, and standings.</div>
      <div class="setup-form">
        <input id="usernameInput" class="setup-input" type="text" placeholder="Your Sleeper username" autocomplete="off" spellcheck="false"/>
        <button id="connectBtn" class="setup-btn">Connect</button>
        <div id="setupError" class="setup-error" style="display:none"></div>
      </div>
    </div>`;
}

export function renderLeagueTabs(leagues, selectedIndex) {
  if (leagues.length <= 1) return '';
  const tabs = leagues.map((l, i) => {
    const name = (l.name || 'League').slice(0, 16);
    const active = i === selectedIndex ? ' tab-active' : '';
    return `<button class="league-tab${active}" data-idx="${i}">${esc(name)}</button>`;
  }).join('');
  return `<div class="league-tabs">${tabs}</div>`;
}

// ─── In-season renderers ───────────────────────────────────────────────────

export function renderMatchup(myMatchup, oppMatchup, myRoster, oppRoster, myUser, oppUser, players) {
  if (!myMatchup || !oppMatchup) return renderError('No matchup found for this week.');

  const myPts = (myMatchup.points || 0).toFixed(2);
  const oppPts = (oppMatchup.points || 0).toFixed(2);
  const myName = esc(myUser?.metadata?.team_name || myUser?.display_name || 'My Team');
  const oppName = esc(oppUser?.metadata?.team_name || oppUser?.display_name || 'Opponent');

  const myLead = parseFloat(myPts) >= parseFloat(oppPts);

  const starterRows = (myMatchup.starters || []).map(pid => {
    const p = players?.[pid];
    const name = p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : pid;
    const pos = p?.position || '—';
    const pts = (myMatchup.players_points?.[pid] || 0).toFixed(2);
    return `<div class="starter-row">
      <span class="starter-pos">${esc(pos)}</span>
      <span class="starter-name">${esc(name)}</span>
      <span class="starter-pts">${esc(pts)}</span>
    </div>`;
  }).join('');

  return `
    <div class="matchup-card">
      <div class="matchup-score">
        <div class="matchup-side${myLead ? ' side-lead' : ''}">
          <div class="side-name">${myName}</div>
          <div class="side-pts">${esc(myPts)}</div>
        </div>
        <div class="matchup-vs">vs</div>
        <div class="matchup-side${!myLead ? ' side-lead' : ''}">
          <div class="side-name">${oppName}</div>
          <div class="side-pts">${esc(oppPts)}</div>
        </div>
      </div>
      ${starterRows ? `<div class="starters-label">Your Starters</div><div class="starters-list">${starterRows}</div>` : ''}
    </div>`;
}

export function renderStandings(rosters, users, playoffTeamCount) {
  if (!rosters?.length) return renderError('No standings data.');

  const userMap = {};
  (users || []).forEach(u => { userMap[u.user_id] = u; });

  const sorted = [...rosters].sort((a, b) => {
    const aw = a.settings?.wins || 0, bw = b.settings?.wins || 0;
    if (bw !== aw) return bw - aw;
    const af = (a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100;
    const bf = (b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100;
    return bf - af;
  });

  const rows = sorted.map((r, i) => {
    const u = userMap[r.owner_id];
    const teamName = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
    const w = r.settings?.wins || 0;
    const l = r.settings?.losses || 0;
    const fpts = ((r.settings?.fpts || 0) + (r.settings?.fpts_decimal || 0) / 100).toFixed(2);
    const isPlayoff = i < (playoffTeamCount || 4);
    return `<div class="standing-row${isPlayoff ? ' playoff-spot' : ''}">
      <span class="standing-rank">${i + 1}</span>
      <span class="standing-name">${esc(teamName)}</span>
      <span class="standing-record">${esc(w)}-${esc(l)}</span>
      <span class="standing-pts">${esc(fpts)}</span>
    </div>`;
  }).join('');

  return `<div class="standings-list">${rows}</div>`;
}

export function renderTransactions(transactions, users, players) {
  if (!transactions?.length) return renderError('No recent transactions.');

  const userMap = {};
  (users || []).forEach(u => { userMap[u.user_id] = u; });

  const typeLabel = { trade: 'Trade', waiver: 'Waiver', free_agent: 'Free Agent' };
  const typeCls = { trade: 'tag-trade', waiver: 'tag-waiver', free_agent: 'tag-fa' };

  const rows = transactions.slice(0, 10).map(tx => {
    const label = typeLabel[tx.type] || tx.type;
    const cls = typeCls[tx.type] || 'tag-fa';
    const added = Object.keys(tx.adds || {}).map(pid => {
      const p = players?.[pid];
      return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : pid;
    });
    const dropped = Object.keys(tx.drops || {}).map(pid => {
      const p = players?.[pid];
      return p ? `${p.first_name || ''} ${p.last_name || ''}`.trim() : pid;
    });
    const detail = [
      added.length ? `+ ${added.slice(0,2).join(', ')}` : '',
      dropped.length ? `− ${dropped.slice(0,2).join(', ')}` : '',
    ].filter(Boolean).join('  ');
    const ago = tx.created ? timeAgo(tx.created) : '';
    return `<div class="tx-row">
      <span class="tx-tag ${esc(cls)}">${esc(label)}</span>
      <span class="tx-detail">${esc(detail || '—')}</span>
      <span class="tx-time">${esc(ago)}</span>
    </div>`;
  }).join('');

  return `<div class="tx-list">${rows}</div>`;
}

// ─── Offseason renderers ───────────────────────────────────────────────────

export function renderBracket(bracket, rosters, users) {
  if (!bracket?.length) return renderError('No bracket data.');

  const userMap = {};
  (users || []).forEach(u => { userMap[u.user_id] = u; });
  const rosterOwner = {};
  (rosters || []).forEach(r => { rosterOwner[r.roster_id] = r.owner_id; });

  function teamName(rosterId) {
    const uid = rosterOwner[rosterId];
    const u = userMap[uid];
    return u?.metadata?.team_name || u?.display_name || `Roster ${rosterId}`;
  }

  const rounds = {};
  bracket.forEach(m => {
    if (!rounds[m.r]) rounds[m.r] = [];
    rounds[m.r].push(m);
  });

  let html = '';
  Object.keys(rounds).sort((a,b) => a-b).forEach(r => {
    const roundLabel = r === '1' ? 'Round 1' : r === '2' ? 'Semifinals' : r === '3' ? 'Championship' : `Round ${r}`;
    html += `<div class="bracket-round">${esc(roundLabel)}</div>`;
    rounds[r].forEach(m => {
      if (!m.w) return;
      const winner = teamName(m.w);
      const loser = teamName(m.l);
      html += `<div class="bracket-match">
        <span class="bracket-winner">${esc(winner)}</span>
        <span class="bracket-def"> def. </span>
        <span class="bracket-loser">${esc(loser)}</span>
      </div>`;
    });
  });

  const maxRound = Math.max(...bracket.map(m => m.r));
  const champMatch = bracket.find(m => m.r === maxRound && m.w);
  if (champMatch) {
    html = `<div class="bracket-champ">🏆 ${esc(teamName(champMatch.w))}</div>` + html;
  }

  return `<div class="bracket-list">${html}</div>`;
}

export function renderDraftInfo(drafts, picks) {
  if (!drafts?.length) return renderError('No draft scheduled yet.');

  const draft = drafts[0];
  const statusLabel = { pre_draft: 'Not Started', drafting: 'In Progress', complete: 'Complete' };
  const typeLabel = { snake: 'Snake', auction: 'Auction', linear: 'Linear' };

  let html = `<div class="draft-meta">
    <span class="draft-type">${esc(typeLabel[draft.type] || draft.type)}</span>
    <span class="draft-status">${esc(statusLabel[draft.status] || draft.status)}</span>
  </div>`;

  if (draft.start_time) {
    const dt = new Date(draft.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    html += `<div class="draft-date">📅 ${esc(dt)}</div>`;
  }

  if (picks?.length) {
    const r1 = picks.filter(p => p.round === 1).slice(0, 12);
    html += `<div class="draft-picks-label">Round 1 Picks</div>`;
    html += r1.map(p => {
      const m = p.metadata || {};
      const name = `${m.first_name || ''} ${m.last_name || ''}`.trim() || p.player_id;
      const pos = m.position || '—';
      const team = m.team || '';
      return `<div class="draft-pick-row">
        <span class="pick-num">${esc(p.pick_no)}</span>
        <span class="pick-pos">${esc(pos)}</span>
        <span class="pick-name">${esc(name)}</span>
        <span class="pick-team">${esc(team)}</span>
      </div>`;
    }).join('');
  }

  return `<div class="draft-card">${html}</div>`;
}
