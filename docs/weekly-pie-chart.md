```ojs
const now = new Date();
const weekAgo = new Date(now);
weekAgo.setDate(weekAgo.getDate() - 7);

const grouped = {};
const eventColors = {};
for (const file of app.vault.getMarkdownFiles()) {
  const fm = app.metadataCache.getFileCache(file)?.frontmatter;
  if (!fm?.interval?.start || !fm?.interval?.end) continue;
  const start = new Date(fm.interval.start);
  const end = new Date(fm.interval.end);
  if (start < weekAgo || start > now) continue;
  const name = fm.name || file.basename;
  const hours = (end - start) / 3600000;
  grouped[name] = (grouped[name] || 0) + hours;
  if (fm.color) eventColors[name] = fm.color;
}

const sorted = Object.entries(grouped).sort((a, b) => (eventColors[a[0]] || '').localeCompare(eventColors[b[0]] || '') || b[1] - a[1]);
const labels = sorted.map(e => e[0]);
const data = sorted.map(e => e[1]);
const total = data.reduce((s, v) => s + v, 0);

if (labels.length === 0) {
  el.createEl('p', { text: 'No events found in the past week.' });
  return;
}

const colors = labels.map((name, i) => eventColors[name] || `hsl(${(i * 360 / labels.length) % 360}, 65%, 55%)`);

el.style.cssText = 'display: flex; flex-direction: column; align-items: center; text-align: center; margin: 1.5rem;';

const canvas = el.createEl('canvas', { attr: { width: 400, height: 400 } });
canvas.style.maxWidth = '400px';
const c = canvas.getContext('2d');
const cx = 200, cy = 180, r = 140;

const bg = getComputedStyle(el).getPropertyValue('--background-primary').trim() || '#1e1e1e';

let angle = -Math.PI / 2;
for (let i = 0; i < data.length; i++) {
  const slice = (data[i] / total) * Math.PI * 2;
  c.beginPath();
  c.moveTo(cx, cy);
  c.arc(cx, cy, r, angle, angle + slice);
  c.fillStyle = colors[i];
  c.fill();
  angle += slice;
}

c.lineWidth = 2;
c.strokeStyle = bg;
angle = -Math.PI / 2;
for (let i = 0; i < data.length; i++) {
  const slice = (data[i] / total) * Math.PI * 2;
  c.beginPath();
  c.moveTo(cx, cy);
  c.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  c.stroke();
  angle += slice;
}

const legend = el.createEl('div', { attr: { style: 'margin-top: 12px; display: inline-block; columns: 12em 2; font-size: 0.9em; text-align: left;' } });
for (let i = 0; i < labels.length; i++) {
  const row = legend.createEl('div', { attr: { style: 'display: flex; align-items: center; gap: 6px; margin-bottom: 4px; break-inside: avoid;' } });
  row.createEl('span', { attr: { style: `width:12px;height:12px;border-radius:2px;flex-shrink:0;background:${colors[i]};display:inline-block;` } });
  row.createEl('span', { attr: { style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;' }, text: labels[i] });
  row.createEl('span', { attr: { style: 'flex-shrink: 0; color: var(--text-muted);' }, text: ` ${data[i].toFixed(1)}h` });
}

el.createEl('div', { attr: { style: 'margin-top: 12px; font-size: 0.95em; color: var(--text-muted);' }, text: `Total: ${total.toFixed(1)} hours allotted this week` });
```
