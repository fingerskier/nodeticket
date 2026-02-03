/**
 * Nodeticket - User Interface JavaScript
 */

document.addEventListener('DOMContentLoaded', function() {
  // Tab toggle for login form (user/staff)
  const tabToggle = document.querySelector('.tab-toggle');
  if (tabToggle) {
    const radios = tabToggle.querySelectorAll('input[type="radio"]');
    radios.forEach(function(radio) {
      radio.addEventListener('change', function() {
        tabToggle.querySelectorAll('label').forEach(function(l) { l.classList.remove('active'); });
        var label = tabToggle.querySelector('label[for="' + radio.id + '"]');
        if (label) label.classList.add('active');
      });
      // Set initial active state
      if (radio.checked) {
        var label = tabToggle.querySelector('label[for="' + radio.id + '"]');
        if (label) label.classList.add('active');
      }
    });
  }

  // Password reset form validation
  var resetForm = document.getElementById('resetForm');
  if (resetForm) {
    resetForm.addEventListener('submit', function(e) {
      var password = document.getElementById('password');
      var confirm = document.getElementById('confirm');
      var errorDiv = document.getElementById('resetError');

      if (password && confirm && password.value !== confirm.value) {
        e.preventDefault();
        if (errorDiv) {
          errorDiv.innerHTML = '<div class="alert alert-danger">Passwords do not match.</div>';
        }
        return false;
      }

      if (password && password.value.length < 6) {
        e.preventDefault();
        if (errorDiv) {
          errorDiv.innerHTML = '<div class="alert alert-danger">Password must be at least 6 characters.</div>';
        }
        return false;
      }
    });
  }

  // FAQ accordion
  var faqItems = document.querySelectorAll('.faq-item');
  faqItems.forEach(function(item) {
    var question = item.querySelector('.faq-question');
    if (question) {
      question.style.cursor = 'pointer';
      question.addEventListener('click', function() {
        var answer = item.querySelector('.faq-answer');
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
