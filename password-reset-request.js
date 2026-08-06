/* Public password-reset request without account enumeration. */
(() => {
  if (!window.SevApi) return;
  const form = document.getElementById('passwordResetRequestForm');
  const status = document.getElementById('passwordResetRequestStatus');
  const showStatus = (message, isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Enviando…';
    showStatus('');
    try {
      await window.SevApi.requestPasswordReset(form.elements.email.value.trim().toLowerCase());
      showStatus('Se houver uma conta ativa com este e-mail, enviaremos um link de recuperação em alguns minutos.');
      form.reset();
    } catch (error) {
      showStatus(error.message || 'Não foi possível solicitar a recuperação de senha.', true);
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.label;
    }
  });
})();
