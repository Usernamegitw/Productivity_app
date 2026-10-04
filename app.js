(function () {
  'use strict';

  const L = window.XPLogic;
  const STORAGE_KEY = 'orgxp.v1';
  const HISTORY_PAGE = 15;

  // ---------- State & persistence ----------

  function emptyData() {
    return { version: 1, tasks: [], logs: [], settings: {} };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyData();
      return normalize(JSON.parse(raw));
    } catch (e) {
      console.error('Could not load saved data', e);
      return emptyData();
    }
  }

  function normalize(d) {
    if (!d || !Array.isArray(d.tasks) || !Array.isArray(d.logs)) throw new Error('Not an Organization XP backup');
    return {
      version: 1,
      tasks: d.tasks.filter((t) => t && t.id && typeof t.name === 'string'),
      logs: d.logs.filter((l) => l && l.id && l.taskId && Number.isFinite(+l.minutes) && Number.isFinite(+l.at)),
      settings: d.settings && typeof d.settings === 'object' ? d.settings : {},
    };
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      toast('Could not save — storage unavailable');
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  let data = load();
  let derived = null;
  let selectedTaskId = null;
  let rating = null;
  let historyShown = HISTORY_PAGE;

  function settings() {
    return Object.assign({}, L.DEFAULT_SETTINGS, data.settings);
  }

  function recompute() {
    derived = L.computeState(data.tasks, data.logs, settings());
  }

  // ---------- DOM helpers ----------

  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'style') node.style.cssText = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  const fmtXp = (n) => (n >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());
  const fmtMult = (m) => '×' + (m >= 10 ? m.toFixed(0) : m.toFixed(2).replace(/0$/, ''));

  // Green (easy) → amber → red (bottleneck), on the 1–10 scale.
  function heat(score) {
    const t = (score - 1) / 9;
    const hue = 150 - 150 * t;
    return `hsl(${hue.toFixed(0)} 70% 58%)`;
  }

  function relTime(ms) {
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 7) return `${d}d ago`;
    return new Date(ms).toLocaleDateString();
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function sparkline(values) {
    if (values.length < 2) return null;
    const w = 60, h = 16, pts = values.slice(-12);
    const step = w / (pts.length - 1);
    const y = (v) => h - ((v - 1) / 9) * h;
    const d = pts.map((v, i) => `${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('class', 'spark');
    svg.setAttribute('aria-hidden', 'true');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', d);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', heat(pts[pts.length - 1]));
    line.setAttribute('stroke-width', '1.5');
    svg.append(line);
    return svg;
  }

  // ---------- Rendering ----------

  function renderStat() {
    const info = L.levelInfo(derived.totalXp, settings());
    $('level').textContent = info.level;
    $('xp-into').textContent = fmtXp(info.xpIntoLevel);
    $('xp-next').textContent = fmtXp(info.xpForNext);
    $('xp-total').textContent = fmtXp(derived.totalXp);
    const pct = Math.max(0, Math.min(100, info.progress * 100));
    $('xpbar-fill').style.width = pct + '%';
    $('xpbar').setAttribute('aria-valuenow', pct.toFixed(0));
    return info.level;
  }

  function sortedTasks() {
    return data.tasks.slice().sort((a, b) => {
      const sa = derived.taskStats[a.id], sb = derived.taskStats[b.id];
      return sb.score - sa.score || a.name.localeCompare(b.name);
    });
  }

  function renderTaskSelect() {
    const sel = $('log-task');
    sel.replaceChildren();
    const tasks = sortedTasks();
    for (const t of tasks) {
      const st = derived.taskStats[t.id];
      sel.append(el('option', { value: t.id }, `${t.name}  (${fmtMult(st.multiplier)})`));
    }
    if (!tasks.some((t) => t.id === selectedTaskId)) selectedTaskId = tasks.length ? tasks[0].id : null;
    if (selectedTaskId) sel.value = selectedTaskId;
    sel.disabled = !tasks.length;
    $('no-tasks').hidden = tasks.length > 0;
  }

  function renderRating() {
    const wrap = $('rating');
    wrap.replaceChildren();
    for (let r = L.RATING_MIN; r <= L.RATING_MAX; r++) {
      const pressed = rating === r;
      wrap.append(el('button', {
        type: 'button',
        'aria-pressed': String(pressed),
        'aria-label': `Resistance ${r}`,
        style: pressed ? `background:${heat(r)}` : `color:${heat(r)}`,
        onclick: () => { rating = r; renderRating(); renderPreview(); },
      }, r));
    }
  }

  function renderPreview() {
    const p = $('preview');
    const minutes = Number($('log-minutes').value);
    const ok = selectedTaskId && rating && minutes > 0;
    $('log-submit').disabled = !ok;
    if (!selectedTaskId) { p.textContent = ''; return; }
    const st = derived.taskStats[selectedTaskId];
    if (!ok) {
      p.replaceChildren('Current boost for this task: ', el('strong', {}, fmtMult(st.multiplier)),
        ` · bottleneck score ${st.score.toFixed(1)}`);
      return;
    }
    const s = settings();
    const score = L.nextScore(st.score, rating, s);
    const mult = L.multiplierFor(score, s);
    const xp = L.xpForLog(minutes, mult, s);
    p.replaceChildren('This log: ', el('strong', {}, `+${fmtXp(xp)} XP`),
      ` (${fmtMult(mult)}) · score ${st.score.toFixed(1)} → ${score.toFixed(1)}`);
  }

  function renderTasks() {
    const list = $('task-list');
    list.replaceChildren();
    const tasks = sortedTasks();
    if (!tasks.length) {
      list.append(el('li', { class: 'empty' }, 'No tasks yet. Add the real things you want to get done — "empty the dishwasher", "clear inbox", "declutter desk".'));
      return;
    }
    for (const t of tasks) {
      const st = derived.taskStats[t.id];
      const color = heat(st.score);
      const trend = st.history.length >= 2 ? st.history[st.history.length - 1] - st.history[st.history.length - 2] : 0;
      const arrow = trend > 0.05 ? '↑' : trend < -0.05 ? '↓' : '';
      list.append(el('li', { class: 'task' + (t.id === selectedTaskId ? ' selected' : '') },
        el('div', { class: 'task-top' },
          el('button', {
            class: 'task-name', type: 'button', title: 'Log this task',
            onclick: () => { selectTask(t.id); $('log-form').scrollIntoView({ behavior: 'smooth', block: 'start' }); },
          }, t.name),
          el('span', { class: 'mult', style: `color:${color};background:${color.replace('58%)', '58% / .14)')}` }, fmtMult(st.multiplier)),
        ),
        el('div', { class: 'task-meter', title: `Bottleneck score ${st.score.toFixed(1)} / 10` },
          el('div', { style: `width:${(st.score / 10) * 100}%;background:${color}` })),
        el('div', { class: 'task-meta' },
          el('span', {}, `Bottleneck ${st.score.toFixed(1)}${arrow ? ' ' + arrow : ''}`),
          sparkline(st.history),
          el('span', {}, `${st.logCount} log${st.logCount === 1 ? '' : 's'}`),
          el('span', {}, `${st.totalMinutes} min`),
          el('span', {}, `${fmtXp(st.totalXp)} XP`),
          st.lastLoggedAt ? el('span', {}, relTime(st.lastLoggedAt)) : null,
        ),
        el('div', { class: 'task-actions' },
          el('button', { type: 'button', onclick: () => renameTask(t) }, 'Rename'),
          el('button', { type: 'button', onclick: () => deleteTask(t) }, 'Delete'),
        ),
      ));
    }
  }

  function renderHistory() {
    const list = $('history');
    list.replaceChildren();
    const names = Object.fromEntries(data.tasks.map((t) => [t.id, t.name]));
    const logs = data.logs.filter((l) => names[l.taskId] != null).sort((a, b) => b.at - a.at);
    if (!logs.length) {
      list.append(el('li', { class: 'empty', style: 'display:block' }, 'Nothing logged yet.'));
    }
    for (const log of logs.slice(0, historyShown)) {
      const r = derived.logResults[log.id];
      list.append(el('li', {},
        el('div', {},
          el('div', { class: 'h-name' }, names[log.taskId]),
          el('div', { class: 'h-meta' }, `${log.minutes} min · resistance ${log.resistance} · ${fmtMult(r.multiplier)} · ${relTime(log.at)}`),
        ),
        el('span', { class: 'h-xp' }, `+${fmtXp(r.xp)}`),
        el('button', { type: 'button', 'aria-label': 'Delete log', title: 'Delete log', onclick: () => deleteLog(log) }, '✕'),
      ));
    }
    $('history-more').hidden = logs.length <= historyShown;
  }

  function renderSettings() {
    const s = settings();
    const f = $('settings-form');
    for (const k of ['xpPerMinute', 'maxMultiplier', 'smoothing', 'levelStep']) f.elements[k].value = s[k];
  }

  function render() {
    recompute();
    renderStat();
    renderTaskSelect();
    renderRating();
    renderPreview();
    renderTasks();
    renderHistory();
  }

  // ---------- Actions ----------

  function selectTask(id) {
    selectedTaskId = id;
    $('log-task').value = id;
    renderPreview();
    renderTasks();
  }

  function addTask(name) {
    name = name.trim();
    if (!name) return;
    if (data.tasks.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      toast('That task already exists');
      return;
    }
    const t = { id: uid(), name, createdAt: Date.now() };
    data.tasks.push(t);
    save();
    selectedTaskId = t.id;
    render();
  }

  function renameTask(t) {
    const name = prompt('Rename task', t.name);
    if (name == null || !name.trim()) return;
    t.name = name.trim().slice(0, 80);
    save();
    render();
  }

  function deleteTask(t) {
    const n = data.logs.filter((l) => l.taskId === t.id).length;
    const msg = n ? `Delete "${t.name}" and its ${n} log${n === 1 ? '' : 's'}? This removes their XP.` : `Delete "${t.name}"?`;
    if (!confirm(msg)) return;
    data.tasks = data.tasks.filter((x) => x.id !== t.id);
    data.logs = data.logs.filter((l) => l.taskId !== t.id);
    save();
    render();
  }

  function deleteLog(log) {
    if (!confirm('Delete this log? Its XP will be removed and scores recalculated.')) return;
    data.logs = data.logs.filter((l) => l.id !== log.id);
    save();
    render();
  }

  function logTask(e) {
    e.preventDefault();
    const minutes = Math.round(Number($('log-minutes').value));
    if (!selectedTaskId || !rating || !(minutes > 0)) return;
    const before = L.levelInfo(derived.totalXp, settings()).level;
    const log = { id: uid(), taskId: selectedTaskId, minutes, resistance: rating, at: Date.now() };
    data.logs.push(log);
    save();
    rating = null;
    historyShown = HISTORY_PAGE;
    render();
    const xp = derived.logResults[log.id].xp;
    const after = L.levelInfo(derived.totalXp, settings()).level;
    if (after > before) {
      toast(`+${fmtXp(xp)} XP · Level up! Organization Lv ${after}`);
      const card = document.querySelector('.stat');
      card.classList.remove('level-up');
      void card.offsetWidth;
      card.classList.add('level-up');
    } else {
      toast(`+${fmtXp(xp)} XP`);
    }
  }

  function saveSettings(e) {
    e.preventDefault();
    const f = e.target.elements;
    const num = (k, lo, hi) => {
      const v = Number(f[k].value);
      return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : L.DEFAULT_SETTINGS[k];
    };
    data.settings = {
      xpPerMinute: num('xpPerMinute', 0.1, 1000),
      maxMultiplier: num('maxMultiplier', 1, 20),
      smoothing: num('smoothing', 0.05, 1),
      levelStep: num('levelStep', 10, 100000),
    };
    save();
    renderSettings();
    render();
    toast('Settings saved');
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `organization-xp-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function importData(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then((text) => {
      const next = normalize(JSON.parse(text));
      if (!confirm(`Replace current data with this backup (${next.tasks.length} tasks, ${next.logs.length} logs)?`)) return;
      data = next;
      save();
      renderSettings();
      render();
      toast('Backup imported');
    }).catch((err) => toast('Import failed: ' + err.message));
  }

  // ---------- Wiring ----------

  $('log-form').addEventListener('submit', logTask);
  $('log-task').addEventListener('change', (e) => selectTask(e.target.value));
  $('log-minutes').addEventListener('input', renderPreview);
  $('minute-chips').addEventListener('click', (e) => {
    const m = e.target.closest('button')?.dataset.min;
    if (!m) return;
    $('log-minutes').value = m;
    renderPreview();
  });
  $('add-task-form').addEventListener('submit', (e) => {
    e.preventDefault();
    addTask($('new-task').value);
    $('new-task').value = '';
  });
  $('history-more').addEventListener('click', () => { historyShown += HISTORY_PAGE; renderHistory(); });
  $('settings-form').addEventListener('submit', saveSettings);
  $('settings-reset').addEventListener('click', () => {
    data.settings = {};
    save();
    renderSettings();
    render();
    toast('Defaults restored');
  });
  $('export').addEventListener('click', exportData);
  $('import').addEventListener('change', importData);
  $('wipe').addEventListener('click', () => {
    if (!confirm('Erase all tasks, logs and settings? Export a backup first if you might want them.')) return;
    if (!confirm('Really erase everything?')) return;
    data = emptyData();
    save();
    renderSettings();
    render();
  });
  // Pick up changes made in another tab.
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    data = load();
    renderSettings();
    render();
  });

  renderSettings();
  render();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
