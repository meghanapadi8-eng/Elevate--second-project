(() => {
  const form = document.getElementById('resetForm');
  const alert = document.getElementById('resetAlert');
  const button = document.getElementById('resetSubmit');
  const token = new URLSearchParams(location.search).get('token') || '';
  const showAlert = (message, type = 'danger') => {
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    alert.classList.remove('d-none');
  };

  if (history.replaceState) history.replaceState(null, '', location.pathname);
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    form.classList.add('d-none');
    showAlert('This reset link is invalid or has expired. Request a new password-reset email.');
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const password = document.getElementById('newPassword').value;
    const confirmation = document.getElementById('confirmPassword').value;
    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      return;
    }
    if (password !== confirmation) {
      showAlert('The passwords do not match.');
      return;
    }

    button.disabled = true;
    button.textContent = 'Updating password…';
    try {
      const response = await fetch(ElevateAuth.url('/auth/reset-password'), {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({token, password})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `Password reset failed (${response.status}).`);
      form.classList.add('d-none');
      showAlert(data.message || 'Your password has been reset. You can now sign in.', 'success');
    } catch (error) {
      showAlert(error.message || 'Could not reset the password. Please request a new link.');
    } finally {
      button.disabled = false;
      button.textContent = 'Update password';
    }
  });
})();
