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

let CONFIG = null;
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
CONFIG = await loadConfig();
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

// ---------------------------------------------------------------- three.js — a playful little solar system
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
function genreColor(name) {
  const hue = (Math.abs(hashStr(name)) % 360) / 360;
  return new THREE.Color().setHSL(hue, 0.82, 0.6);
}

const canvas = document.getElementById("scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a1c);
scene.fog = new THREE.FogExp2(0x0a0a1c, 0.011);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 500);
camera.position.set(0, 10, 27);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.4;
controls.minDistance = 9;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI * 0.9;

// lights
scene.add(new THREE.AmbientLight(0x5566aa, 0.9));
const coreLight = new THREE.PointLight(0x46e0ff, 5, 140, 1.5);
coreLight.position.set(0, 4, 0);
scene.add(coreLight);
const rimLight = new THREE.PointLight(0xff7ad9, 2.0, 120);
rimLight.position.set(20, 10, -16);
scene.add(rimLight);

// starfield (two layers for depth)
function makeStars(count, rMin, rMax, size, color, opacity) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.7;
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity, depthWrite: false });
  const p = new THREE.Points(g, m);
  scene.add(p);
  return p;
}
const stars1 = makeStars(2400, 70, 240, 0.55, 0xbfd4ff, 0.9);
const stars2 = makeStars(520, 60, 190, 1.2, 0xffd9a0, 0.75);

// ---------------------------------------------------------------- the core (music-reactive heart)
const coreGroup = new THREE.Group();
coreGroup.position.set(0, 4, 0);
const CORE_R = 2.7;
const core = new THREE.Mesh(
  new THREE.SphereGeometry(CORE_R, 48, 48),
  new THREE.MeshStandardMaterial({ color: 0x46e0ff, emissive: 0x46e0ff, emissiveIntensity: 1.2, roughness: 0.25, metalness: 0.1 })
);
coreGroup.add(core);
const halo = new THREE.Mesh(
  new THREE.SphereGeometry(CORE_R * 1.4, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.14, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false })
);
coreGroup.add(halo);
scene.add(coreGroup);

// expanding signal rings (music-coloured)
const rings = [];
for (let i = 0; i < 4; i++) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.05, 8, 90),
    new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  ring.rotation.x = Math.PI / 2;
  ring.userData.phase = i / 4;
  coreGroup.add(ring);
  rings.push(ring);
}

// ---------------------------------------------------------------- the hero planet (the track that is playing)
const heroGroup = new THREE.Group();
heroGroup.position.y = 4;
const HERO_R = 5.7;
const hero = new THREE.Mesh(
  new THREE.SphereGeometry(0.95, 32, 32),
  new THREE.MeshStandardMaterial({ color: 0x46e0ff, emissive: 0x46e0ff, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0.1 })
);
heroGroup.add(hero);
const heroRing = new THREE.Mesh(
  new THREE.TorusGeometry(HERO_R, 0.035, 8, 140),
  new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
);
heroRing.rotation.x = Math.PI / 2;
heroGroup.add(heroRing);
const TRAIL_N = 56;
const trailPos = new Float32Array(TRAIL_N * 3);
const trailCol = new Float32Array(TRAIL_N * 3);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
trailGeo.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
heroGroup.add(trail);
const heroLight = new THREE.PointLight(0x46e0ff, 1.6, 26);
heroGroup.add(heroLight);
hero.visible = false; heroRing.visible = false; trail.visible = false; heroLight.visible = false;
scene.add(heroGroup);
let heroAngle = 0;
const heroColor = new THREE.Color(0x46e0ff);
const trailHist = [];

const heroLabelEl = document.getElementById("hero-label");
const heroLabelTitle = heroLabelEl.querySelector("b");
const heroLabelGenre = heroLabelEl.querySelector("small");
const tooltipEl = document.getElementById("tooltip");
const _proj = new THREE.Vector3();
function placeProjected(el, obj) {
  obj.getWorldPosition(_proj);
  _proj.project(camera);
  if (_proj.z > 1) { el.style.opacity = "0"; return; }
  const x = (_proj.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-_proj.y * 0.5 + 0.5) * window.innerHeight;
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.opacity = "1";
}

// ---------------------------------------------------------------- genre planets (the catalog, as a starfield of worlds)
function makeLabel(text, css) {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d");
  const font = "700 46px 'Segoe UI', system-ui, sans-serif";
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 30;
  c.width = w; c.height = 64;
  ctx.font = font;
  ctx.fillStyle = css;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, 15, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set((w / 64) * 1.8, 1.8, 1);
  return sp;
}

const genreCounts = {};
for (const t of CATALOG) genreCounts[t.genre] = (genreCounts[t.genre] || 0) + 1;
const allGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]);
const TOP_N = 22;
const topGenres = allGenres.slice(0, TOP_N);

const planetGroup = new THREE.Group();
planetGroup.position.y = 4;
const planetMeshes = [];
const SHELLS = [9.5, 13, 16.5];
for (const r of SHELLS) {
  const guide = new THREE.Mesh(
    new THREE.TorusGeometry(r, 0.02, 6, 140),
    new THREE.MeshBasicMaterial({ color: 0x4a5a8a, transparent: true, opacity: 0.28, depthWrite: false })
  );
  guide.rotation.x = Math.PI / 2;
  planetGroup.add(guide);
}
topGenres.forEach(([genre, count], i) => {
  const color = genreColor(genre);
  const shell = SHELLS[i % SHELLS.length];
  const perShell = Math.ceil(topGenres.length / SHELLS.length);
  const idxInShell = Math.floor(i / SHELLS.length);
  const ang = (idxInShell / perShell) * Math.PI * 2 + (i % SHELLS.length) * 0.7;
  const size = 0.55 + Math.min(count, 50) / 50 * 0.7;
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(size, 28, 28),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.15 })
  );
  mesh.position.set(Math.cos(ang) * shell, 0, Math.sin(ang) * shell);
  mesh.userData = { genre, count, color, size, bob: Math.random() * Math.PI * 2 };
  const label = makeLabel(genre.replace(/_/g, " "), "#eaf1ff");
  label.position.set(0, size + 1.2, 0);
  label.visible = false;
  mesh.add(label);
  planetGroup.add(mesh);
  planetMeshes.push(mesh);
});
scene.add(planetGroup);

// ---------------------------------------------------------------- raycasting (hover + click a planet)
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let hovered = null;
function pickPlanet(e) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(planetMeshes, false);
  return hits.length ? hits[0].object : null;
}
canvas.addEventListener("pointermove", (e) => {
  const n = pickPlanet(e);
  if (n !== hovered) {
    hovered = n;
    canvas.style.cursor = n ? "pointer" : "default";
    if (n) {
      tooltipEl.querySelector("b").textContent = n.userData.genre.replace(/_/g, " ");
      tooltipEl.querySelector("small").textContent = n.userData.count + " tracks · tap to tune in";
      tooltipEl.style.opacity = "1";
    } else {
      tooltipEl.style.opacity = "0";
    }
  }
  if (hovered) {
    tooltipEl.style.left = e.clientX + "px";
    tooltipEl.style.top = (e.clientY + 18) + "px";
  }
});
canvas.addEventListener("click", (e) => {
  if (e.target !== canvas) return;
  const n = pickPlanet(e);
  if (n) selectGenre(n.userData.genre);
});

function selectGenre(genre) {
  selectedGenre = (selectedGenre === genre) ? null : genre;
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
    const hue = (Math.abs(hashStr(genre)) % 360);
    const el = document.createElement("div");
    el.className = "station";
    el.dataset.genre = genre;
    const sw = "hsl(" + hue + ",80%,62%)";
    el.innerHTML =
      '<span class="name"><span class="swatch" style="color:' + sw + ";background:" + sw + '"></span>' +
      genre.replace(/_/g, " ") + '</span><span class="count">' + count + "</span>";
    el.onclick = () => selectGenre(genre);
    stationList.appendChild(el);
  }
}

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
}

function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function updateNowPlaying(t) {
  npTitle.textContent = t.title;
  npGenre.textContent = t.genre.replace(/_/g, " ");
  npMoods.innerHTML = t.moods.slice(0, 4).map(m => "<span>" + m + "</span>").join("");
  // the playing track becomes the hero planet
  heroColor.copy(genreColor(t.genre));
  hero.material.color.copy(heroColor);
  hero.material.emissive.copy(heroColor);
  heroRing.material.color.copy(heroColor);
  heroLight.color.copy(heroColor);
  if (!hero.visible) {
    hero.visible = true; heroRing.visible = true; trail.visible = true; heroLight.visible = true;
    trailHist.length = 0;
  }
  heroLabelTitle.textContent = t.title;
  heroLabelGenre.textContent = t.genre.replace(/_/g, " ");
  document.documentElement.style.setProperty("--np-color", "#" + heroColor.getHexString());
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

// ---------------------------------------------------------------- the living loop
const clock = new THREE.Clock();
let coreHue = 0.55;
const coreColor = new THREE.Color();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();
  sampleLevel();

  // audio bands
  let bass = 0;
  if (freqData) { for (let i = 0; i < 10; i++) bass += freqData[i]; bass /= 10 * 255; }
  let num = 0, den = 0;
  if (freqData) { for (let i = 0; i < freqData.length; i++) { num += i * freqData[i]; den += freqData[i]; } }
  const centroid = den ? (num / den) / freqData.length : 0;

  // the core breathes and changes colour with the music
  coreHue = (coreHue + dt * (0.02 + audioLevel * 0.06) + (centroid - 0.45) * 0.0004) % 1;
  if (coreHue < 0) coreHue += 1;
  coreColor.setHSL(coreHue, 0.85, 0.55);
  core.material.color.copy(coreColor);
  core.material.emissive.copy(coreColor);
  core.material.emissiveIntensity = 0.9 + audioLevel * 2.6;
  const pulse = 1 + 0.08 * audioLevel + 0.18 * bass;
  core.scale.setScalar(pulse);
  halo.material.color.copy(coreColor);
  halo.material.opacity = 0.1 + audioLevel * 0.2;
  halo.scale.setScalar(pulse);
  coreLight.color.copy(coreColor);
  coreLight.intensity = 3 + audioLevel * 8 + bass * 5;
  coreGroup.rotation.y += dt * 0.15;

  // expanding signal rings
  for (const r of rings) {
    const ph = (t * 0.5 + r.userData.phase) % 1;
    const s = CORE_R * (1 + ph * 4.5);
    r.scale.set(s, s, 1);
    r.material.opacity = (1 - ph) * (0.3 + audioLevel * 0.5);
    r.material.color.copy(coreColor);
  }

  // genre planets drift, bob, and glow when selected
  planetGroup.rotation.y += dt * 0.05;
  for (const n of planetMeshes) {
    n.position.y = Math.sin(t * 1.1 + n.userData.bob) * 0.4;
    n.rotation.y += dt * 0.35;
    const on = n.userData.genre === selectedGenre;
    const target = on ? 1.6 : 1.0;
    n.scale.setScalar(n.scale.x + (target - n.scale.x) * 0.15);
    const eiTarget = on ? 1.5 : 0.5;
    n.material.emissiveIntensity += (eiTarget - n.material.emissiveIntensity) * 0.15;
    n.children[0].visible = (n === hovered) || on;
  }

  // the hero planet orbits the core, leaving a glowing trail
  if (hero.visible) {
    heroAngle += dt * 0.55;
    const hy = Math.sin(t * 1.3) * 0.3;
    hero.position.set(Math.cos(heroAngle) * HERO_R, hy, Math.sin(heroAngle) * HERO_R);
    hero.rotation.y += dt * 0.6;
    hero.scale.setScalar(1 + 0.14 * audioLevel);
    heroLight.position.copy(hero.position);
    trailHist.unshift(hero.position.clone());
    if (trailHist.length > TRAIL_N) trailHist.pop();
    for (let i = 0; i < TRAIL_N; i++) {
      const p = trailHist[Math.min(i, trailHist.length - 1)];
      trailPos[i * 3] = p.x; trailPos[i * 3 + 1] = p.y; trailPos[i * 3 + 2] = p.z;
      const f = 1 - i / TRAIL_N;
      trailCol[i * 3] = heroColor.r * f; trailCol[i * 3 + 1] = heroColor.g * f; trailCol[i * 3 + 2] = heroColor.b * f;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    placeProjected(heroLabelEl, hero);
  }

  stars1.rotation.y += dt * 0.005;
  stars2.rotation.y -= dt * 0.004;

  controls.update();
  tickProgress();
  renderer.render(scene, camera);
}
animate();
} catch (e) {
  showFatal(e);
}
export { CONFIG };
