```ojs
await api.loadScript('https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js');

const resolve = (col) => {
  if (col.startsWith('var(')) return getComputedStyle(el).getPropertyValue(col.slice(4, -1)).trim() || '#555';
  return col;
};

const textColor = resolve('var(--text-muted)');
const borderColor = resolve('var(--background-primary)');

const getRange = (mode) => {
  const now = new Date();
  const start = new Date(now);
  if (mode === 'today') { start.setHours(0, 0, 0, 0); }
  else if (mode === 'week') { start.setDate(start.getDate() - 7); }
  else { start.setDate(start.getDate() - 30); }
  return { start, end: now };
};

const getEvents = (mode) => {
  const { start: rangeStart, end: rangeEnd } = getRange(mode);
  const grouped = {};
  const eventColors = {};
  for (const file of app.vault.getMarkdownFiles()) {
    const fm = app.metadataCache.getFileCache(file)?.frontmatter;
    if (!fm?.interval?.start || !fm?.interval?.end) continue;
    const start = new Date(fm.interval.start);
    const end = new Date(fm.interval.end);
    if (start < rangeStart || start > rangeEnd) continue;
    const name = fm.name || file.basename;
    const hours = (end - start) / 3600000;
    grouped[name] = (grouped[name] || 0) + hours;
    if (fm.color) eventColors[name] = fm.color;
  }
  const sorted = Object.entries(grouped).sort((a, b) => (eventColors[a[0]] || '').localeCompare(eventColors[b[0]] || '') || b[1] - a[1]);
  const labels = sorted.map(e => e[0]);
  const data = sorted.map(e => e[1]);
  const colors = labels.map((name, i) => eventColors[name] || `hsl(${(i * 360 / labels.length) % 360}, 65%, 55%)`);
  return { labels, data, colors };
};

const maxHours = { today: 24, week: 168, month: 720 };

el.style.cssText = 'display: flex; flex-direction: column; align-items: center; text-align: center; margin: 1.5rem;';

const toolbar = el.createEl('div', { attr: { style: 'display: flex; align-items: center; gap: 8px; width: 100%; margin-bottom: 12px;' } });
const tabs = toolbar.createEl('div', { attr: { style: 'display: flex; flex: 1; min-width: 0; gap: 4px;' } });
const modes = ['today', 'week', 'month'];
let activeMode = 'week';
let showUnalloc = false;
let chart = null;

const draw = () => {
  const { labels, data, colors } = getEvents(activeMode);
  const total = data.reduce((s, v) => s + v, 0);

  const chartLabels = [...labels];
  const chartData = [...data];
  const chartColors = colors.map(resolve);

  if (showUnalloc) {
    const unalloc = Math.max(0, maxHours[activeMode] - total);
    chartLabels.push('Unallocated');
    chartData.push(unalloc);
    chartColors.push(resolve('var(--background-modifier-border)'));
  }

  if (chartLabels.length === 0) {
    if (chart) { chart.destroy(); chart = null; }
    el.querySelector('.pie-wrap')?.remove();
    el.querySelector('.pie-total')?.remove();
    if (!el.querySelector('.pie-empty')) el.createEl('p', { cls: 'pie-empty', text: 'No events found.' });
    return;
  }
  el.querySelector('.pie-empty')?.remove();

  if (chart) { chart.destroy(); chart = null; }

  let wrapper = el.querySelector('.pie-wrap');
  if (!wrapper) {
    wrapper = el.createEl('div', { cls: 'pie-wrap', attr: { style: 'position: relative; max-width: 400px; width: 100%;' } });
    wrapper.createEl('canvas');
  }
  const canvas = wrapper.querySelector('canvas');
  chart = new Chart(canvas, {
    type: 'pie',
    data: {
      labels: chartLabels,
      datasets: [{ data: chartData, backgroundColor: chartColors, borderColor: borderColor, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      animation: { duration: 0 },
      transitions: { active: { animation: { duration: 200 } } },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed.toFixed(0)}h` } },
      },
    },
  });

  let footer = el.querySelector('.pie-footer');
  if (!footer) {
    footer = el.createEl('label', { cls: 'pie-footer', attr: { style: 'display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 0.75em; color: var(--text-faint); letter-spacing: 0.03em; cursor: pointer;' } });
    const cb = footer.createEl('input', { attr: { type: 'checkbox', style: 'cursor: pointer; margin: 0;' } });
    cb.addEventListener('change', () => { showUnalloc = cb.checked; draw(); });
    footer.createEl('span', { cls: 'pie-total-text' });
  }
  footer.querySelector('.pie-total-text').textContent = `${total.toFixed(0)}h allotted`;
};

const updateTabs = () => {
  tabBtns.forEach((b, i) => {
    const active = modes[i] === activeMode;
    b.style.background = active ? 'var(--interactive-accent)' : 'transparent';
    b.style.color = active ? 'var(--text-on-accent)' : 'var(--text-muted)';
  });
};
const tabBtns = modes.map(mode => {
  const label = mode === 'today' ? 'Today' : mode === 'week' ? 'Week' : 'Month';
  const btn = tabs.createEl('button', { text: label, attr: { style: 'flex: 1; padding: 5px 0; border: none; border-bottom: 2px solid transparent; background: transparent; color: var(--text-muted); cursor: pointer; font-size: 0.85em; font-weight: 500;' } });
  btn.addEventListener('click', () => { activeMode = mode; updateTabs(); draw(); });
  return btn;
});
updateTabs();


draw();
```
