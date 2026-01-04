/**
 * Nodeticket - User Interface JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
  // Login form handler
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async function(e) {
      // Form will submit normally - this is just for potential future AJAX handling
    });
  }

  // Show error if present in URL
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');
  if (error) {
    const errorDiv = document.getElementById('loginError');
    if (errorDiv) {
      if (error === 'invalid') {
        errorDiv.textContent = 'Invalid username or password.';
      } else if (error === 'server') {
        errorDiv.textContent = 'A server error occurred. Please try again.';
      } else {
        errorDiv.textContent = 'An error occurred. Please try again.';
      }
    }
  }

  // FAQ accordion (if needed)
  const faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(item => {
    const question = item.querySelector('.faq-question');
    if (question) {
      question.style.cursor = 'pointer';
      question.addEventListener('click', function() {
        const answer = item.querySelector('.faq-answer');
        if (answer) {
          answer.style.display = answer.style.display === 'none' ? 'block' : 'none';
        }
      });
    }
  });
});

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
