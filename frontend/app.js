/**
 * Trading Journal — Main Application
 * SPA with mock data (connects to FastAPI backend when available)
 */

// ============================================================
// CONFIG & STATE
// ============================================================
const API_BASE = 'http://localhost:8000/api';
let STATE = {
  accountId: 1,
  trades: [],
  tags: [],
  equity: [],
  analytics: null,
  strategies: [],
  monthlyPnl: [],
  symbolPerf: [],
  mae: [],
  currentDrawerTradeId: null,
  currentRating: 0,
  selectedTags: [],
  charts: {},
  usingMock: true,
};

// ============================================================
// BOOT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initAnalyticsTabs();
  loadMockData();   // Start with mock data by default
});

// ============================================================
// NAVIGATION
// ============================================================
function initNavigation() {
  document.querySelectorAll('.nav-item[data-page]').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
  });
}

function navigateTo(page) {
  // Update nav
  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-page="${page}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Show/hide pages
  document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) {
    pageEl.style.display = 'block';
    pageEl.classList.add('active');
  }

  // Lazy-render charts
  if (page === 'analytics') renderAnalyticsPage();
}

// ============================================================
// ANALYTICS TABS
// ============================================================
function initAnalyticsTabs() {
  document.querySelectorAll('#analyticsTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#analyticsTabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('#page-analytics .tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });
}

// ============================================================
// DATA LOADING
// ============================================================
function loadMockData() {
  STATE.usingMock = true;
  STATE.tags = generateMockTags();
  STATE.trades = generateMockTrades(60);
  STATE.equity = generateMockEquity();
  STATE.analytics = computeAnalytics(STATE.trades);
  STATE.strategies = computeStrategyPerformance(STATE.trades, STATE.tags);
  STATE.monthlyPnl = computeMonthlyPnl(STATE.trades);
  STATE.symbolPerf = computeSymbolPerformance(STATE.trades);
  STATE.mae = computeMAE(STATE.trades);

  renderAll();
  showToast('🎲 Mock data loaded — explore the app!');
}

async function handleSync() {
  const btn = document.getElementById('btnSync');
  btn.disabled = true;
  btn.textContent = '⏳ Syncing...';

  try {
    const resp = await fetch(`${API_BASE}/accounts/${STATE.accountId}/sync`, { method: 'POST' });
    if (resp.ok) {
      const data = await resp.json();
      showToast(`✅ ${data.message}`);
      await loadFromAPI();
    } else {
      showToast('❌ Sync failed — is backend + MT5 running?');
    }
  } catch (e) {
    showToast('⚠️ Backend not reachable — using mock data');
  }

  btn.disabled = false;
  btn.textContent = '🔄 Sync MT5';
}

async function loadFromAPI() {
  try {
    const [trades, tags, equity, analytics, strategies, monthly, symbols, mae] = await Promise.all([
      fetch(`${API_BASE}/accounts/${STATE.accountId}/trades?limit=500`).then(r => r.json()),
      fetch(`${API_BASE}/tags`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/equity`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/analytics/summary`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/analytics/strategies`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/analytics/monthly`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/analytics/symbols`).then(r => r.json()),
      fetch(`${API_BASE}/accounts/${STATE.accountId}/analytics/mae`).then(r => r.json()),
    ]);

    STATE.usingMock = false;
    STATE.trades = trades;
    STATE.tags = tags;
    STATE.equity = equity;
    STATE.analytics = analytics;
    STATE.strategies = strategies;
    STATE.monthlyPnl = monthly;
    STATE.symbolPerf = symbols;
    STATE.mae = mae;

    renderAll();
  } catch (e) {
    console.error('API load failed:', e);
  }
}

// ============================================================
// RENDERING
// ============================================================
function renderAll() {
  renderDashboard();
  renderTrades();
  populateFilters();
}

// ----- Dashboard -----
function renderDashboard() {
  const a = STATE.analytics;
  if (!a) return;

  const statsHtml = `
    <div class="stat-card animate-in">
      <div class="stat-label">Net Profit</div>
      <div class="stat-value ${a.net_profit >= 0 ? 'profit' : 'loss'}">$${a.net_profit.toLocaleString(undefined, {minimumFractionDigits:2})}</div>
      <div class="stat-sub">${a.total_trades} total trades</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Win Rate</div>
      <div class="stat-value blue">${a.win_rate}%</div>
      <div class="stat-sub">${a.winning_trades}W / ${a.losing_trades}L</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Profit Factor</div>
      <div class="stat-value ${a.profit_factor >= 1.5 ? 'profit' : a.profit_factor >= 1 ? 'blue' : 'loss'}">${a.profit_factor}</div>
      <div class="stat-sub">Gross P: $${a.total_profit.toFixed(0)} / L: $${a.total_loss.toFixed(0)}</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Avg R:R</div>
      <div class="stat-value blue">${a.avg_rr_ratio}</div>
      <div class="stat-sub">Avg Win $${a.avg_win.toFixed(0)} / Avg Loss $${a.avg_loss.toFixed(0)}</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Max Drawdown</div>
      <div class="stat-value loss">${a.max_drawdown_pct}%</div>
      <div class="stat-sub">Consec Wins: ${a.max_consecutive_wins} / Losses: ${a.max_consecutive_losses}</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Best / Worst</div>
      <div class="stat-value profit">$${a.best_trade.toFixed(2)}</div>
      <div class="stat-sub text-loss">Worst: $${a.worst_trade.toFixed(2)}</div>
    </div>
  `;
  document.getElementById('dashStats').innerHTML = statsHtml;

  // Equity chart
  renderEquityChart();
  renderMonthlyPnlChart();
  renderRecentTrades();
}

function renderEquityChart() {
  const ctx = document.getElementById('equityChart');
  if (STATE.charts.equity) STATE.charts.equity.destroy();

  const labels = STATE.equity.map(e => {
    const d = new Date(e.timestamp);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  STATE.charts.equity = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Balance',
          data: STATE.equity.map(e => e.balance),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: 'Equity',
          data: STATE.equity.map(e => e.equity),
          borderColor: '#8b5cf6',
          backgroundColor: 'rgba(139,92,246,0.05)',
          fill: true,
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    },
    options: chartOptions('$'),
  });
}

function renderMonthlyPnlChart() {
  const ctx = document.getElementById('monthlyPnlChart');
  if (STATE.charts.monthlyPnl) STATE.charts.monthlyPnl.destroy();

  STATE.charts.monthlyPnl = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: STATE.monthlyPnl.map(m => m.month),
      datasets: [
        {
          label: 'Profit',
          data: STATE.monthlyPnl.map(m => m.profit),
          backgroundColor: 'rgba(16,185,129,0.7)',
          borderRadius: 4,
        },
        {
          label: 'Loss',
          data: STATE.monthlyPnl.map(m => m.loss),
          backgroundColor: 'rgba(239,68,68,0.7)',
          borderRadius: 4,
        },
      ],
    },
    options: chartOptions('$'),
  });
}

function renderRecentTrades() {
  const recent = STATE.trades.slice(0, 8);
  const tbody = document.getElementById('recentTradesBody');
  tbody.innerHTML = recent.map(t => `
    <tr onclick="openDrawer(${t.id})">
      <td class="font-mono">${t.ticket_id}</td>
      <td class="fw-700 text-primary">${t.symbol}</td>
      <td><span class="badge badge-${t.trade_type.toLowerCase()}">${t.trade_type}</span></td>
      <td class="font-mono">${t.volume}</td>
      <td class="font-mono">${t.open_price.toFixed(5)}</td>
      <td class="font-mono">${t.close_price ? t.close_price.toFixed(5) : '—'}</td>
      <td class="font-mono ${getPnl(t) >= 0 ? 'text-profit' : 'text-loss'} fw-700">
        ${getPnl(t) >= 0 ? '+' : ''}$${getPnl(t).toFixed(2)}
      </td>
      <td><span class="badge badge-journal ${t.entry_rationale ? 'done' : 'pending'}">${t.entry_rationale ? '✓' : '!'}</span></td>
    </tr>
  `).join('');
}

// ----- Trade History -----
function renderTrades() {
  let filtered = [...STATE.trades];

  const sym = document.getElementById('filterSymbol').value;
  const type = document.getElementById('filterType').value;
  const tag = document.getElementById('filterTag').value;
  const journal = document.getElementById('filterJournal').value;

  if (sym) filtered = filtered.filter(t => t.symbol === sym);
  if (type) filtered = filtered.filter(t => t.trade_type === type);
  if (tag) filtered = filtered.filter(t => t.tags && t.tags.some(tg => tg.name === tag));
  if (journal === 'done') filtered = filtered.filter(t => t.entry_rationale);
  if (journal === 'pending') filtered = filtered.filter(t => !t.entry_rationale);

  const tbody = document.getElementById('tradesBody');
  tbody.innerHTML = filtered.map(t => {
    const pnl = getPnl(t);
    const tagStr = (t.tags || []).map(tg => `<span class="badge badge-tag">${tg.name}</span>`).join(' ');
    return `
      <tr onclick="openDrawer(${t.id})">
        <td class="font-mono">${t.ticket_id}</td>
        <td class="fw-700 text-primary">${t.symbol}</td>
        <td><span class="badge badge-${t.trade_type.toLowerCase()}">${t.trade_type}</span></td>
        <td class="font-mono">${t.volume}</td>
        <td class="font-mono">${t.open_price.toFixed(5)}</td>
        <td class="font-mono">${t.close_price ? t.close_price.toFixed(5) : '—'}</td>
        <td class="text-muted" style="font-size:0.78rem;">${formatDate(t.open_time)}</td>
        <td class="font-mono ${pnl >= 0 ? 'text-profit' : 'text-loss'} fw-700">
          ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}
        </td>
        <td>${tagStr || '<span class="text-muted">—</span>'}</td>
        <td><span class="badge badge-journal ${t.entry_rationale ? 'done' : 'pending'}">${t.entry_rationale ? '✓' : '!'}</span></td>
        <td><button class="btn btn-ghost btn-sm" onclick="event.stopPropagation(); openDrawer(${t.id})">✏️</button></td>
      </tr>
    `;
  }).join('');
}

function populateFilters() {
  // Symbols
  const symbols = [...new Set(STATE.trades.map(t => t.symbol))].sort();
  const symSelect = document.getElementById('filterSymbol');
  symSelect.innerHTML = '<option value="">All Symbols</option>' +
    symbols.map(s => `<option value="${s}">${s}</option>`).join('');

  // Tags
  const tagSelect = document.getElementById('filterTag');
  tagSelect.innerHTML = '<option value="">All Strategies</option>' +
    STATE.tags.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
}

// ----- Analytics -----
function renderAnalyticsPage() {
  const a = STATE.analytics;
  if (!a) return;

  // Overview stats (similar to dashboard but more detailed)
  document.getElementById('analyticsStats').innerHTML = `
    <div class="stat-card animate-in">
      <div class="stat-label">Win Rate</div>
      <div class="stat-value blue">${a.win_rate}%</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Profit Factor</div>
      <div class="stat-value ${a.profit_factor >= 1 ? 'profit' : 'loss'}">${a.profit_factor}</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Avg R:R</div>
      <div class="stat-value blue">${a.avg_rr_ratio}</div>
    </div>
    <div class="stat-card animate-in">
      <div class="stat-label">Max Drawdown</div>
      <div class="stat-value loss">${a.max_drawdown_pct}%</div>
    </div>
  `;

  renderCumulativePnlChart();
  renderSymbolChart();
  renderStrategyTable();
  renderStrategyBarChart();
  renderDrawdownChart();
  renderMAEChart();
}

function renderCumulativePnlChart() {
  const ctx = document.getElementById('cumulativePnlChart');
  if (STATE.charts.cumPnl) STATE.charts.cumPnl.destroy();

  const closedSorted = STATE.trades
    .filter(t => t.close_time)
    .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));

  let cum = 0;
  const data = closedSorted.map(t => {
    cum += getPnl(t);
    return cum;
  });

  STATE.charts.cumPnl = new Chart(ctx, {
    type: 'line',
    data: {
      labels: closedSorted.map((_, i) => `#${i + 1}`),
      datasets: [{
        label: 'Cumulative P/L',
        data,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16,185,129,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 2,
        borderWidth: 2,
      }],
    },
    options: chartOptions('$'),
  });
}

function renderSymbolChart() {
  const ctx = document.getElementById('symbolChart');
  if (STATE.charts.symbol) STATE.charts.symbol.destroy();

  const colors = STATE.symbolPerf.map(s => s.net_profit >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)');

  STATE.charts.symbol = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: STATE.symbolPerf.map(s => s.symbol),
      datasets: [{
        label: 'Net P/L',
        data: STATE.symbolPerf.map(s => s.net_profit),
        backgroundColor: colors,
        borderRadius: 6,
      }],
    },
    options: chartOptions('$'),
  });
}

function renderStrategyTable() {
  const tbody = document.getElementById('strategyBody');
  tbody.innerHTML = STATE.strategies.map(s => `
    <tr>
      <td>${s.tag_name}</td>
      <td>${s.total_trades}</td>
      <td class="${s.win_rate >= 50 ? 'text-profit' : 'text-loss'}">${s.win_rate}%</td>
      <td class="${s.profit_factor >= 1 ? 'text-profit' : 'text-loss'}">${s.profit_factor}</td>
      <td class="${s.net_profit >= 0 ? 'text-profit' : 'text-loss'}">$${s.net_profit.toFixed(2)}</td>
      <td>${s.avg_rr_ratio}</td>
    </tr>
  `).join('');
}

function renderStrategyBarChart() {
  const ctx = document.getElementById('strategyBarChart');
  if (STATE.charts.stratBar) STATE.charts.stratBar.destroy();

  STATE.charts.stratBar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: STATE.strategies.map(s => s.tag_name),
      datasets: [
        {
          label: 'Win Rate %',
          data: STATE.strategies.map(s => s.win_rate),
          backgroundColor: 'rgba(59,130,246,0.7)',
          borderRadius: 6,
        },
        {
          label: 'Profit Factor',
          data: STATE.strategies.map(s => s.profit_factor * 10), // scaled
          backgroundColor: 'rgba(139,92,246,0.7)',
          borderRadius: 6,
        },
      ],
    },
    options: chartOptions(''),
  });
}

function renderDrawdownChart() {
  const ctx = document.getElementById('drawdownChart');
  if (STATE.charts.drawdown) STATE.charts.drawdown.destroy();

  const closedSorted = STATE.trades
    .filter(t => t.close_time)
    .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));

  let balance = 10000;
  let peak = balance;
  const ddData = closedSorted.map(t => {
    balance += getPnl(t);
    peak = Math.max(peak, balance);
    return -((peak - balance) / peak * 100);
  });

  STATE.charts.drawdown = new Chart(ctx, {
    type: 'line',
    data: {
      labels: closedSorted.map((_, i) => `#${i + 1}`),
      datasets: [{
        label: 'Drawdown %',
        data: ddData,
        borderColor: '#ef4444',
        backgroundColor: 'rgba(239,68,68,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        borderWidth: 2,
      }],
    },
    options: {
      ...chartOptions('%'),
      scales: {
        ...chartOptions('%').scales,
        y: {
          ...chartOptions('%').scales.y,
          max: 0,
        },
      },
    },
  });
}

function renderMAEChart() {
  const ctx = document.getElementById('maeChart');
  if (STATE.charts.mae) STATE.charts.mae.destroy();

  const winners = STATE.mae.filter(m => m.is_winner);
  const losers = STATE.mae.filter(m => !m.is_winner);

  STATE.charts.mae = new Chart(ctx, {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Winners',
          data: winners.map(m => ({ x: m.mae_distance * 10000, y: m.pnl })),
          backgroundColor: 'rgba(16,185,129,0.6)',
          borderColor: '#10b981',
          pointRadius: 5,
        },
        {
          label: 'Losers',
          data: losers.map(m => ({ x: m.mae_distance * 10000, y: m.pnl })),
          backgroundColor: 'rgba(239,68,68,0.6)',
          borderColor: '#ef4444',
          pointRadius: 5,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { family: 'Inter' } } },
      },
      scales: {
        x: {
          title: { display: true, text: 'MAE (pips)', color: '#94a3b8' },
          grid: { color: 'rgba(30,45,61,0.5)' },
          ticks: { color: '#64748b' },
        },
        y: {
          title: { display: true, text: 'P/L ($)', color: '#94a3b8' },
          grid: { color: 'rgba(30,45,61,0.5)' },
          ticks: { color: '#64748b' },
        },
      },
    },
  });
}

// ============================================================
// JOURNAL DRAWER
// ============================================================
function openDrawer(tradeId) {
  const trade = STATE.trades.find(t => t.id === tradeId);
  if (!trade) return;

  STATE.currentDrawerTradeId = tradeId;
  STATE.currentRating = trade.rating || 0;
  STATE.selectedTags = (trade.tags || []).map(t => t.id);

  // Populate info
  document.getElementById('drawerSubtitle').textContent =
    `#${trade.ticket_id} · ${trade.symbol} · ${trade.trade_type} · ${trade.volume} lot`;

  document.getElementById('drawerTradeInfo').innerHTML = `
    <div class="detail-item">
      <div class="detail-item-label">Open Price</div>
      <div class="detail-item-value">${trade.open_price.toFixed(5)}</div>
    </div>
    <div class="detail-item">
      <div class="detail-item-label">Close Price</div>
      <div class="detail-item-value">${trade.close_price ? trade.close_price.toFixed(5) : 'Open'}</div>
    </div>
    <div class="detail-item">
      <div class="detail-item-label">P/L</div>
      <div class="detail-item-value ${getPnl(trade) >= 0 ? 'text-profit' : 'text-loss'}">
        $${getPnl(trade).toFixed(2)}
      </div>
    </div>
    <div class="detail-item">
      <div class="detail-item-label">SL / TP</div>
      <div class="detail-item-value">${trade.stop_loss?.toFixed(5) || '—'} / ${trade.take_profit?.toFixed(5) || '—'}</div>
    </div>
    <div class="detail-item">
      <div class="detail-item-label">Open Time</div>
      <div class="detail-item-value" style="font-size:0.8rem;">${formatDate(trade.open_time)}</div>
    </div>
    <div class="detail-item">
      <div class="detail-item-label">Duration</div>
      <div class="detail-item-value" style="font-size:0.8rem;">${calcDuration(trade.open_time, trade.close_time)}</div>
    </div>
  `;

  // Populate form
  document.getElementById('journalRationale').value = trade.entry_rationale || '';
  document.getElementById('journalEmotion').value = trade.emotion || '';
  document.getElementById('journalLesson').value = trade.lesson || '';
  document.getElementById('journalScreenBefore').value = trade.screenshot_before || '';
  document.getElementById('journalScreenAfter').value = trade.screenshot_after || '';

  // Stars
  setRating(STATE.currentRating);

  // Tags
  renderDrawerTags();

  // Show
  document.getElementById('drawerOverlay').classList.add('open');
  document.getElementById('journalDrawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawerOverlay').classList.remove('open');
  document.getElementById('journalDrawer').classList.remove('open');
  STATE.currentDrawerTradeId = null;
}

function setRating(val) {
  STATE.currentRating = val;
  document.querySelectorAll('#drawerStars .star').forEach(s => {
    s.classList.toggle('active', parseInt(s.dataset.val) <= val);
  });
}

function renderDrawerTags() {
  const container = document.getElementById('drawerTagChips');
  container.innerHTML = STATE.tags.map(tag => `
    <div class="tag-chip ${STATE.selectedTags.includes(tag.id) ? 'selected' : ''}"
         onclick="toggleTag(${tag.id})">${tag.name}</div>
  `).join('');
}

function toggleTag(tagId) {
  if (STATE.selectedTags.includes(tagId)) {
    STATE.selectedTags = STATE.selectedTags.filter(id => id !== tagId);
  } else {
    STATE.selectedTags.push(tagId);
  }
  renderDrawerTags();
}

async function saveJournal() {
  const tradeId = STATE.currentDrawerTradeId;
  if (!tradeId) return;

  const payload = {
    entry_rationale: document.getElementById('journalRationale').value,
    emotion: document.getElementById('journalEmotion').value,
    lesson: document.getElementById('journalLesson').value,
    rating: STATE.currentRating || null,
    screenshot_before: document.getElementById('journalScreenBefore').value,
    screenshot_after: document.getElementById('journalScreenAfter').value,
    tag_ids: STATE.selectedTags,
  };

  // Try API first
  if (!STATE.usingMock) {
    try {
      const resp = await fetch(`${API_BASE}/trades/${tradeId}/journal`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (resp.ok) {
        const updated = await resp.json();
        const idx = STATE.trades.findIndex(t => t.id === tradeId);
        if (idx >= 0) STATE.trades[idx] = updated;
      }
    } catch (e) { console.error(e); }
  } else {
    // Mock local update
    const trade = STATE.trades.find(t => t.id === tradeId);
    if (trade) {
      trade.entry_rationale = payload.entry_rationale;
      trade.emotion = payload.emotion;
      trade.lesson = payload.lesson;
      trade.rating = payload.rating;
      trade.screenshot_before = payload.screenshot_before;
      trade.screenshot_after = payload.screenshot_after;
      trade.tags = STATE.tags.filter(t => STATE.selectedTags.includes(t.id));
    }
  }

  closeDrawer();
  renderRecentTrades();
  renderTrades();
  showToast('✅ Journal saved!');
}

// ============================================================
// SETTINGS
// ============================================================
async function saveSettings() {
  const payload = {
    mt5_login: parseInt(document.getElementById('settingLogin').value),
    server: document.getElementById('settingServer').value,
    password: document.getElementById('settingPassword').value,
    name: document.getElementById('settingName').value,
  };

  try {
    const resp = await fetch(`${API_BASE}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const account = await resp.json();
      STATE.accountId = account.id;
      document.getElementById('accountName').textContent = account.name;
      document.getElementById('accountServer').textContent = account.server;
      showToast('✅ Account saved!');
    } else {
      showToast('⚠️ Could not save — check backend');
    }
  } catch (e) {
    showToast('⚠️ Backend not reachable');
  }
}

// ============================================================
// CHART HELPERS
// ============================================================
function chartOptions(unit) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        labels: { color: '#94a3b8', font: { family: 'Inter', size: 11 }, boxWidth: 12, padding: 16 },
      },
      tooltip: {
        backgroundColor: '#1a2332',
        borderColor: '#1e2d3d',
        borderWidth: 1,
        titleColor: '#f1f5f9',
        bodyColor: '#94a3b8',
        padding: 12,
        cornerRadius: 8,
        callbacks: unit === '$' ? {
          label: ctx => `${ctx.dataset.label}: $${ctx.parsed.y?.toFixed(2) || 0}`,
        } : {},
      },
    },
    scales: {
      x: {
        grid: { color: 'rgba(30,45,61,0.5)', drawBorder: false },
        ticks: { color: '#64748b', font: { family: 'Inter', size: 10 }, maxTicksLimit: 12 },
      },
      y: {
        grid: { color: 'rgba(30,45,61,0.5)', drawBorder: false },
        ticks: {
          color: '#64748b',
          font: { family: 'JetBrains Mono', size: 10 },
          callback: unit === '$' ? v => '$' + v.toLocaleString() : undefined,
        },
      },
    },
  };
}

// ============================================================
// UTILITIES
// ============================================================
function getPnl(trade) {
  return (trade.profit || 0) + (trade.commission || 0) + (trade.swap || 0);
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) +
    ' ' + date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

function calcDuration(open, close) {
  if (!open || !close) return 'Open';
  const ms = new Date(close) - new Date(open);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  document.getElementById('toastMessage').textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ============================================================
// MOCK DATA GENERATORS (client-side for instant demo)
// ============================================================
function generateMockTags() {
  return [
    { id: 1, name: 'Breakout' },
    { id: 2, name: 'SMC' },
    { id: 3, name: 'Trend Following' },
    { id: 4, name: 'Range Trading' },
    { id: 5, name: 'Scalping' },
    { id: 6, name: 'News Trading' },
  ];
}

function generateMockTrades(count) {
  const symbols = ['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'GBPJPY', 'AUDUSD', 'EURJPY'];
  const emotions = ['Confident', 'Neutral', 'Anxious', 'FOMO', 'Disciplined', 'Greedy', 'Patient'];
  const tags = STATE.tags;
  const trades = [];
  const now = Date.now();

  // Use a seeded random for consistent results
  let seed = 42;
  function rand() {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let i = 0; i < count; i++) {
    const symbol = symbols[Math.floor(rand() * symbols.length)];
    const trade_type = rand() < 0.5 ? 'BUY' : 'SELL';
    const volume = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5][Math.floor(rand() * 6)];
    const isJpy = symbol.includes('JPY');
    const isGold = symbol === 'XAUUSD';

    let open_price, pip;
    if (isGold) { open_price = 1950 + rand() * 200; pip = 0.01; }
    else if (isJpy) { open_price = 130 + rand() * 65; pip = 0.001; }
    else { open_price = 1.0 + rand() * 0.4; pip = 0.00001; }

    const isWin = rand() < 0.55;
    const pips = (isWin ? 1 : -1) * (5 + rand() * 75);
    const close_price = open_price + pips * pip * (trade_type === 'BUY' ? 1 : -1);
    const profit = +(pips * volume * 10).toFixed(2);
    const commission = +(-volume * 7).toFixed(2);
    const swap = +(rand() * 3 - 1.5).toFixed(2);

    const open_time = new Date(now - (90 - i * 1.5) * 86400000 + rand() * 86400000).toISOString();
    const durH = 0.1 + rand() * 48;
    const close_time = new Date(new Date(open_time).getTime() + durH * 3600000).toISOString();

    const sl_d = (10 + rand() * 40) * pip;
    const tp_d = (15 + rand() * 80) * pip;

    const tradeTags = rand() < 0.7 ? [tags[Math.floor(rand() * tags.length)]] : [];

    const hasJournal = rand() < 0.35;

    trades.push({
      id: i + 1,
      account_id: 1,
      ticket_id: 100000 + i,
      order_id: 200000 + i,
      symbol,
      trade_type,
      volume,
      open_price: +open_price.toFixed(5),
      close_price: +close_price.toFixed(5),
      open_time,
      close_time,
      stop_loss: +(trade_type === 'BUY' ? open_price - sl_d : open_price + sl_d).toFixed(5),
      take_profit: +(trade_type === 'BUY' ? open_price + tp_d : open_price - tp_d).toFixed(5),
      commission,
      swap,
      profit,
      floating_pl: 0,
      entry_rationale: hasJournal ? `Saw a ${tradeTags[0]?.name || 'clean'} setup on ${symbol} 1H.` : '',
      emotion: hasJournal ? emotions[Math.floor(rand() * emotions.length)] : '',
      lesson: hasJournal ? (profit > 0 ? 'Good execution, followed the plan.' : 'Should have waited for confirmation.') : '',
      rating: hasJournal ? Math.ceil(rand() * 5) : null,
      screenshot_before: '',
      screenshot_after: '',
      tags: tradeTags,
    });
  }

  trades.sort((a, b) => new Date(b.open_time) - new Date(a.open_time));
  return trades;
}

function generateMockEquity() {
  const sorted = [...STATE.trades]
    .filter(t => t.close_time)
    .sort((a, b) => new Date(a.close_time) - new Date(b.close_time));

  let balance = 10000;
  return sorted.map(t => {
    balance += getPnl(t);
    return {
      timestamp: t.close_time,
      balance: +balance.toFixed(2),
      equity: +(balance + (Math.random() * 60 - 30)).toFixed(2),
      margin: +(50 + Math.random() * 200).toFixed(2),
    };
  });
}

// ============================================================
// CLIENT-SIDE ANALYTICS (for mock mode)
// ============================================================
function computeAnalytics(trades) {
  const closed = trades.filter(t => t.close_time);
  if (!closed.length) return emptyAnalytics();

  const wins = closed.filter(t => getPnl(t) > 0);
  const losses = closed.filter(t => getPnl(t) <= 0);
  const totalProfit = wins.reduce((s, t) => s + getPnl(t), 0);
  const totalLoss = Math.abs(losses.reduce((s, t) => s + getPnl(t), 0));
  const avgWin = wins.length ? totalProfit / wins.length : 0;
  const avgLoss = losses.length ? totalLoss / losses.length : 0;

  // Max consecutive
  let mw = 0, ml = 0, cw = 0, cl = 0;
  closed.sort((a, b) => new Date(a.close_time) - new Date(b.close_time)).forEach(t => {
    if (getPnl(t) > 0) { cw++; cl = 0; mw = Math.max(mw, cw); }
    else { cl++; cw = 0; ml = Math.max(ml, cl); }
  });

  // Max drawdown
  let bal = 10000, peak = bal, maxDD = 0;
  closed.forEach(t => {
    bal += getPnl(t);
    peak = Math.max(peak, bal);
    maxDD = Math.max(maxDD, (peak - bal) / peak * 100);
  });

  const pnls = closed.map(t => getPnl(t));

  return {
    total_trades: closed.length,
    winning_trades: wins.length,
    losing_trades: losses.length,
    win_rate: +(wins.length / closed.length * 100).toFixed(1),
    profit_factor: totalLoss > 0 ? +(totalProfit / totalLoss).toFixed(2) : 999,
    total_profit: +totalProfit.toFixed(2),
    total_loss: +totalLoss.toFixed(2),
    net_profit: +(totalProfit - totalLoss).toFixed(2),
    avg_win: +avgWin.toFixed(2),
    avg_loss: +avgLoss.toFixed(2),
    avg_rr_ratio: avgLoss > 0 ? +(avgWin / avgLoss).toFixed(2) : 0,
    max_drawdown_pct: +maxDD.toFixed(2),
    max_consecutive_wins: mw,
    max_consecutive_losses: ml,
    best_trade: +Math.max(...pnls).toFixed(2),
    worst_trade: +Math.min(...pnls).toFixed(2),
  };
}

function computeStrategyPerformance(trades, tags) {
  return tags.map(tag => {
    const tagTrades = trades.filter(t => t.tags?.some(tg => tg.id === tag.id) && t.close_time);
    if (!tagTrades.length) return null;
    const a = computeAnalytics(tagTrades);
    return {
      tag_name: tag.name,
      total_trades: a.total_trades,
      win_rate: a.win_rate,
      profit_factor: a.profit_factor,
      net_profit: a.net_profit,
      avg_rr_ratio: a.avg_rr_ratio,
    };
  }).filter(Boolean);
}

function computeMonthlyPnl(trades) {
  const months = {};
  trades.filter(t => t.close_time).forEach(t => {
    const key = t.close_time.substring(0, 7);
    if (!months[key]) months[key] = { month: key, profit: 0, loss: 0 };
    const pnl = getPnl(t);
    if (pnl > 0) months[key].profit += pnl;
    else months[key].loss += pnl;
  });
  return Object.values(months).sort((a, b) => a.month.localeCompare(b.month)).map(m => ({
    ...m, profit: +m.profit.toFixed(2), loss: +m.loss.toFixed(2), net: +(m.profit + m.loss).toFixed(2),
  }));
}

function computeSymbolPerformance(trades) {
  const syms = {};
  trades.filter(t => t.close_time).forEach(t => {
    if (!syms[t.symbol]) syms[t.symbol] = [];
    syms[t.symbol].push(t);
  });
  return Object.entries(syms).map(([sym, ts]) => {
    const a = computeAnalytics(ts);
    return { symbol: sym, total_trades: a.total_trades, win_rate: a.win_rate, net_profit: a.net_profit, profit_factor: a.profit_factor };
  }).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function computeMAE(trades) {
  return trades.filter(t => t.close_time && t.stop_loss).map(t => {
    const mae = t.trade_type === 'BUY' ? t.open_price - t.stop_loss : t.stop_loss - t.open_price;
    const pnl = getPnl(t);
    return { ticket_id: t.ticket_id, symbol: t.symbol, pnl: +pnl.toFixed(2), mae_distance: +Math.abs(mae).toFixed(5), is_winner: pnl > 0 };
  });
}

function emptyAnalytics() {
  return { total_trades:0, winning_trades:0, losing_trades:0, win_rate:0, profit_factor:0,
    total_profit:0, total_loss:0, net_profit:0, avg_win:0, avg_loss:0, avg_rr_ratio:0,
    max_drawdown_pct:0, max_consecutive_wins:0, max_consecutive_losses:0, best_trade:0, worst_trade:0 };
}
