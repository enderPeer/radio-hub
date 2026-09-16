# SIGNAL — Radio Hub

A 3D "radio hub" for 564 original generated tracks. Tune in by **genre
(stations)** or by **mood (vibes)**, in a three.js scene. All music is original.

## How it works

- **This repo (GitHub Pages)** is the static front-end only: the 3D scene, the
  browser player, and a small `config.json` pointer.
- The **audio + catalog** live on the cluster (Knecht24) and are exposed over a
  Cloudflare quick tunnel. The quick-tunnel hostname changes whenever the tunnel
  restarts, so the front-end does not hard-code it: it reads `config.json`
  (stable, same origin) to find the current `audioBase`, and falls back to the
  LAN address on the local network.
- A **watchdog** keeps the backend + tunnel alive and rewrites `config.json`
  (pushing it here) when the tunnel hostname changes.

## Files

| file | role |
|---|---|
| `index.html` | page shell + UI |
| `main.js` | three.js scene, audio engine, browse/player logic |
| `style.css` | dark neon theme |
| `config.json` | **stable pointer** to the live audio backend (updated by the watchdog) |

## Endpoints (on the backend)

- `GET /catalog.json` — the 564-track catalog (`title, genre, moods, bpm, key, duration, file, set, inspired_by`)
- `GET /audio/<file.mp3>` — Range-capable MP3 streaming
- `GET /now.json` — dynamic status (`time, tracks, catalog_sha`)
- `GET /health` — liveness

## Keyboard

- `Space` play/pause · `←`/`→` previous/next
