import { CONFIG } from './main.js';

const CHAT_STORAGE_KEY = 'signal_chat_messages';
const PLAYLIST_STORAGE_KEY = 'signal_playlist';

export const chatSystem = {
  messages: [],
  playlist: [],
  chatWindow: null,
  chatMessages: null,
  chatInput: null,
  chatToggle: null,
  playlistSection: null,
  playlistList: null,
  playlistForm: null,
  socket: null,
  autoRefreshTimer: null,

  init() {
    this.chatWindow = document.getElementById('chat-window');
    this.chatMessages = document.getElementById('chat-messages');
    this.chatInput = document.getElementById('chat-input');
    this.chatToggle = document.getElementById('chat-toggle');
    this.playlistSection = document.getElementById('playlist-section');
    this.playlistList = document.getElementById('playlist-list');
    this.playlistForm = document.getElementById('playlist-add-form');
    
    this.loadMessages();
    this.loadPlaylist();
    this.setupEventListeners();
    this.setupAutoRefresh();
  },

  setupEventListeners() {
    this.chatToggle.addEventListener('click', () => this.toggleChat());
    
    if (this.chatInput) {
      this.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.sendMessage();
      });
      document.getElementById('chat-send').addEventListener('click', () => this.sendMessage());
    }
    
    document.getElementById('playlist-add-btn').addEventListener('click', () => this.showAddForm());
    document.getElementById('playlist-cancel').addEventListener('click', () => this.hideAddForm());
    document.getElementById('playlist-add-submit').addEventListener('click', () => this.addToPlaylist());
    
    window.addEventListener('beforeunload', () => this.saveMessages());
  },

  toggleChat() {
    this.chatWindow.classList.toggle('hidden');
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

  createSongRequestElement(title, artist, genre, moods) {
    const reqDiv = document.createElement('div');
    reqDiv.className = 'song-request';
    
    const titleSpan = document.createElement('span');
    titleSpan.className = 'title';
    titleSpan.textContent = title;
    
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'details';
    
    const detailsParts = [];
    if (artist) detailsParts.push(`by ${artist}`);
    if (genre) detailsParts.push(`genre: ${genre}`);
    if (moods && moods.length > 0) detailsParts.push(`moods: ${moods.join(', ')}`);
    
    detailsDiv.textContent = detailsParts.join(' | ');
    
    reqDiv.appendChild(titleSpan);
    reqDiv.appendChild(detailsDiv);
    
    return reqDiv;
  },

  async sendMessage() {
    const text = this.chatInput.value.trim();
    if (!text) return;
    
    const user = localStorage.getItem('signal_username') || 'Guest' + Math.floor(Math.random() * 1000);
    localStorage.setItem('signal_username', user);
    
    const msgDiv = this.createMessageElement(user, text);
    this.chatMessages.appendChild(msgDiv);
    
    this.messages.push({
      user,
      content: text,
      timestamp: Date.now()
    });
    
    this.chatInput.value = '';
    this.scrollToBottom();
    this.saveMessages();
    
    if (text.toLowerCase().startsWith('request:') || text.toLowerCase().includes('song')) {
      await this.processSongRequest(text);
    }
  },

  async processSongRequest(request) {
    const songData = {
      title: 'Generated Track',
      artist: 'AI Generator',
      genre: 'generated',
      moods: ['custom'],
      bpm: 120,
      duration: 180,
      file: `generated_${Date.now()}.mp3`,
      set: 'user_requests',
      inspired_by: request.replace('request:', '').trim()
    };
    
    try {
      const reqDiv = this.createSongRequestElement(
        songData.title,
        songData.artist,
        songData.genre,
        songData.moods
      );
      
      const msgDiv = this.createMessageElement('System', 'Processing song request...');
      msgDiv.appendChild(reqDiv);
      this.chatMessages.appendChild(msgDiv);
      this.scrollToBottom();
      
      await this.uploadSongToAdler(songData);
      
      const successMsg = this.createMessageElement('System', 'Song successfully generated and published! Reloading...');
      this.chatMessages.appendChild(successMsg);
      this.scrollToBottom();
      
      this.showAddedBadge();
      
      setTimeout(() => {
        window.location.reload();
      }, 3000);
      
    } catch (error) {
      const errorMsg = this.createMessageElement('System', `Error: ${error.message}`);
      this.chatMessages.appendChild(errorMsg);
      this.scrollToBottom();
    }
  },

  async uploadSongToAdler(songData) {
    const formData = new FormData();
    formData.append('title', songData.title);
    formData.append('artist', songData.artist);
    formData.append('genre', songData.genre);
    formData.append('moods', JSON.stringify(songData.moods));
    formData.append('bpm', songData.bpm);
    formData.append('duration', songData.duration);
    formData.append('inspired_by', songData.inspired_by);
    formData.append('file', new File([''], songData.file));
    
    const response = await fetch('https://adler-api.example.com/upload', {
      method: 'POST',
      body: formData
    });
    
    if (!response.ok) {
      throw new Error('Failed to upload song to Adler');
    }
    
    const result = await response.json();
    if (result.status !== 'success') {
      throw new Error('Adler upload failed');
    }
    
    return result;
  },

  showAddedBadge() {
    const badge = document.createElement('div');
    badge.id = 'added-badge';
    badge.textContent = 'New song published!';
    document.body.appendChild(badge);
    
    setTimeout(() => {
      if (badge.parentNode) {
        badge.style.animation = 'none';
        badge.offsetHeight;
        badge.style.animation = null;
        setTimeout(() => badge.remove(), 500);
      }
    }, 3000);
  },

  scrollToBottom() {
    if (this.chatMessages) {
      this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
    }
  },

  saveMessages() {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(this.messages));
  },

  loadMessages() {
    try {
      const saved = localStorage.getItem(CHAT_STORAGE_KEY);
      if (saved) {
        this.messages = JSON.parse(saved);
        this.messages.forEach(msg => {
          const msgDiv = this.createMessageElement(msg.user, msg.content, true);
          this.chatMessages.appendChild(msgDiv);
        });
      }
    } catch (e) {
      console.error('Failed to load chat messages:', e);
    }
  },

  setupAutoRefresh() {
    const checkInterval = setInterval(() => {
      fetch(CONFIG.audioBase + '/catalog.json?_=' + Date.now())
        .then(r => r.json())
        .then(data => {
          if (data.length !== this.messages.length) {
            window.location.reload();
          }
        })
        .catch(() => {});
    }, 10000);
  },

  addPlaylistItem(song) {
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
    if (this.playlistForm) {
      this.playlistForm.classList.add('active');
    }
  },

  hideAddForm() {
    if (this.playlistForm) {
      this.playlistForm.classList.remove('active');
    }
  },

  addToPlaylist() {
    const input = document.getElementById('playlist-song-input');
    const text = input.value.trim();
    
    if (text) {
      const song = {
        title: text,
        artist: 'User Request',
        genre: 'custom',
        moods: ['user-generated'],
        bpm: 120,
        duration: 180,
        file: `user_${Date.now()}.mp3`,
        set: 'user_playlist',
        inspired_by: 'User request'
      };
      
      this.addPlaylistItem(song);
      input.value = '';
      this.hideAddForm();
    }
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => chatSystem.init());
} else {
  chatSystem.init();
}
