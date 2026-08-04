/* Login and first-account registration backed by the SEV API. */
(() => {
  if (!window.SevApi) return;

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginStatus = document.getElementById('loginStatus');
  const registerStatus = document.getElementById('registerStatus');
  const showLoginButton = document.getElementById('showLogin');
  const showRegisterButton = document.getElementById('showRegister');
  const loginPanel = document.getElementById('loginPanel');
  const registerPanel = document.getElementById('registerPanel');
  const requestedNext = new URLSearchParams(window.location.search).get('next');
  const allowedPages = new Set(['index.html', 'estoque.html', 'financeiro.html', 'vendas.html', 'relatorios.html', 'equipe.html', 'configuracoes.html']);
  const nextPage = requestedNext && allowedPages.has(requestedNext.split('?')[0].split('#')[0]) ? requestedNext : 'index.html';

  const setMode = mode => {
    const isLogin = mode === 'login';
    loginPanel.hidden = !isLogin;
    registerPanel.hidden = isLogin;
    showLoginButton.classList.toggle('active', isLogin);
    showLoginButton.setAttribute('aria-selected', String(isLogin));
    showRegisterButton.classList.toggle('active', !isLogin);
    showRegisterButton.setAttribute('aria-selected', String(!isLogin));
    (isLogin ? loginForm.elements.email : registerForm.elements.organizationName).focus();
  };

  const showStatus = (element, message, isError = false) => {
    element.textContent = message;
    element.classList.toggle('error', isError);
  };

  const setSubmitting = (form, submitting) => {
    const button = form.querySelector('button[type="submit"]');
    button.disabled = submitting;
    button.textContent = submitting ? 'Aguarde…' : button.dataset.label;
  };

  const finishAuthentication = () => {
    window.location.replace(nextPage);
  };

  showLoginButton.addEventListener('click', () => setMode('login'));
  showRegisterButton.addEventListener('click', () => setMode('register'));

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!loginForm.reportValidity()) return;

    showStatus(loginStatus, '');
    setSubmitting(loginForm, true);
    try {
      await window.SevApi.login({
        email: loginForm.elements.email.value.trim().toLowerCase(),
        password: loginForm.elements.password.value
      });
      finishAuthentication();
    } catch (error) {
      showStatus(loginStatus, error.message, true);
    } finally {
      setSubmitting(loginForm, false);
    }
  });

  registerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!registerForm.reportValidity()) return;

    const password = registerForm.elements.password.value;
    const confirmPassword = registerForm.elements.confirmPassword.value;
    if (password !== confirmPassword) {
      showStatus(registerStatus, 'As senhas informadas não são iguais.', true);
      registerForm.elements.confirmPassword.focus();
      return;
    }

    showStatus(registerStatus, '');
    setSubmitting(registerForm, true);
    try {
      await window.SevApi.register({
        organizationName: registerForm.elements.organizationName.value.trim(),
        name: registerForm.elements.name.value.trim(),
        email: registerForm.elements.email.value.trim().toLowerCase(),
        password
      });
      finishAuthentication();
    } catch (error) {
      showStatus(registerStatus, error.message, true);
    } finally {
      setSubmitting(registerForm, false);
    }
  });

  window.SevApi.getCurrentUser().then(() => finishAuthentication()).catch(() => {
    // No active session: keep the login page available.
  });
})();
