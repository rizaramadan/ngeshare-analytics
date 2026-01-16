// Chart rendering functions

function renderFunnelChart(data) {
  const ctx = document.getElementById('funnelChart');
  if (!ctx) return;

  // Group data by course
  const courses = ['Ngeshare Sesi Aqidah', 'Ngeshare Sesi Hijrah', 'Ngeshare Sesi Sejarah', 'Ngeshare Sesi Dakwah'];
  const statuses = ['ACTIVE', 'GRADUATED', 'STALLED'];
  const colors = {
    ACTIVE: 'rgba(34, 197, 94, 0.8)',
    GRADUATED: 'rgba(37, 99, 235, 0.8)',
    STALLED: 'rgba(245, 158, 11, 0.8)'
  };

  // Create datasets for each status
  const datasets = statuses.map(status => {
    return {
      label: status,
      data: courses.map(course => {
        const item = data.find(d => d.course_name === course && d.computed_status === status);
        return item ? item.group_count : 0;
      }),
      backgroundColor: colors[status]
    };
  });

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: courses.map(c => c.replace('Ngeshare Sesi ', '')),
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom'
        }
      },
      scales: {
        x: {
          stacked: true
        },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            stepSize: 10
          }
        }
      }
    }
  });
}
