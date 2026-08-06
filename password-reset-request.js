/* Password recovery is handled manually; this page only prepares a safe WhatsApp contact link. */
(() => {
  if (!window.SevApi) return;

  const emailInput = document.getElementById('passwordRecoveryEmail');
  const status = document.getElementById('passwordResetRequestStatus');
  const whatsappLink = document.getElementById('passwordRecoveryWhatsApp');
  let whatsappNumber = null;

  const messageFor = email => email
    ? `Olá, esqueci minha senha da conta ${email} e preciso de ajuda para acessar minha conta.`
    : 'Olá, esqueci minha senha e preciso de ajuda para acessar minha conta.';

  const updateLink = () => {
    if (!whatsappNumber) return;
    const email = emailInput.value.trim().toLowerCase();
    whatsappLink.href = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageFor(email))}`;
  };

  try {
    const savedEmail = sessionStorage.getItem('sev.password-recovery-email');
    if (savedEmail) emailInput.value = savedEmail;
    sessionStorage.removeItem('sev.password-recovery-email');
  } catch {
    // The contact flow remains available without browser storage.
  }

  emailInput.addEventListener('input', updateLink);

  window.SevApi.getManualPasswordResetContact()
    .then(contact => {
      whatsappNumber = contact.whatsappNumber;
      if (!whatsappNumber) {
        status.textContent = 'O canal de atendimento está sendo configurado. Tente novamente em alguns minutos.';
        status.classList.add('error');
        return;
      }
      updateLink();
      whatsappLink.hidden = false;
      status.textContent = 'Ao abrir o WhatsApp, informe apenas os dados necessários para localizar sua conta.';
    })
    .catch(() => {
      status.textContent = 'Não foi possível carregar o canal de atendimento. Verifique sua conexão e tente novamente.';
      status.classList.add('error');
    });
})();
