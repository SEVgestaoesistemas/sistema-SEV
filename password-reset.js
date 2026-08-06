/* Completes a password reset from a one-time fragment token. */
(() => {
  if (!window.SevApi) return;
  const form = document.getElementById('passwordResetForm');
  const status = document.getElementById('passwordResetStatus');
  const submitButton = form.querySelector('button[type="submit"]');
  let token = '';
  try {
    const match = window.location.hash.match(/^#token=([A-Za-z0-9_-]{40,128})$/);
    token = match ? decodeURIComponent(match[1]) : '';
  } catch {
    token = '';
  }
  if (window.location.hash) history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);

  const showStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  if (!token) {
    submitButton.disabled = true;
    showStatus('Este link de recuperação é inválido. Solicite um novo link para redefinir sua senha.', true);
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const newPassword = form.elements.newPassword.value;
    if (newPassword !== form.elements.confirmPassword.value) {
      showStatus('As novas senhas não são iguais.', true);
      form.elements.confirmPassword.focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = 'Salvando…';
    showStatus('');
    try {
      await window.SevApi.confirmPasswordReset({ token, newPassword });
      token = '';
      window.location.replace('login.html?reset=success');
    } catch (error) {
      showStatus(error.message || 'Não foi possível redefinir a senha.', true);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = submitButton.dataset.label;
    }
  });
})();
