/**
 * Nodeticket - Admin Interface JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
  // Auto-submit filter forms on select change
  const filterSelects = document.querySelectorAll('.filter-form select');
  filterSelects.forEach(select => {
    select.addEventListener('change', function() {
      this.form.submit();
    });
  });

  // Confirm dangerous actions
  const dangerousLinks = document.querySelectorAll('[data-confirm]');
  dangerousLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      const message = this.getAttribute('data-confirm') || 'Are you sure?';
      if (!confirm(message)) {
        e.preventDefault();
      }
    });
  });

  // Toggle sidebar on mobile
  const sidebarToggle = document.getElementById('sidebarToggle');
  if (sidebarToggle) {
    sidebarToggle.addEventListener('click', function() {
      document.querySelector('.sidebar').classList.toggle('open');
    });
  }

  // Auto-refresh dashboard stats (every 5 minutes)
  if (document.querySelector('.dashboard-stats')) {
    setInterval(function() {
      // Only refresh if user is still on the page
      if (!document.hidden) {
        // For now, just reload - could be enhanced with AJAX
        // location.reload();
      }
    }, 5 * 60 * 1000);
  }

  // Highlight current time in dates
  const dates = document.querySelectorAll('[data-timestamp]');
  dates.forEach(el => {
    const timestamp = el.getAttribute('data-timestamp');
    if (timestamp) {
      el.textContent = new Date(timestamp).toLocaleString();
    }
  });
});

/**
 * API helper for future AJAX functionality
 */
const api = {
  baseUrl: '/api/v1',

  async get(endpoint) {
    const response = await fetch(this.baseUrl + endpoint, {
      credentials: 'same-origin'
    });
    return response.json();
  },

  async post(endpoint, data) {
    const response = await fetch(this.baseUrl + endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'same-origin',
      body: JSON.stringify(data)
    });
    return response.json();
  }
};

/**
 * Format number with commas
 */
function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format date for display
 */
function formatDate(dateString) {
  if (!dateString) return 'N/A';
  const date = new Date(dateString);
  return date.toLocaleString();
}

/**
 * Escape HTML entities
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}
