/* Invitation tokens remain in the URL fragment so they are never sent to the web server. */
(() => {
  if (!window.SevApi) return;

  const form = document.getElementById('invitationForm');
  const status = document.getElementById('invitationStatus');
  const invalidStatus = document.getElementById('invalidInvitationStatus');
  const token = new URLSearchParams(window.location.hash.slice(1)).get('invite');

  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  if (!token || token.length < 40 || token.length > 128) {
    invalidStatus.hidden = false;
    return;
  }

  // Remove the token from the visible address and browser history as soon as it is read.
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  form.hidden = false;
  form.elements.name.focus();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const password = form.elements.password.value;
    if (password !== form.elements.confirmPassword.value) {
      showStatus('As senhas não são iguais.', true);
      form.elements.confirmPassword.focus();
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Criando acesso…';
    showStatus('');
    try {
      await window.SevApi.acceptInvitation({
        token,
        name: form.elements.name.value.trim(),
        password
      });
      window.location.replace('index.html');
    } catch (error) {
      showStatus(error.message || 'Não foi possível aceitar o convite.', true);
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.label;
    }
  });
})();
