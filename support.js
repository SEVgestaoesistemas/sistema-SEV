/* Visual support chat. Responses are local demonstrations until a secure API is connected. */
(() => {
  try {
    if (localStorage.getItem('cerne.session.v1') === 'signed-out') return;
  } catch { /* Continue when browser storage is unavailable. */ }

  const widget = document.createElement('section');
  widget.className = 'support-widget';
  widget.innerHTML = `
    <button class="support-fab" id="supportButton" type="button" aria-label="Abrir suporte" aria-controls="supportPanel" aria-expanded="false">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M20 11.5a7.7 7.7 0 0 1-8 7.5 9 9 0 0 1-3.2-.6L4 20l1.5-4.1A7.2 7.2 0 0 1 4 11.5 7.7 7.7 0 0 1 12 4a7.7 7.7 0 0 1 8 7.5Z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01" stroke-linecap="round" stroke-width="2.7"/></svg>
      <span>Suporte</span>
    </button>
    <section class="support-panel" id="supportPanel" aria-label="Chat de suporte" hidden>
      <header class="support-head"><div><strong>Suporte SEV</strong><small>Assistente demonstrativo</small></div><button id="closeSupport" type="button" aria-label="Fechar suporte">×</button></header>
      <div class="support-messages" id="supportMessages" role="log" aria-live="polite"></div>
      <div class="support-suggestions" aria-label="Dúvidas sugeridas">
        <button type="button" data-support-question="Como cadastrar produto?">Cadastrar produto</button>
        <button type="button" data-support-question="Onde vejo pagamentos pendentes?">Pagamentos pendentes</button>
        <button type="button" data-support-question="Como editar meu perfil?">Editar perfil</button>
      </div>
      <form class="support-form" id="supportForm"><label class="sr-only" for="supportInput">Digite sua dúvida</label><input id="supportInput" type="text" maxlength="500" autocomplete="off" placeholder="Digite sua dúvida..."><button type="submit" aria-label="Enviar mensagem">Enviar</button></form>
    </section>`;
  document.body.append(widget);

  const button = document.getElementById('supportButton');
  const panel = document.getElementById('supportPanel');
  const closeButton = document.getElementById('closeSupport');
  const messages = document.getElementById('supportMessages');
  const form = document.getElementById('supportForm');
  const input = document.getElementById('supportInput');
  const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const addMessage = (text, sender) => {
    const message = document.createElement('div');
    message.className = `support-message ${sender}`;
    const content = document.createElement('p');
    content.textContent = text;
    message.append(content);
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  };
  const getReply = question => {
    const text = normalize(question);
    if (text.includes('produto') || text.includes('estoque')) return 'Acesse Estoque no menu lateral. Em “Cadastrar produto”, informe o nome, a quantidade atual e o estoque mínimo; depois clique em “Adicionar produto”.';
    if (text.includes('pagamento') || text.includes('pendente') || text.includes('receber')) return 'No menu Financeiro, consulte “Clientes com pagamento pendente”. Lá você vê os valores a receber, vencimentos e o status de cada cliente.';
    if (text.includes('perfil') || text.includes('foto') || text.includes('administrador')) return 'Clique no avatar do Administrador. Escolha “Editar perfil” para alterar nome, e-mail ou foto. A opção “Sair” encerra somente a sessão local deste dispositivo.';
    if (text.includes('equipe') || text.includes('usuario') || text.includes('usuário')) return 'Em Equipe, use “Adicionar integrante” para cadastrar nome, e-mail e função. Nesta versão, o cadastro é local e não envia convite por e-mail.';
    if (text.includes('financeiro') || text.includes('receita') || text.includes('despesa')) return 'Em Financeiro, você encontra os indicadores de saldo, receitas e despesas, além de vendas por forma de pagamento e valores pendentes de clientes.';
    return 'Ainda sou uma demonstração de suporte. Posso orientar sobre Estoque, Financeiro, Equipe e Perfil. Quando a integração segura com IA for adicionada, poderei responder dúvidas mais específicas.';
  };
  const closePanel = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const ask = question => {
    const trimmed = question.trim();
    if (!trimmed) return;
    addMessage(trimmed, 'user');
    input.value = '';
    addMessage(getReply(trimmed), 'assistant');
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
  document.querySelectorAll('[data-support-question]').forEach(suggestion => {
    suggestion.addEventListener('click', () => ask(suggestion.dataset.supportQuestion || ''));
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  addMessage('Olá! Sou o suporte da SEV. Como posso ajudar?', 'assistant');
})();
