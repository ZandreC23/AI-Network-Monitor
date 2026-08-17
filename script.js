/*
  NetPulse — Network Health Monitor
  --------------------------------------------------------------
  The DATA feed here is simulated: a browser cannot ping real hardware
  (no ICMP / raw sockets). In production, a small monitoring agent on the
  network would perform the real checks and POST results to this dashboard.

  Everything ELSE is real, defensible logic:
    - status thresholds (online / degraded / offline)
    - rule-based alerting with plain-language suggestions
    - simple trend-based prediction (linear slope over recent samples)
  --------------------------------------------------------------
*/

// ---- Configuration (the "rules") ----
const CONFIG = {
  warnMs: 120,          // latency above this = degraded
  critMs: 300,          // latency above this = trouble
  offlineStrikes: 3,    // consecutive failed checks before "offline"
  history: 12,          // samples kept per device (for sparkline + trend)
  tickMs: 2000,         // check interval
  predictSlope: 8       // ms/sample rising trend that triggers a prediction
};

// ---- Devices (a typical small business) ----
const devices = [
  { id: "rtr", name: "Main Router",     type: "Gateway · 192.168.0.1",   icon: "🌐", base: 18 },
  { id: "srv", name: "File Server",     type: "NAS · 192.168.0.10",      icon: "🗄️", base: 35 },
  { id: "wifi", name: "Office Wi-Fi AP", type: "Access Point · 192.168.0.5", icon: "📶", base: 22 },
  { id: "pos", name: "POS Terminal",    type: "Till · 192.168.0.22",     icon: "💳", base: 40 },
  { id: "cctv", name: "CCTV Recorder",  type: "DVR · 192.168.0.30",      icon: "🎥", base: 55 },
  { id: "prn", name: "Printer",         type: "MFP · 192.168.0.40",      icon: "🖨️", base: 30 }
];

// per-device runtime state
const state = {};
devices.forEach(d => {
  state[d.id] = { samples: [], strikes: 0, status: "online", lastAlertKey: "", forcedIncident: 0 };
});

let paused = false;
let timer = null;

// ---- Simulated "ping": returns latency in ms, or null for a dropped packet ----
function simulatePing(device) {
  const s = state[device.id];
  // A forced incident (from the button) degrades a device for a few ticks
  if (s.forcedIncident > 0) {
    s.forcedIncident--;
    if (Math.random() < 0.4) return null;              // packet loss
    return device.base + 250 + Math.random() * 200;    // very high latency
  }
  // Normal behaviour: base latency + jitter, rare random blips
  const blip = Math.random() < 0.05 ? 150 + Math.random() * 200 : 0;
  const drop = Math.random() < 0.02;
  if (drop) return null;
  return Math.max(1, device.base + (Math.random() * 30 - 10) + blip);
}

// ---- Status decision (a real rule engine) ----
function evaluate(device, latency) {
  const s = state[device.id];
  if (latency === null) {
    s.strikes++;
    if (s.strikes >= CONFIG.offlineStrikes) return "offline";
    return s.status === "offline" ? "offline" : "degraded";
  }
  s.strikes = 0;
  if (latency >= CONFIG.critMs) return "offline";
  if (latency >= CONFIG.warnMs) return "degraded";
  return "online";
}

// ---- Simple trend prediction: linear slope over recent valid samples ----
function predictTrend(device) {
  const pts = state[device.id].samples.filter(v => v !== null);
  if (pts.length < 5) return null;
  const recent = pts.slice(-5);
  // average step between consecutive samples
  let slope = 0;
  for (let i = 1; i < recent.length; i++) slope += recent[i] - recent[i - 1];
  slope /= (recent.length - 1);
  const current = recent[recent.length - 1];
  if (slope >= CONFIG.predictSlope && current < CONFIG.critMs) {
    const ticksToCrit = Math.ceil((CONFIG.critMs - current) / slope);
    if (ticksToCrit <= 6) return { slope, ticksToCrit };
  }
  return null;
}

// ---- Plain-language suggestions per situation ----
function suggestionFor(device, status) {
  const map = {
    rtr:  "Restart the router, then check your internet line.",
    srv:  "Check the server's network cable and free up disk space.",
    wifi: "Reboot the access point; check for interference or too many devices.",
    pos:  "Check the till's Wi-Fi connection — move it closer to the AP.",
    cctv: "Verify the recorder's power and network cable.",
    prn:  "Power-cycle the printer and confirm it's on the network."
  };
  if (status === "offline") return `<b>Try this:</b> ${map[device.id]}`;
  if (status === "degraded") return `<b>Keep an eye on it:</b> response times are climbing.`;
  return "";
}

// ---- Alerts ----
const alerts = [];
function raiseAlert(level, title, suggestHtml, key) {
  const s = level === "predict" ? "predict" : level;
  // de-dupe: don't repeat the same alert for the same device state
  if (alerts.length && alerts[0].key === key) return;
  alerts.unshift({ level: s, title, suggestHtml, key, time: new Date() });
  if (alerts.length > 8) alerts.pop();
}

// ---- One monitoring cycle ----
function tick() {
  let online = 0, degraded = 0, offline = 0;

  devices.forEach(device => {
    const s = state[device.id];
    const latency = simulatePing(device);
    s.samples.push(latency);
    if (s.samples.length > CONFIG.history) s.samples.shift();

    const prev = s.status;
    const status = evaluate(device, latency);
    s.status = status;
    s.lastLatency = latency;

    if (status === "online") online++;
    else if (status === "degraded") degraded++;
    else offline++;

    // Alerting: fire when a device gets worse
    const rank = { online: 0, degraded: 1, offline: 2 };
    if (rank[status] > rank[prev]) {
      if (status === "offline") {
        raiseAlert("crit", `${device.name} is offline`, suggestionFor(device, "offline"), `${device.id}-offline`);
      } else if (status === "degraded") {
        raiseAlert("warn", `${device.name} is slow (${Math.round(latency)} ms)`, suggestionFor(device, "degraded"), `${device.id}-degraded`);
      }
    }

    // Prediction: warn before it crosses the line
    const p = predictTrend(device);
    if (p && status !== "offline") {
      raiseAlert("predict",
        `${device.name} may go offline soon`,
        `<b>Heads up:</b> latency is rising steadily — on this trend it could cross the limit in ~${p.ticksToCrit} checks.`,
        `${device.id}-predict-${Math.round(p.ticksToCrit)}`);
    }
  });

  render(online, degraded, offline);
}

// ---- Rendering ----
function sparkline(samples) {
  const vals = samples.map(v => v === null ? CONFIG.critMs : v);
  if (!vals.length) return "";
  const max = Math.max(CONFIG.warnMs, ...vals);
  const w = 72, h = 22, step = w / Math.max(1, vals.length - 1);
  const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polyline points="${pts}" fill="none" stroke="var(--violet-bright)" stroke-width="1.6" stroke-linejoin="round"/>
  </svg>`;
}

function render(online, degraded, offline) {
  const total = devices.length;
  const pct = Math.round((online / total) * 100);

  // health ring
  const ring = document.getElementById("healthRing");
  ring.style.setProperty("--pct", pct);
  const ringColor = pct >= 80 ? "var(--ok)" : pct >= 50 ? "var(--warn)" : "var(--crit)";
  ring.style.background = `conic-gradient(${ringColor} calc(var(--pct)*1%), var(--surface-2) 0)`;
  document.getElementById("healthPct").textContent = pct + "%";

  document.getElementById("statOnline").textContent = online;
  document.getElementById("statDegraded").textContent = degraded;
  document.getElementById("statOffline").textContent = offline;
  document.getElementById("statChecked").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  // devices
  const list = document.getElementById("deviceList");
  list.innerHTML = devices.map(d => {
    const s = state[d.id];
    const status = s.status;
    const cls = status === "online" ? "s-online" : status === "degraded" ? "s-degraded" : "s-offline";
    const label = status.charAt(0).toUpperCase() + status.slice(1);
    const latencyTxt = s.lastLatency === null ? "— no reply" : `${Math.round(s.lastLatency)} ms`;
    return `<div class="device ${status === 'degraded' ? 'is-degraded' : status === 'offline' ? 'is-offline' : ''}">
      <div class="device-icon">${d.icon}</div>
      <div>
        <div class="device-name">${d.name}</div>
        <div class="device-meta">${d.type}</div>
        <span class="status-pill ${cls}">${label}</span>
      </div>
      <div class="device-right">
        <div class="device-latency">${latencyTxt}</div>
        ${sparkline(s.samples)}
      </div>
    </div>`;
  }).join("");

  // alerts
  const alertList = document.getElementById("alertList");
  if (!alerts.length) {
    alertList.innerHTML = `<li class="alert-empty">All quiet. No alerts right now.</li>`;
  } else {
    alertList.innerHTML = alerts.map(a => `
      <li class="alert lvl-${a.level}">
        <div class="alert-head">
          <span class="alert-title">${a.title}</span>
          <span class="alert-time">${a.time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
        ${a.suggestHtml ? `<div class="alert-suggest">${a.suggestHtml}</div>` : ""}
      </li>`).join("");
  }
}

// ---- Controls ----
document.getElementById("pauseBtn").addEventListener("click", (e) => {
  paused = !paused;
  e.target.textContent = paused ? "Resume" : "Pause";
  e.target.setAttribute("aria-pressed", String(paused));
  if (paused) clearInterval(timer);
  else timer = setInterval(tick, CONFIG.tickMs);
});

document.getElementById("incidentBtn").addEventListener("click", () => {
  // pick a random currently-online device and make it misbehave
  const candidates = devices.filter(d => state[d.id].status !== "offline");
  const target = candidates[Math.floor(Math.random() * candidates.length)] || devices[0];
  state[target.id].forcedIncident = 5;
});

document.getElementById("dismissBanner").addEventListener("click", () => {
  document.getElementById("demoBanner").classList.add("hidden");
});

// ---- Start ----
tick();
timer = setInterval(tick, CONFIG.tickMs);
