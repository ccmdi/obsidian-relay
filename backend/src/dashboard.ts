export const dashboard = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relay</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; background: #0a0a0a; color: #e0e0e0; min-height: 100vh; padding: 2rem; }
  .container { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 1.1rem; font-weight: 500; color: #888; margin-bottom: 1.5rem; letter-spacing: 0.05em; text-transform: uppercase; }
  #auth { margin-top: 4rem; text-align: center; }
  #auth input { background: #161616; border: 1px solid #2a2a2a; color: #e0e0e0; padding: 0.6rem 1rem; border-radius: 6px; font-size: 0.9rem; width: 280px; }
  #auth button { background: #222; border: 1px solid #333; color: #ccc; padding: 0.6rem 1.2rem; border-radius: 6px; cursor: pointer; margin-left: 0.5rem; font-size: 0.9rem; }
  #auth button:hover { background: #2a2a2a; }
  .day { margin-bottom: 1.5rem; }
  .day-header { font-size: 0.8rem; font-weight: 600; color: #666; text-transform: uppercase; letter-spacing: 0.06em; padding-bottom: 0.4rem; border-bottom: 1px solid #1a1a1a; margin-bottom: 0.5rem; }
  .day-header.today { color: #5b9cf5; border-color: #1a3a5c; }
  .event { padding: 0.6rem 0; display: flex; gap: 1rem; align-items: baseline; }
  .event + .event { border-top: 1px solid #111; }
  .time { font-size: 0.8rem; color: #666; min-width: 100px; font-variant-numeric: tabular-nums; }
  .details { flex: 1; }
  .name { font-size: 0.95rem; color: #e0e0e0; }
  .location { font-size: 0.8rem; color: #555; margin-top: 0.15rem; }
  .empty { color: #444; font-style: italic; margin-top: 3rem; text-align: center; }
  .status-bar { font-size: 0.75rem; color: #444; margin-top: 2rem; text-align: center; }
</style>
</head>
<body>
<div class="container">
  <h1>Relay</h1>
  <div id="auth">
    <input type="password" id="token" placeholder="API token" />
    <button onclick="connect()">Go</button>
  </div>
  <div id="agenda" style="display:none"></div>
  <div id="status" class="status-bar" style="display:none"></div>
</div>
<script>
let apiToken = localStorage.getItem("relay_token") || "";
if (apiToken) load();

function connect() {
  apiToken = document.getElementById("token").value;
  if (!apiToken) return;
  localStorage.setItem("relay_token", apiToken);
  load();
}

async function load() {
  document.getElementById("auth").style.display = "none";
  document.getElementById("agenda").style.display = "block";
  document.getElementById("status").style.display = "block";
  try {
    const res = await fetch("/events", { headers: { "Authorization": "Bearer " + apiToken } });
    if (!res.ok) { localStorage.removeItem("relay_token"); location.reload(); return; }
    const data = await res.json();
    render(data.events);
    document.getElementById("status").textContent = "Updated " + new Date().toLocaleTimeString();
  } catch (e) {
    document.getElementById("agenda").innerHTML = '<div class="empty">Failed to connect</div>';
  }
  setTimeout(load, 10000);
}

function render(events) {
  const agenda = document.getElementById("agenda");
  if (!events.length) { agenda.innerHTML = '<div class="empty">No events</div>'; return; }

  const byDay = {};
  const now = new Date();
  const todayStr = now.toDateString();

  for (const e of events) {
    const p = e.payload;
    const start = p.interval?.start ? new Date(p.interval.start) : null;
    if (!start || isNaN(start.getTime())) continue;
    const dayKey = start.toDateString();
    if (!byDay[dayKey]) byDay[dayKey] = [];
    byDay[dayKey].push({ start, end: p.interval?.end ? new Date(p.interval.end) : null, name: p.name || "Untitled", location: p.location, allDay: p.all_day });
  }

  const sortedDays = Object.keys(byDay).sort((a, b) => new Date(a) - new Date(b));
  let html = "";

  for (const day of sortedDays) {
    const isToday = day === todayStr;
    const label = isToday ? "Today" : new Date(day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
    html += '<div class="day">';
    html += '<div class="day-header' + (isToday ? " today" : "") + '">' + label + '</div>';

    byDay[day].sort((a, b) => a.start - b.start);
    for (const ev of byDay[day]) {
      const time = ev.allDay ? "All day" : formatTime(ev.start) + (ev.end ? " \\u2013 " + formatTime(ev.end) : "");
      html += '<div class="event"><div class="time">' + time + '</div><div class="details"><div class="name">' + esc(ev.name) + '</div>';
      if (ev.location) html += '<div class="location">' + esc(ev.location) + '</div>';
      html += '</div></div>';
    }
    html += '</div>';
  }

  agenda.innerHTML = html;
}

function formatTime(d) {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function esc(s) {
  const d = document.createElement("div"); d.textContent = s; return d.innerHTML;
}
</script>
</body>
</html>`;
