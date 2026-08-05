/* Login and first-account registration backed by the SEV API. */
(() => {
  if (!window.SevApi) return;

  const loginForm = document.getElementById('loginForm');
  const loginStatus = document.getElementById('loginStatus');
  const requestedNext = new URLSearchParams(window.location.search).get('next');
  const allowedPages = new Set(['index.html', 'estoque.html', 'financeiro.html', 'vendas.html', 'relatorios.html', 'equipe.html', 'configuracoes.html', 'plataforma.html']);
  const nextPage = requestedNext && allowedPages.has(requestedNext.split('?')[0].split('#')[0]) ? requestedNext : 'index.html';

  const showStatus = (element, message, isError = false) => {
    element.textContent = message;
    element.classList.toggle('error', isError);
  };

  const setSubmitting = (form, submitting) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = submitting;
    button.textContent = submitting ? 'Aguarde…' : button.dataset.label;
  };

  const finishAuthentication = user => {
    window.location.replace(user?.passwordChangeRequired ? 'trocar-senha.html' : nextPage);
  };

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    showStatus(loginStatus, '');
    setSubmitting(loginForm, true);
    try {
      const user = await window.SevApi.login({
        email: loginForm.elements.email.value.trim().toLowerCase(),
        password: loginForm.elements.password.value
      });
      finishAuthentication(user);
    } catch (error) {
      showStatus(loginStatus, error.message, true);
    } finally {
      setSubmitting(loginForm, false);
    }
  });

  window.SevApi.getCurrentUser().then(({ user }) => finishAuthentication(user)).catch(() => {
    // No active session: keep the login page available.
  });
})();
