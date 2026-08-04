/* Keeps protected pages unavailable until the API validates the session cookie. */
(() => {
  if (!window.SevApi) return;

  document.documentElement.classList.add('auth-pending');
  let currentUser = null;
  let redirecting = false;

  const redirectToLogin = () => {
    if (redirecting) return;
    redirecting = true;
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const next = `${page}${window.location.search}${window.location.hash}`;
    window.location.replace(`login.html?next=${encodeURIComponent(next)}`);
  };

  const ready = window.SevApi.getCurrentUser()
    .then(({ user }) => {
      currentUser = user;
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
