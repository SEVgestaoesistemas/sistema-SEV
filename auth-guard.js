/* Keeps protected pages unavailable until the API validates the session cookie. */
(() => {
  if (!window.SevApi) return;

  document.documentElement.classList.add('auth-pending');
  let currentUser = null;
  let redirecting = false;
  const currentPage = window.location.pathname.split('/').pop() || 'index.html';

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

  const showExpiredPlanScreen = () => {
    document.documentElement.classList.remove('auth-pending');
    document.body.className = '';
    document.body.innerHTML = `
      <main class="signed-out-screen">
        <section class="signed-out-card" aria-labelledby="expiredPlanTitle">
          <img class="signed-out-logo" src="assets/sev-logo.jpeg" alt="SEV Gestão &amp; Sistemas">
          <h1 id="expiredPlanTitle">Plano da empresa vencido</h1>
          <p>O acesso desta empresa foi pausado porque a validade do plano chegou ao fim. Entre em contato com a SEV Gestão &amp; Sistemas para regularizar.</p>
          <a class="primary-button" href="login.html">Voltar para o acesso</a>
        </section>
      </main>`;
  };

  const ready = window.SevApi.getCurrentUser()
    .then(({ user }) => {
      currentUser = user;
      if (user.passwordChangeRequired) {
        redirectToPasswordChange();
        return null;
      }
      if (user.planExpired && !user.isPlatformAdmin) {
        showExpiredPlanScreen();
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
