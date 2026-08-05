/* Support chat. The Gemini key and all model calls stay on the API server. */
(() => {
  const widget = document.createElement('section');
  widget.className = 'support-widget';
  widget.innerHTML = `
    <button class="support-fab" id="supportButton" type="button" aria-label="Abrir suporte" aria-controls="supportPanel" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M20 11.5a7.7 7.7 0 0 1-8 7.5 9 9 0 0 1-3.2-.6L4 20l1.5-4.1A7.2 7.2 0 0 1 4 11.5 7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.5Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-linecap="round" stroke-width="2.7"/></svg>
      <span>Suporte</span>
    </button>
    <section class="support-panel" id="supportPanel" aria-label="Chat de suporte" hidden>
      <header class="support-head"><div><strong>Suporte SEV</strong><small>Assistente de IA para uso do sistema</small></div><button id="closeSupport" type="button" aria-label="Fechar suporte">×</button></header>
      <div class="support-messages" id="supportMessages" role="log" aria-live="polite"></div>
      <div class="support-suggestions" aria-label="Dúvidas sugeridas">
        <button type="button" data-support-question="Como cadastrar produto?">Cadastrar produto</button>
        <button type="button" data-support-question="Onde vejo pagamentos pendentes?">Pagamentos pendentes</button>
        <button type="button" data-support-question="Como editar meu perfil?">Editar perfil</button>
      </div>
      <div class="support-human-contact"><a id="supportHumanContact" class="support-human-link" target="_blank" rel="noopener noreferrer">Falar com atendente</a></div>
      <form class="support-form" id="supportForm"><label class="sr-only" for="supportInput">Digite sua dúvida</label><input id="supportInput" type="text" maxlength="1000" autocomplete="off" placeholder="Digite sua dúvida..."><button type="submit" aria-label="Enviar mensagem">Enviar</button></form>
    </section>`;
  document.body.append(widget);

  const button = document.getElementById('supportButton');
  const panel = document.getElementById('supportPanel');
  const closeButton = document.getElementById('closeSupport');
  const messages = document.getElementById('supportMessages');
  const form = document.getElementById('supportForm');
  const input = document.getElementById('supportInput');
  const submitButton = form.querySelector('button[type="submit"]');
  const humanContact = document.getElementById('supportHumanContact');
  const whatsappNumber = '5581997498046';
  let isSending = false;
  const whatsappUrl = (question, afterAiAttempt = false) => {
    const text = question
      ? afterAiAttempt
        ? `Olá, estou com uma dúvida no sistema SEV que a IA não conseguiu responder: ${question}`
        : `Olá, preciso de ajuda com o sistema SEV: ${question}`
      : 'Olá, preciso de ajuda com o sistema SEV.';
    return `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(text)}`;
  };
  const updateHumanContact = question => {
    humanContact.href = whatsappUrl(question.trim());
  };
  const addMessage = (text, sender, pending = false) => {
    const message = document.createElement('div');
    message.className = `support-message ${sender}${pending ? ' pending' : ''}`;
    const content = document.createElement('p');
    content.textContent = text;
    message.append(content);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
    return message;
  };
  const addHumanContact = question => {
    const action = document.createElement('div');
    action.className = 'support-human-action';
    const link = document.createElement('a');
    link.href = whatsappUrl(question, true);
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Falar com atendente no WhatsApp';
    action.append(link);
    messages.append(action);
    messages.scrollTop = messages.scrollHeight;
  };
  const setSending = value => {
    isSending = value;
    input.disabled = value;
    submitButton.disabled = value;
    submitButton.textContent = value ? 'Enviando...' : 'Enviar';
    document.querySelectorAll('[data-support-question]').forEach(suggestion => {
      suggestion.disabled = value;
    });
  };
  const closePanel = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const ask = async question => {
    const trimmed = question.trim();
    if (!trimmed || isSending) return;
    addMessage(trimmed, 'user');
    input.value = '';
    updateHumanContact('');
    setSending(true);
    const typingMessage = addMessage('Consultando o assistente...', 'assistant', true);
    try {
      if (!window.SevApi?.sendSupportMessage) throw new Error('O chat de suporte não está disponível nesta página.');
      const response = await window.SevApi.sendSupportMessage(trimmed);
      typingMessage.remove();
      addMessage(response.answer, 'assistant');
      if (response.needsHuman) addHumanContact(trimmed);
    } catch (error) {
      typingMessage.remove();
      addMessage(error?.message || 'Não foi possível falar com o assistente. Sua dúvida será encaminhada ao suporte humano.', 'assistant');
      addHumanContact(trimmed);
    } finally {
      setSending(false);
      if (!panel.hidden) input.focus();
    }
  };

  button.addEventListener('click', () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) input.focus();
  });
  closeButton.addEventListener('click', closePanel);
  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
  });
  input.addEventListener('input', () => updateHumanContact(input.value));
  document.querySelectorAll('[data-support-question]').forEach(suggestion => {
    suggestion.addEventListener('click', () => ask(suggestion.dataset.supportQuestion || ''));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  updateHumanContact('');
  addMessage('Olá! Posso orientar sobre como usar o sistema SEV. Não tenho acesso aos dados da sua empresa. Como posso ajudar?', 'assistant');
})();
