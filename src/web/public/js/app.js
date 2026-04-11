// Shared app utilities

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });
}

function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return num.toLocaleString('id-ID');
}

function getStatusBadge(status) {
  const statusLower = (status || '').toLowerCase();
  return `<span class="status ${statusLower}">${status}</span>`;
}

function getProgressBar(pct) {
  const percent = pct || 0;
  return `
    <div class="progress-bar">
      <div class="fill" style="width: ${percent}%"></div>
    </div>
    <div class="progress-text">${percent}%</div>
  `;
}

// --- Theme ---
function getTheme() {
  return localStorage.getItem('theme') || 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('theme', theme);
  const btn = document.getElementById('themeToggleBtn');
  if (btn) {
    btn.textContent = theme === 'dark' ? '☀ Light' : '☾ Dark';
  }
}

// Apply saved theme immediately
setTheme(getTheme());

// --- Navbar right section (last sync + theme toggle) ---
document.addEventListener('DOMContentLoaded', () => {
  const navbar = document.querySelector('.navbar');
  if (!navbar) return;

  const right = document.createElement('div');
  right.className = 'navbar-right';
  right.innerHTML = `
    <span class="last-sync" id="lastSyncInfo">Sync: ...</span>
    <button class="theme-toggle" id="themeToggleBtn" type="button">${getTheme() === 'dark' ? '☀ Light' : '☾ Dark'}</button>
  `;
  navbar.appendChild(right);

  // Theme toggle
  document.getElementById('themeToggleBtn').addEventListener('click', () => {
    setTheme(getTheme() === 'dark' ? 'light' : 'dark');
  });

  // Fetch last sync
  fetch('/api/last-sync')
    .then(r => r.json())
    .then(data => {
      const el = document.getElementById('lastSyncInfo');
      if (data.last_sync) {
        const d = new Date(data.last_sync);
        const ago = timeSince(d);
        el.textContent = `Sync: ${ago}`;
        el.title = d.toLocaleString('id-ID');
      } else {
        el.textContent = 'Sync: never';
      }
    })
    .catch(() => {
      const el = document.getElementById('lastSyncInfo');
      if (el) el.textContent = 'Sync: -';
    });
});

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
