import { CONFIG } from './main.js';

const CHAT_STORAGE_KEY = 'signal_chat_messages';
const PLAYLIST_STORAGE_KEY = 'signal_playlist';
const POLL_MS = 5000;
const POLL_GIVE_UP_MS = 30 * 60 * 1000;

function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, Object.assign({ signal: ctrl.signal }, opts || {})).finally(() => clearTimeout(timer));
}

// Try the tunnel base first, then the LAN fallback (same pattern as main.js).
async function apiFetch(path, opts) {
  if (!CONFIG) throw new Error('config not loaded');
  const bases = [CONFIG.audioBase, CONFIG.lanFallback].filter(Boolean);
  let lastErr = null;
  for (const b of bases) {
    try {
      const r = await fetchWithTimeout(b + path, 15000, opts);
      if (r.ok) return await r.json();
      lastErr = new Error('HTTP ' + r.status);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('no backend reachable');
}

export const chatSystem = {
  messages: [],
  playlist: [],
  jobEls: {},
  catalogCount: null,

  init() {
    if (!CONFIG) return;
    this.chatWindow = document.getElementById('chat-window');
    this.chatMessages = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.playlistList = document.getElementById('playlist-list');
    this.playlistForm = document.getElementById('playlist-add-form');

    this.loadMessages();
    this.loadPlaylist();
    this.setupTabs();
    this.setupEventListeners();
    this.setupAutoRefresh();

    // on phones the chat starts closed (opened via the floating button)
    if (window.matchMedia('(max-width: 760px)').matches) {
      this.chatWindow.classList.remove('open');
    }
  },

  setupTabs() {
    const tabs = document.querySelectorAll('.chat-tab');
    const pages = {
      requests: document.getElementById('chat-tab-requests'),
      playlist: document.getElementById('chat-tab-playlist')
    };
    const show = (name) => {
      tabs.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
      for (const [k, el] of Object.entries(pages)) el.classList.toggle('hidden', k !== name);
    };
    tabs.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
    this.switchTab = show;
  },

  setupEventListeners() {
    document.getElementById('fab-chat').addEventListener('click', () => {
      this.chatWindow.classList.toggle('open');
    });
    document.getElementById('chat-close').addEventListener('click', () => {
      this.chatWindow.classList.remove('open');
    });

    if (this.chatInput) {
      this.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });
    }
    document.getElementById('chat-send').addEventListener('click', () => this.sendMessage());

    document.getElementById('playlist-add-btn').addEventListener('click', () => this.showAddForm());
    document.getElementById('playlist-cancel').addEventListener('click', () => this.hideAddForm());
    document.getElementById('playlist-add-submit').addEventListener('click', () => this.addToPlaylist());
    document.getElementById('playlist-song-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addToPlaylist();
    });

    window.addEventListener('beforeunload', () => this.saveMessages());
  },

  formatTime() {
    const now = new Date();
    return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  },

  createMessageElement(user, content, isSystem = false) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-message';

    const userSpan = document.createElement('span');
    userSpan.className = 'user';
    userSpan.textContent = isSystem ? 'System' : user;

    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = this.formatTime();

    const contentDiv = document.createElement('div');
    contentDiv.className = 'content';
    contentDiv.textContent = content;

    msgDiv.appendChild(userSpan);
    msgDiv.appendChild(timeSpan);
    msgDiv.appendChild(contentDiv);

    return msgDiv;
  },

  addSystemMessage(content) {
    const msgDiv = this.createMessageElement('System', content, true);
    this.chatMessages.appendChild(msgDiv);
    this.scrollToBottom();
    return msgDiv;
  },

  async sendMessage() {
    const text = (this.chatInput.value || '').trim();
    if (!text) return;

    const user = localStorage.getItem('signal_username') || 'Guest' + Math.floor(Math.random() * 1000);
    localStorage.setItem('signal_username', user);

    this.chatMessages.appendChild(this.createMessageElement(user, text));
    this.messages.push({ user, content: text, timestamp: Date.now() });
    this.chatInput.value = '';
    this.scrollToBottom();
    this.saveMessages();

    await this.requestSong(text);
  },

  async requestSong(prompt) {
    const statusEl = this.addSystemMessage('⏳ Sending to the studio…');
    const setContent = (el, txt) => { el.querySelector('.content').textContent = txt; this.scrollToBottom(); };

    // is the studio already busy? say so, then queue behind it.
    try {
      const list = await apiFetch('/request');
      const busy = (list.jobs || []).find(j => j.status === 'queued' || j.status === 'generating' || j.status === 'publishing');
      if (busy) setContent(statusEl, '🎛 Studio is working on request #' + busy.id.slice(-6) + ' — yours will queue behind it.');
    } catch (e) { /* not critical */ }

    let job;
    try {
      job = await apiFetch('/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt })
      });
    } catch (e) {
      setContent(statusEl, '⚠️ Could not reach the studio backend: ' + e.message + '. Try again in a moment.');
      return;
    }

    const id = job.id;
    this.jobEls[id] = statusEl;
    setContent(statusEl, '⏳ Request #' + id.slice(-6) + ' received — in the studio queue.');

    const started = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - started > POLL_GIVE_UP_MS) {
        clearInterval(poll);
        setContent(statusEl, '⚠️ Still waiting after 30 minutes. The studio may be down — check back later.');
        delete this.jobEls[id];
        return;
      }
      let jobNow;
      try {
        jobNow = await apiFetch('/request/' + id);
      } catch (e) {
        return; // transient — keep polling
      }
      if (!this.jobEls[id]) { clearInterval(poll); return; }

      switch (jobNow.status) {
        case 'queued':
          setContent(this.jobEls[id], '⏳ Request #' + id.slice(-6) + ' — queued behind the studio.');
          break;
        case 'generating':
          setContent(this.jobEls[id], '🎛 Composing on Adler (ACE-Step XL) — usually 2–4 minutes…');
          break;
        case 'publishing':
          setContent(this.jobEls[id], '📻 Almost there — publishing to the station…');
          break;
        case 'done':
          clearInterval(poll);
          delete this.jobEls[id];
          if (jobNow.file) localStorage.setItem('signal_pending_play', jobNow.file);
          setContent(this.jobEls[id], '✅ “' + (jobNow.title || 'Your song') + '” is live on the radio! The station is reloading so it can play…');
          this.showAddedBadge();
          break;
        case 'failed':
          clearInterval(poll);
          delete this.jobEls[id];
          setContent(this.jobEls[id], '⚠️ Generation failed: ' + (jobNow.error || 'unknown error') + '. Try a different prompt.');
          break;
      }
    }, POLL_MS);
  },

  showAddedBadge() {
    const old = document.getElementById('added-badge');
    if (old) old.remove();
    const badge = document.createElement('div');
    badge.id = 'added-badge';
    badge.textContent = 'New song published!';
    document.body.appendChild(badge);
    setTimeout(() => { if (badge.parentNode) badge.remove(); }, 4000);
  },

  scrollToBottom() {
    if (this.chatMessages) {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
  },

  saveMessages() {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(this.messages.slice(-60)));
  },

  loadMessages() {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        this.messages = JSON.parse(saved);
        this.messages.forEach(msg => {
          this.chatMessages.appendChild(this.createMessageElement(msg.user, msg.content, false));
        });
      }
    } catch (e) {
      console.error('Failed to load chat messages:', e);
    }
  },

  setupAutoRefresh() {
    // Reload only when the catalog actually grows (a requested song was
    // published). The first check records the baseline and never reloads.
    const check = () => {
      apiFetch('/catalog.json?_=' + Date.now())
        .then(data => {
          if (!Array.isArray(data)) return;
          if (this.catalogCount === null) {
            this.catalogCount = data.length;
          } else if (data.length > this.catalogCount) {
            this.catalogCount = data.length;
            window.location.reload();
          }
        })
        .catch(() => {});
    };
    check();
    setInterval(check, 12000);
  },

  addPlaylistItem(song) {
    const empty = this.playlistList.querySelector('.playlist-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'playlist-item';
    item.dataset.file = song.file;

    const infoDiv = document.createElement('div');
    infoDiv.className = 'info';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.textContent = song.title;

    const artistSpan = document.createElement('span');
    artistSpan.className = 'artist';
    artistSpan.textContent = song.artist || song.genre;

    infoDiv.appendChild(titleSpan);
    infoDiv.appendChild(artistSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.innerHTML = '&times;';
    removeBtn.title = 'Remove from playlist';
    removeBtn.addEventListener('click', () => {
      item.remove();
      this.removeFromPlaylist(song.file);
      if (!this.playlistList.querySelector('.playlist-item')) {
        const e = document.createElement('div');
        e.className = 'playlist-empty';
        e.textContent = 'No songs in your playlist yet.';
        this.playlistList.appendChild(e);
      }
    });

    item.appendChild(infoDiv);
    item.appendChild(removeBtn);

    this.playlistList.appendChild(item);
    this.playlist.push(song);
    this.savePlaylist();
  },

  removeFromPlaylist(file) {
    this.playlist = this.playlist.filter(s => s.file !== file);
    this.savePlaylist();
  },

  savePlaylist() {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(this.playlist));
  },

  loadPlaylist() {
    try {
      const saved = localStorage.getItem(PLAYLIST_STORAGE_KEY);
      if (saved) {
        this.playlist = JSON.parse(saved);
        this.playlist.forEach(song => this.addPlaylistItem(song));
      }
    } catch (e) {
      console.error('Failed to load playlist:', e);
    }
  },

  showAddForm() {
    if (this.playlistForm) this.playlistForm.classList.add('active');
  },

  hideAddForm() {
    if (this.playlistForm) this.playlistForm.classList.remove('active');
    const input = document.getElementById('playlist-song-input');
    if (input) input.value = '';
  },

  addToPlaylist() {
    const input = document.getElementById('playlist-song-input');
    const text = (input.value || '').trim();
    if (!text) return;

    this.addPlaylistItem({
      title: text,
      artist: 'User request',
      genre: 'custom',
      moods: ['user-generated'],
      file: 'user_' + Date.now() + '.mp3',
      set: 'user_playlist'
    });
    this.hideAddForm();
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => chatSystem.init());
} else {
  chatSystem.init();
}
