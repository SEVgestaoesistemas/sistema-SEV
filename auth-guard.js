/* Keeps protected pages unavailable until the API validates the session cookie. */
(() => {
  if (!window.SevApi) return;

  document.documentElement.classList.add('auth-pending');
  let currentUser = null;
  let redirecting = false;
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';
  const pageRoles = {
    'financeiro.html': ['owner', 'admin', 'finance'],
    'equipe.html': ['owner', 'admin'],
    'configuracoes.html': ['owner', 'admin']
  };

  const applyNavigationPermissions = role => {
    document.querySelectorAll('a[href]').forEach(link => {
      const linkedPage = new URL(link.href, window.location.href).pathname.split('/').pop();
      if (pageRoles[linkedPage]) link.hidden = !pageRoles[linkedPage].includes(role);
    });
  };

  const redirectToLogin = () => {
    if (redirecting) return;
    redirecting = true;
    const next = `${currentPage}${window.location.search}${window.location.hash}`;
    window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
  };

  const redirectToPasswordChange = () => {
    if (redirecting || currentPage === 'trocar-senha.html') return;
    redirecting = true;
    window.location.replace('trocar-senha.html');
  };

  const showAccessBlockedScreen = ({ title, message }) => {
    document.documentElement.classList.remove('auth-pending');
    document.body.className = '';
    document.body.innerHTML = `
      <main class="signed-out-screen">
        <section class="signed-out-card" aria-labelledby="expiredPlanTitle">
          <img class="signed-out-logo" src="assets/sev-logo.jpeg" alt="SEV Gestão &amp; Sistemas">
          <h1 id="expiredPlanTitle">${title}</h1>
          <p>${message}</p>
          <a class="primary-button" href="login.html">Voltar para o acesso</a>
        </section>
      </main>`;
  };

  const ready = window.SevApi.getCurrentUser()
    .then(({ user }) => {
      currentUser = user;
      const role = user.organization?.role;
      applyNavigationPermissions(role);
      if (pageRoles[currentPage] && !pageRoles[currentPage].includes(role)) {
        redirecting = true;
        window.location.replace('index.html');
        return null;
      }
      if (user.passwordChangeRequired) {
        redirectToPasswordChange();
        return null;
      }
      if (user.companySuspended && !user.isPlatformAdmin) {
        showAccessBlockedScreen({
          title: 'Acesso da empresa suspenso',
          message: 'O acesso desta empresa foi pausado pela administração. Entre em contato com a SEV Gestão & Sistemas para regularizar.'
        });
        return null;
      }
      if (user.planExpired && !user.isPlatformAdmin) {
        showAccessBlockedScreen({
          title: 'Plano da empresa vencido',
          message: 'O acesso desta empresa foi pausado porque a validade do plano chegou ao fim. Entre em contato com a SEV Gestão & Sistemas para regularizar.'
        });
        return null;
      }
      if (user.planExpired && user.isPlatformAdmin && currentPage !== 'plataforma.html') {
        redirecting = true;
        window.location.replace('plataforma.html');
        return null;
      }
      if (currentPage === 'plataforma.html' && !user.isPlatformAdmin) {
        redirecting = true;
        window.location.replace('index.html');
        return null;
      }
      document.documentElement.classList.remove('auth-pending');
      return user;
    })
    .catch(() => {
      redirectToLogin();
      return null;
    });

  window.SevAuth = {
    ready,
    get user() {
      return currentUser;
    }
  };

  window.addEventListener('sev:unauthenticated', redirectToLogin);
})();
