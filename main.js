import * as THREE from "./vendor/three.module.js";
import { OrbitControls } from "./vendor/controls/OrbitControls.js";

// ---------------------------------------------------------------- fatal reporting
function showFatal(err) {
  const el = document.getElementById("loading");
  const msg = (err && (err.message || String(err))) || "unknown error";
  if (el) {
    el.classList.remove("hidden");
    el.innerHTML =
      '<div style="max-width:560px;text-align:center;padding:0 22px">' +
      '<h2 style="margin:0 0 12px;color:#ff5d7a;letter-spacing:3px">SIGNAL OFFLINE</h2>' +
      '<p style="color:#e8eefc;white-space:pre-wrap;font-family:monospace;font-size:13px;line-height:1.5">' + msg + "</p>" +
      '<p style="color:#8fa0c0;font-size:13px;margin-top:14px">Reload the page. If it persists, the audio backend or your connection may be down.</p></div>';
  }
  if (window.console) console.error("SIGNAL fatal:", err);
}

try {
// ---------------------------------------------------------------- config
function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(timer));
}
async function loadConfig() {
  try {
    const r = await fetchWithTimeout("config.json", 8000);
    if (!r.ok) throw new Error("config.json http " + r.status);
    return await r.json();
  } catch (e) {
    throw new Error("could not load config.json: " + (e.message || e));
  }
}
async function loadCatalog(cfg) {
  const bases = [cfg.audioBase, cfg.lanFallback].filter(Boolean);
  const errs = [];
  for (const base of bases) {
    try {
      const r = await fetchWithTimeout(base + "/catalog.json", 6000);
      if (!r.ok) throw new Error("http " + r.status);
      const data = await r.json();
      if (Array.isArray(data) && data.length) { return { data, base }; }
      throw new Error("empty catalog");
    } catch (e) { errs.push(base + "  ->  " + (e.message || e)); }
  }
  throw new Error("no catalog source reachable:\n" + errs.join("\n"));
}

// ---------------------------------------------------------------- state
const CONFIG = await loadConfig();
const LOADED = await loadCatalog(CONFIG);
const CATALOG = LOADED.data;
let AUDIO_BASE = LOADED.base;

let pool = CATALOG.slice();
let queue = [];
let qIndex = -1;
let selectedGenre = null;
let selectedMood = null;
let searchTerm = "";
let shuffle = true;

// ---------------------------------------------------------------- audio
const audio = new Audio();
audio.crossOrigin = "anonymous";
audio.volume = 0.8;
let actx = null, analyser = null, freqData = null, audioLevel = 0;

function ensureAnalyser() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const src = actx.createMediaElementSource(audio);
    analyser = actx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
    src.connect(analyser);
    analyser.connect(actx.destination);
    freqData = new Uint8Array(analyser.frequencyBinCount);
  } catch (e) { analyser = null; }
}
function sampleLevel() {
  if (!analyser) { audioLevel *= 0.9; return; }
  analyser.getByteFrequencyData(freqData);
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  const lvl = sum / freqData.length / 255;
  audioLevel = audioLevel * 0.6 + lvl * 0.4;
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function trackURL(t) { return AUDIO_BASE + "/audio/" + encodeURIComponent(t.file); }

function playIndex(i) {
  if (!queue.length) return;
  qIndex = (i + queue.length) % queue.length;
  const t = queue[qIndex];
  ensureAnalyser();
  if (actx && actx.state === "suspended") actx.resume();
  audio.src = trackURL(t);
  audio.play().catch(() => {});
  updateNowPlaying(t);
}
function startQueue() {
  if (!pool.length) { setStatus(false, "no tracks match"); return; }
  queue = pool.slice();
  if (shuffle) shuffleArr(queue);
  playIndex(0);
}
function next() { if (queue.length) playIndex(qIndex + 1); }
function prev() { if (queue.length) playIndex(qIndex - 1); }

audio.addEventListener("ended", () => next());
audio.addEventListener("error", () => next());

// ---------------------------------------------------------------- filters
function applyFilter(restart = true) {
  pool = CATALOG.filter(t => {
    if (selectedGenre && t.genre !== selectedGenre) return false;
    if (selectedMood && !t.moods.includes(selectedMood)) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const hay = (t.title + " " + t.genre + " " + (t.inspired_by || "") + " " + t.moods.join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  if (restart) startQueue();
}

// ---------------------------------------------------------------- three.js
const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.FogExp2(0x05060a, 0.016);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);
camera.position.set(0, 7, 22);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.5;
controls.minDistance = 8;
controls.maxDistance = 60;
controls.maxPolarAngle = Math.PI * 0.85;

// lights
scene.add(new THREE.AmbientLight(0x334466, 0.7));
const keyLight = new THREE.PointLight(0x46e0ff, 3.2, 60);
keyLight.position.set(0, 9, 0);
scene.add(keyLight);
const rimLight = new THREE.PointLight(0xb06bff, 1.6, 80);
rimLight.position.set(14, 6, -10);
scene.add(rimLight);

// starfield
{
  const N = 1600;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const r = 60 + Math.random() * 120;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.6;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color: 0x9fb6e6, size: 0.28, sizeAttenuation: true, transparent: true, opacity: 0.8 });
  scene.add(new THREE.Points(g, m));
}

// ground grid
{
  const grid = new THREE.GridHelper(120, 60, 0x1b2b4a, 0x101a30);
  grid.position.y = -2;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(grid);
}

// central tower
const tower = new THREE.Group();
{
  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.26, 7.5, 14),
    new THREE.MeshStandardMaterial({ color: 0x2a3a5a, metalness: 0.7, roughness: 0.35, emissive: 0x0a1424 })
  );
  mast.position.y = 3.75;
  tower.add(mast);
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(1.1, 1.5, 0.5, 24),
    new THREE.MeshStandardMaterial({ color: 0x1a2740, metalness: 0.6, roughness: 0.5 })
  );
  base.position.y = 0.25;
  tower.add(base);
}
const emitter = new THREE.Mesh(
  new THREE.SphereGeometry(0.7, 32, 32),
  new THREE.MeshStandardMaterial({ color: 0x46e0ff, emissive: 0x46e0ff, emissiveIntensity: 1.4, roughness: 0.2 })
);
emitter.position.y = 8.2;
tower.add(emitter);
const tip = new THREE.Mesh(
  new THREE.SphereGeometry(0.16, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2 })
);
tip.position.y = 9.1;
tower.add(tip);
scene.add(tower);

// expanding signal rings
const rings = [];
for (let i = 0; i < 4; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.05, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.5 })
  );
  ring.position.y = 8.2;
  ring.rotation.x = Math.PI / 2;
  ring.userData.phase = i / 4;
  scene.add(ring);
  rings.push(ring);
}

// genre nodes
function makeLabel(text, css) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = "700 46px 'Segoe UI', sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w; c.height = 64;
  ctx.font = font;
  ctx.fillStyle = css;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, 14, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set((w / 64) * 1.7, 1.7, 1);
  return sp;
}

const genreCounts = {};
for (const t of CATALOG) genreCounts[t.genre] = (genreCounts[t.genre] || 0) + 1;
const allGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
const TOP_N = 18;
const topGenres = allGenres.slice(0, TOP_N);

const nodeGroup = new THREE.Group();
const nodeMeshes = [];
const RADIUS = 13;
topGenres.forEach(([genre, count], i) => {
  const ang = (i / topGenres.length) * Math.PI * 2;
  const hue = i / topGenres.length;
  const color = new THREE.Color().setHSL(hue, 0.75, 0.55);
  const mesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.55, roughness: 0.3, metalness: 0.3, flatShading: true })
  );
  mesh.position.set(Math.cos(ang) * RADIUS, 4, Math.sin(ang) * RADIUS);
  mesh.userData = { genre, count, baseY: 4, idx: i, color };
  const label = makeLabel(genre.replace(/_/g, " "), "#e8eefc");
  label.position.set(0, 1.9, 0);
  mesh.add(label);
  nodeGroup.add(mesh);
  nodeMeshes.push(mesh);
});
scene.add(nodeGroup);

// raycasting
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
function pickNode(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(nodeMeshes, false);
  return hits.length ? hits[0].object : null;
}
canvas.addEventListener("pointermove", (e) => {
  const n = pickNode(e);
  if (n !== hovered) {
    hovered = n;
    canvas.style.cursor = n ? "pointer" : "default";
  }
});
canvas.addEventListener("click", (e) => {
  if (e.target !== canvas) return;
  const n = pickNode(e);
  if (n) selectGenre(n.userData.genre);
});

function selectGenre(genre) {
  selectedGenre = (selectedGenre === genre) ? null : genre;
  // clear mood when choosing a specific station (keeps the pool sensible)
  selectedMood = null;
  syncUI();
  applyFilter(true);
}

// ---------------------------------------------------------------- UI
const stationList = document.getElementById("station-list");
const vibeChips = document.getElementById("vibe-chips");
const npTitle = document.getElementById("np-title");
const npGenre = document.getElementById("np-genre");
const npMoods = document.getElementById("np-moods");
const npFill = document.getElementById("np-fill");
const npTime = document.getElementById("np-time");
const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");

function buildStationList() {
  const free = document.createElement("div");
  free.className = "station";
  free.dataset.genre = "";
  free.innerHTML = '<span class="name"><span class="swatch" style="color:#46e0ff;background:#46e0ff"></span>freeform</span><span class="count">' + CATALOG.length + "</span>";
  free.onclick = () => { selectedGenre = null; syncUI(); applyFilter(true); };
  stationList.appendChild(free);
  for (const [genre, count] of allGenres) {
    const hue = Math.abs(hashStr(genre)) % 360;
    const el = document.createElement("div");
    el.className = "station";
    el.dataset.genre = genre;
    el.innerHTML = '<span class="name"><span class="swatch" style="color:hsl(' + hue + ",80%,60%);background:hsl(" + hue + ",80%,60%)"></span>' +
      genre.replace(/_/g, " ") + "</span><span class="count\">" + count + "</span>";
    el.onclick = () => selectGenre(genre);
    stationList.appendChild(el);
  }
}
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

function buildVibes() {
  const moodCounts = {};
  for (const t of CATALOG) for (const m of t.moods) moodCounts[m] = (moodCounts[m] || 0) + 1;
  const top = Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 16);
  const all = document.createElement("div");
  all.className = "chip active";
  all.textContent = "all";
  all.onclick = () => { selectedMood = null; syncUI(); applyFilter(true); };
  vibeChips.appendChild(all);
  for (const [m] of top) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.mood = m;
    chip.textContent = m;
    chip.onclick = () => { selectedMood = (selectedMood === m) ? null : m; syncUI(); applyFilter(true); };
    vibeChips.appendChild(chip);
  }
}

function syncUI() {
  document.querySelectorAll("#station-list .station").forEach(el => {
    el.classList.toggle("active", (el.dataset.genre || null) === selectedGenre);
  });
  document.querySelectorAll(".chip").forEach(el => {
    const m = el.dataset.mood;
    el.classList.toggle("active", m ? m === selectedMood : selectedMood === null);
  });
  nodeMeshes.forEach(n => {
    const on = n.userData.genre === selectedGenre;
    n.material.emissiveIntensity = on ? 1.6 : 0.55;
    n.scale.setScalar(on ? 1.5 : 1.0);
  });
}

function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function updateNowPlaying(t) {
  npTitle.textContent = t.title;
  npGenre.textContent = t.genre.replace(/_/g, " ");
  npMoods.innerHTML = t.moods.slice(0, 4).map(m => "<span>" + m + "</span>").join("");
}
function setStatus(ok, text) {
  statusDot.className = ok ? "ok" : "bad";
  statusText.textContent = text;
}

// controls
document.getElementById("btn-play").onclick = () => {
  ensureAnalyser();
  if (audio.paused) { if (actx && actx.state === "suspended") actx.resume(); audio.play().catch(() => {}); }
  else audio.pause();
};
document.getElementById("btn-next").onclick = next;
document.getElementById("btn-prev").onclick = prev;
document.getElementById("btn-shuffle").onclick = (e) => {
  shuffle = !shuffle;
  e.currentTarget.classList.toggle("on", shuffle);
  startQueue();
};
document.getElementById("surprise").onclick = () => {
  if (!pool.length) applyFilter(false);
  if (pool.length) playIndex((Math.random() * pool.length) | 0);
};
document.getElementById("vol").oninput = (e) => { audio.volume = parseFloat(e.target.value); };
document.getElementById("search").oninput = (e) => { searchTerm = e.target.value.trim(); applyFilter(true); };
document.getElementById("np-bar").onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  if (isFinite(audio.duration)) audio.currentTime = f * audio.duration;
};
document.getElementById("stations-toggle").onclick = () => {
  document.getElementById("stations").style.display = "none";
  document.getElementById("stations-open").hidden = false;
};
document.getElementById("stations-open").onclick = () => {
  document.getElementById("stations").style.display = "flex";
  document.getElementById("stations-open").hidden = true;
};
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); document.getElementById("btn-play").click(); }
  if (e.code === "ArrowRight") next();
  if (e.code === "ArrowLeft") prev();
});

// progress
function tickProgress() {
  if (isFinite(audio.duration) && audio.duration > 0) {
    npFill.style.width = (audio.currentTime / audio.duration * 100) + "%";
    npTime.textContent = fmt(audio.currentTime) + " / " + fmt(audio.duration);
  }
  const playing = !audio.paused;
  document.getElementById("btn-play").innerHTML = playing ? "&#10074;&#10074;" : "&#9654;";
}
setInterval(tickProgress, 250);

// ---------------------------------------------------------------- boot
buildStationList();
buildVibes();
syncUI();
setStatus(true, CATALOG.length + " tracks · via " + (AUDIO_BASE.includes("trycloudflare") ? "tunnel" : "LAN"));
if (window.__signalBootTimeout) { clearTimeout(window.__signalBootTimeout); window.__signalBootTimeout = null; }
document.getElementById("loading").classList.add("hidden");
applyFilter(true);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  sampleLevel();

  controls.update();
  nodeGroup.rotation.y = t * 0.06;
  for (const n of nodeMeshes) {
    n.position.y = n.userData.baseY + Math.sin(t * 1.2 + n.userData.idx) * 0.25;
    if (n === hovered && n.userData.genre !== selectedGenre) n.scale.setScalar(1.25);
    else if (n.userData.genre !== selectedGenre) n.scale.setScalar(1.0);
  }
  const pulse = 1 + 0.12 * Math.sin(t * 2.4) + audioLevel * 0.9;
  emitter.scale.setScalar(pulse);
  emitter.material.emissiveIntensity = 1.2 + audioLevel * 3.5;
  keyLight.intensity = 2.6 + audioLevel * 6;
  for (const r of rings) {
    const ph = (t * 0.45 + r.userData.phase) % 1;
    const s = 1 + ph * 6;
    r.scale.set(s, s, 1);
    r.material.opacity = (1 - ph) * 0.55;
  }
  tickProgress();
  renderer.render(scene, camera);
}
animate();
} catch (e) {
  showFatal(e);
}
