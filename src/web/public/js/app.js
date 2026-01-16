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
