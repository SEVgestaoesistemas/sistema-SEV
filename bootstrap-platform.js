/* One-time setup for the first platform administrator. */
(() => {
  if (!window.SevApi) return;
  const form = document.getElementById('bootstrapForm');
  const status = document.getElementById('bootstrapStatus');
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = 'Configurando…';
    showStatus('');
    try {
      await window.SevApi.bootstrapPlatformAdmin({
        email: form.elements.email.value.trim().toLowerCase(),
        token: form.elements.token.value
      });
      showStatus('Administrador configurado. Entre com sua conta para gerenciar os clientes.');
      form.reset();
      window.setTimeout(() => window.location.replace('login.html'), 1800);
    } catch (error) {
      showStatus(error.message || 'Não foi possível configurar o administrador.', true);
    } finally {
      button.disabled = false;
      button.textContent = button.dataset.label;
    }
  });
})();
