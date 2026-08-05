/* Mandatory first-login password change. */
(() => {
  if (!window.SevApi) return;
  const form = document.getElementById('passwordChangeForm');
  const status = document.getElementById('passwordChangeStatus');
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const finish = () => window.location.replace('index.html');

  window.SevApi.getCurrentUser().then(({ user }) => {
    if (!user.passwordChangeRequired) finish();
  }).catch(() => window.location.replace('login.html'));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const currentPassword = form.elements.currentPassword.value;
    const newPassword = form.elements.newPassword.value;
    if (newPassword !== form.elements.confirmPassword.value) {
      showStatus('As novas senhas não são iguais.', true);
      form.elements.confirmPassword.focus();
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Salvando…';
    showStatus('');
    try {
      await window.SevApi.changePassword({ currentPassword, newPassword });
      finish();
    } catch (error) {
      showStatus(error.message || 'Não foi possível atualizar a senha.', true);
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.label;
    }
  });
})();
