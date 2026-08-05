/* Shared layout for the static ERP module pages. */
(() => {
  const root = document.getElementById('appRoot');
  if (!root) return;

  const pages = {
    financeiro: {
      title: 'Financeiro',
      subtitle: 'Receitas, despesas e fluxo de caixa',
      content: `
        <section class="module-hero">
          <p class="eyebrow">Visão financeira</p>
          <h1>Controle financeiro</h1>
          <p>Acompanhe receitas, despesas e o saldo consolidado da operação.</p>
        </section>
        <section class="module-grid">
          <article class="module-card"><span>Saldo atual</span><strong>R$ 61.900</strong><small>Receitas menos despesas no período</small></article>
          <article class="module-card"><span>Receitas</span><strong>R$ 128.400</strong><small>Últimos 30 dias</small></article>
          <article class="module-card"><span>Despesas</span><strong id="financeExpenseTotal">R$ 66.500</strong><small id="financeExpenseNote">Últimos 30 dias</small></article>
        </section>
        <section class="invoice-import-panel" aria-labelledby="invoiceImportTitle">
          <div class="settings-panel-head invoice-panel-head"><div><h2 id="invoiceImportTitle">Importar nota fiscal de despesa</h2><p>Envie a NF-e ou DANFE para preparar um lançamento em despesas.</p></div><span class="demo-label">Protótipo demonstrativo</span></div>
          <div class="invoice-import-layout">
            <div class="invoice-dropzone" id="invoiceDropzone" role="button" tabindex="0" aria-controls="expenseInvoiceFile" aria-describedby="invoiceUploadHelp">
              <span class="invoice-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></span>
              <strong>Arraste o arquivo ou selecione do computador</strong>
              <small id="invoiceUploadHelp">Aceita PDF ou XML, com até 10 MB.</small>
              <button class="secondary-button" id="invoiceBrowseButton" type="button">Selecionar arquivo</button>
              <input class="sr-only" id="expenseInvoiceFile" type="file" accept=".pdf,.xml,application/pdf,application/xml,text/xml">
            </div>
            <div class="invoice-file-card" id="invoiceFileCard" hidden>
              <span class="invoice-file-icon" aria-hidden="true">NF</span>
              <div><strong id="invoiceFileName"></strong><small id="invoiceFileMeta"></small></div>
              <button class="text-button invoice-remove-file" id="invoiceRemoveFile" type="button">Remover</button>
            </div>
          </div>
          <div class="invoice-import-actions"><p id="invoiceStatus" role="status" aria-live="polite">A leitura é demonstrativa. Ao confirmar, a despesa será salva na API.</p><button class="primary-button" id="invoiceAnalyzeButton" type="button" disabled>Analisar nota</button></div>
          <section class="invoice-review" id="invoiceReview" aria-labelledby="invoiceReviewTitle" hidden>
            <div class="invoice-review-head"><div><span class="invoice-review-kicker">Dados sugeridos pela leitura</span><h3 id="invoiceReviewTitle">Confira antes de adicionar a despesa</h3><p id="invoiceReviewFile"></p></div><span class="review-badge">Leitura demonstrativa</span></div>
            <form id="invoiceReviewForm">
              <div class="invoice-fields">
                <label class="field"><span>Fornecedor</span><input name="supplier" type="text" minlength="3" maxlength="100" required></label>
                <label class="field"><span>CNPJ</span><input name="supplierCnpj" type="text" maxlength="18" placeholder="00.000.000/0000-00" inputmode="numeric"></label>
                <label class="field"><span>Número da nota</span><input name="documentNumber" type="text" maxlength="40" required></label>
                <label class="field"><span>Data de emissão</span><input name="issueDate" type="date" required></label>
                <label class="field"><span>Categoria</span><select name="category"><option value="Fornecedores">Fornecedores</option><option value="Serviços">Serviços</option><option value="Impostos">Impostos</option><option value="Operacional">Operacional</option><option value="Outros">Outros</option></select></label>
                <label class="field"><span>Vencimento</span><input name="dueDate" type="date" required></label>
                <label class="field"><span>Valor total</span><input name="amount" type="text" inputmode="decimal" placeholder="0,00" required></label>
                <label class="field"><span>Descrição</span><input name="description" type="text" maxlength="140" required></label>
              </div>
              <div class="invoice-review-actions"><button class="secondary-button" id="invoiceCancelReview" type="button">Cancelar</button><button class="primary-button" type="submit">Adicionar às despesas</button></div>
            </form>
          </section>
        </section>
        <section class="imported-expenses-panel" aria-labelledby="importedExpensesTitle">
          <div class="settings-panel-head invoice-panel-head"><div><h2 id="importedExpensesTitle">Despesas registradas</h2><p id="importedExpensesSummary">Carregando despesas da empresa…</p></div><span class="local-label">Sincronizado com a API</span></div>
          <div class="table-wrap"><table class="imported-expenses-table"><thead><tr><th>Fornecedor</th><th>Nota fiscal</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody id="importedExpensesBody"></tbody></table></div>
        </section>
        <section class="payment-panel" aria-labelledby="paymentTitle">
          <div class="settings-panel-head"><div><h2 id="paymentTitle">Vendas por pagamento</h2><p>Distribuição das vendas no período selecionado.</p></div><span class="demo-label">Dados demonstrativos</span></div>
          <div class="payment-chart-layout">
            <div class="payment-donut" role="img" aria-label="Vendas por pagamento: Pix 50%, Cartão 42%, Boleto 7% e Outros 1%.">
              <div class="payment-center"><span id="paymentMethod">Pix</span><strong id="paymentAmount">R$ 3.475</strong><small id="paymentPercent">50% das vendas</small></div>
            </div>
            <div class="payment-legend" aria-label="Métodos de pagamento">
              <button class="payment-legend-item active" type="button" data-payment="pix" aria-pressed="true"><span class="payment-dot pix"></span><span>Pix</span><strong>50%</strong></button>
              <button class="payment-legend-item" type="button" data-payment="card" aria-pressed="false"><span class="payment-dot card"></span><span>Cartão</span><strong>42%</strong></button>
              <button class="payment-legend-item" type="button" data-payment="boleto" aria-pressed="false"><span class="payment-dot boleto"></span><span>Boleto</span><strong>7%</strong></button>
              <button class="payment-legend-item" type="button" data-payment="other" aria-pressed="false"><span class="payment-dot other"></span><span>Outros</span><strong>1%</strong></button>
            </div>
          </div>
        </section>
        <section class="pending-panel" aria-labelledby="pendingPaymentsTitle">
          <div class="settings-panel-head"><div><h2 id="pendingPaymentsTitle">Clientes com pagamento pendente</h2><p>Vendas aguardando o recebimento do cliente.</p></div><span class="demo-label">Dados demonstrativos</span></div>
          <div class="pending-total"><span>Total a receber</span><strong>R$ 8.730</strong><small>3 clientes com pagamento em aberto</small></div>
          <section class="pending-chart" aria-label="Gráfico de valores pendentes por cliente">
            <div class="pending-chart-head"><strong>Valores por cliente</strong><span>Valor a receber</span></div>
            <div class="pending-chart-row"><span>Mariana</span><div class="pending-chart-track"><span class="pending-chart-bar supplier" style="--bar-size:100%"></span></div><strong>R$ 4.250</strong></div>
            <div class="pending-chart-row"><span>Lucas</span><div class="pending-chart-track"><span class="pending-chart-bar freight" style="--bar-size:40%"></span></div><strong>R$ 1.680</strong></div>
            <div class="pending-chart-row"><span>Ana</span><div class="pending-chart-track"><span class="pending-chart-bar marketing" style="--bar-size:66%"></span></div><strong>R$ 2.800</strong></div>
          </section>
          <div class="table-wrap"><table class="pending-table"><thead><tr><th>Cliente</th><th>Vencimento</th><th>Valor</th><th>Status</th></tr></thead><tbody><tr><td><strong>Mariana Costa</strong><small>Pedido #1042</small></td><td>30/07/2026</td><td>R$ 4.250</td><td><span class="badge out">Atrasado</span></td></tr><tr><td><strong>Lucas Mendes</strong><small>Pedido #1045</small></td><td>31/07/2026</td><td>R$ 1.680</td><td><span class="badge low">A vencer</span></td></tr><tr><td><strong>Ana Ribeiro</strong><small>Pedido #1049</small></td><td>05/08/2026</td><td>R$ 2.800</td><td><span class="badge ok">Agendado</span></td></tr></tbody></table></div>
        </section>`
    },
    vendas: {
      title: 'Vendas',
      subtitle: 'Pedidos, clientes e ticket médio',
      content: `
        <section class="module-hero"><p class="eyebrow">Operação comercial</p><h1>Vendas</h1><p>Consulte pedidos, desempenho comercial e indicadores de clientes.</p></section>
        <section class="module-grid"><article class="module-card"><span>Pedidos no mês</span><strong>320</strong><small>8,1% acima do período anterior</small></article><article class="module-card"><span>Ticket médio</span><strong>R$ 401,25</strong><small>Por pedido concluído</small></article><article class="module-card"><span>Status</span><strong>Em preparação</strong><small>Lista de pedidos será conectada à API</small></article></section>`
    },
    estoque: {
      title: 'Estoque',
      subtitle: 'Produtos, quantidades e alertas',
      content: `
        <section class="module-hero"><p class="eyebrow">Catálogo e inventário</p><h1>Estoque</h1><p>Cadastre produtos e acompanhe níveis mínimos para reposição.</p></section>
        <section class="module-grid stock-summary-grid"><article class="module-card"><span>Produtos cadastrados</span><strong id="stockProductCount">0</strong><small>Itens diferentes no catálogo</small></article><article class="module-card"><span>Estoque baixo</span><strong id="stockLowCount">0</strong><small>Produtos que exigem reposição</small></article><article class="module-card"><span>Esgotados</span><strong id="stockOutCount">0</strong><small>Produtos sem unidades disponíveis</small></article></section>
        <section class="stock-panel" aria-labelledby="addProductTitle"><div class="settings-panel-head"><div><h2 id="addProductTitle">Cadastrar produto</h2><p>O cadastro é salvo com segurança no estoque da sua empresa.</p></div></div><form class="stock-form" id="stockForm"><label class="field"><span>Nome do produto</span><input name="productName" type="text" minlength="3" maxlength="100" required></label><label class="field"><span>Quantidade atual</span><input name="productQuantity" type="number" min="0" max="1000000" step="1" required inputmode="numeric"></label><label class="field"><span>Estoque mínimo</span><input name="productMinimum" type="number" min="0" max="1000000" step="1" required inputmode="numeric"></label><button class="primary-button" type="submit">Adicionar produto</button></form><p class="stock-status" id="stockStatus" role="status" aria-live="polite"></p></section>
        <section class="stock-panel" aria-labelledby="catalogTitle"><div class="stock-toolbar"><div><h2 id="catalogTitle">Produtos cadastrados</h2><p id="stockListSummary">0 produtos no catálogo</p></div><div class="stock-toolbar-controls"><label class="stock-search"><span class="sr-only">Buscar produto</span><input id="stockSearch" type="search" placeholder="Buscar produto"></label><div class="tabs" aria-label="Filtros de estoque"><button class="tab active" type="button" data-stock-filter="all" aria-pressed="true">Todos</button><button class="tab" type="button" data-stock-filter="critical" aria-pressed="false">Críticos</button></div></div></div><div class="table-wrap"><table class="stock-table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Mínimo</th><th>Status</th></tr></thead><tbody id="stockTableBody"></tbody></table></div></section>`
    },
    relatorios: {
      title: 'Relatórios',
      subtitle: 'Exportações e análises detalhadas',
      content: `
        <section class="module-hero"><p class="eyebrow">Análises</p><h1>Relatórios</h1><p>Centralize indicadores e prepare exportações para acompanhamento do negócio.</p></section>
        <section class="module-grid"><article class="module-card"><span>Relatórios disponíveis</span><strong>3</strong><small>Financeiro, vendas e estoque</small></article><article class="module-card"><span>Última atualização</span><strong>Hoje, 09:40</strong><small>Dados demonstrativos</small></article><article class="module-card"><span>Exportações</span><strong>Em breve</strong><small>CSV e PDF serão adicionados aqui</small></article></section>`
    },
    equipe: {
      title: 'Equipe',
      subtitle: 'Usuários e permissões de acesso',
      content: `
        <section class="module-hero"><p class="eyebrow">Acessos</p><h1>Equipe</h1><p>Cadastre integrantes e defina a função inicial de cada pessoa.</p></section>
        <section class="team-panel" aria-labelledby="addMemberTitle">
          <div class="settings-panel-head"><div><h2 id="addMemberTitle">Adicionar integrante</h2><p>O cadastro é local e não envia convite por e-mail.</p></div></div>
          <form class="team-form" id="teamForm">
            <label class="field"><span>Nome completo</span><input name="memberName" type="text" minlength="3" maxlength="80" required autocomplete="name"></label>
            <label class="field"><span>E-mail</span><input name="memberEmail" type="email" maxlength="120" required autocomplete="email"></label>
            <label class="field"><span>Função</span><select name="memberRole"><option value="admin">Administrador</option><option value="manager">Gerente</option><option value="operator">Operacional</option></select></label>
            <button class="primary-button" type="submit">Adicionar integrante</button>
          </form>
          <p class="team-status" id="teamStatus" role="status" aria-live="polite"></p>
        </section>
        <section class="team-panel" aria-labelledby="teamListTitle">
          <div class="settings-panel-head"><div><h2 id="teamListTitle">Integrantes cadastrados</h2><p id="teamCount">0 integrantes ativos</p></div></div>
          <div class="table-wrap"><table class="team-table"><thead><tr><th>Integrante</th><th>Função</th><th>Status</th></tr></thead><tbody id="teamTableBody"></tbody></table></div>
        </section>`
    },
    configuracoes: {
      title: 'Configurações',
      subtitle: 'Preferências gerais do sistema',
      content: `
        <section class="module-hero"><p class="eyebrow">Preferências</p><h1>Configurações</h1><p>Defina as preferências gerais usadas neste dispositivo.</p></section>
        <form class="settings-form" id="settingsForm">
          <section class="settings-panel" aria-labelledby="businessSettingsTitle">
            <div class="settings-panel-head"><div><h2 id="businessSettingsTitle">Empresa</h2><p>Informações exibidas no sistema.</p></div></div>
            <div class="settings-fields">
              <label class="field"><span>Nome da empresa</span><input name="companyName" type="text" maxlength="80" required autocomplete="organization"></label>
              <label class="field"><span>Nome curto</span><input name="companyShortName" type="text" maxlength="30" required></label>
            </div>
          </section>
          <section class="settings-panel" aria-labelledby="regionalSettingsTitle">
            <div class="settings-panel-head"><div><h2 id="regionalSettingsTitle">Região e formato</h2><p>Preferências de idioma, moeda e fuso horário.</p></div></div>
            <div class="settings-fields settings-fields-three">
              <label class="field"><span>Idioma</span><select name="language"><option value="pt-BR">Português (Brasil)</option></select></label>
              <label class="field"><span>Moeda</span><select name="currency"><option value="BRL">Real brasileiro (R$)</option></select></label>
              <label class="field"><span>Fuso horário</span><select name="timezone"><option value="America/Sao_Paulo">Brasília (GMT−3)</option></select></label>
            </div>
          </section>
          <section class="settings-panel" aria-labelledby="notificationSettingsTitle">
            <div class="settings-panel-head"><div><h2 id="notificationSettingsTitle">Alertas</h2><p>Escolha quais avisos deseja receber.</p></div></div>
            <label class="setting-toggle"><input name="criticalStockAlerts" type="checkbox"><span class="toggle-control" aria-hidden="true"></span><span><strong>Alertas de estoque crítico</strong><small>Avise quando um produto atingir estoque baixo ou ficar esgotado.</small></span></label>
          </section>
          <div class="settings-actions"><p class="settings-status" id="settingsStatus" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Salvar alterações</button></div>
        </form>`
    },
    plataforma: {
      title: 'Administração da plataforma',
      subtitle: 'Empresas, planos e acessos de clientes',
      content: `
        <section class="module-hero platform-hero">
          <p class="eyebrow">SEV Gestão &amp; Sistemas</p>
          <h1>Empresas e assinaturas</h1>
          <p>Crie o acesso inicial de cada cliente, defina a validade manualmente e acompanhe a situação de pagamento.</p>
        </section>
        <section class="platform-grid">
          <section class="settings-panel" aria-labelledby="platformCompanyFormTitle">
            <div class="settings-panel-head"><div><h2 id="platformCompanyFormTitle">Nova empresa</h2><p>O responsável recebe uma senha temporária e precisará trocá-la no primeiro acesso.</p></div></div>
            <form class="platform-company-form" id="platformCompanyForm">
              <label class="field"><span>Nome da empresa</span><input name="companyName" type="text" minlength="2" maxlength="100" autocomplete="organization" required></label>
              <label class="field"><span>Nome do responsável</span><input name="administratorName" type="text" minlength="3" maxlength="100" autocomplete="name" required></label>
              <label class="field"><span>E-mail do responsável</span><input name="administratorEmail" type="email" maxlength="160" autocomplete="email" required></label>
              <label class="field"><span>Validade do plano</span><input name="planExpiresAt" type="date" required></label>
              <div class="platform-form-actions"><p class="settings-status" id="platformCompanyStatus" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Criar empresa</button></div>
            </form>
          </section>
          <aside class="temporary-access-card" id="temporaryAccessCard" hidden aria-live="polite">
            <span class="temporary-access-kicker">Acesso temporário criado</span>
            <h2 id="temporaryAccessName">Responsável</h2>
            <p id="temporaryAccessEmail"></p>
            <label>Senha temporária<input id="temporaryAccessPassword" type="text" readonly></label>
            <button class="secondary-button" id="copyTemporaryPassword" type="button">Copiar senha</button>
            <small>Entregue esta senha ao cliente por um canal seguro. Ela não poderá ser consultada novamente.</small>
          </aside>
        </section>
        <section class="settings-panel platform-list-panel" aria-labelledby="platformCompaniesTitle">
          <div class="settings-panel-head"><div><h2 id="platformCompaniesTitle">Empresas cadastradas</h2><p id="platformCompaniesSummary">Carregando empresas…</p></div><button class="secondary-button" id="refreshPlatformCompanies" type="button">Atualizar lista</button></div>
          <div class="platform-list-tools"><label class="stock-search platform-search"><span class="sr-only">Buscar empresa ou responsável</span><input id="platformCompanySearch" type="search" placeholder="Buscar empresa, responsável ou e-mail"></label></div>
          <div class="table-wrap"><table class="platform-companies-table"><thead><tr><th>Empresa</th><th>Responsável</th><th>Validade do plano</th><th>Status</th><th>Atualizar validade</th><th>Ações</th></tr></thead><tbody id="platformCompaniesBody"></tbody></table></div>
        </section>
        <div class="profile-modal" id="platformAdministratorModal" role="dialog" aria-modal="true" aria-labelledby="platformAdministratorModalTitle" hidden>
          <div class="profile-modal-card">
            <div class="profile-modal-head"><div><h2 id="platformAdministratorModalTitle">Editar responsável</h2><p id="platformAdministratorModalCompany"></p></div><button class="modal-close" id="closePlatformAdministratorModal" type="button" aria-label="Fechar">×</button></div>
            <form id="platformAdministratorForm">
              <label class="field"><span>Nome do responsável</span><input name="administratorName" type="text" minlength="3" maxlength="100" autocomplete="name" required></label>
              <label class="field"><span>E-mail do responsável</span><input name="administratorEmail" type="email" maxlength="160" autocomplete="email" required></label>
              <div class="profile-modal-actions"><p id="platformAdministratorStatus" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Salvar responsável</button></div>
            </form>
          </div>
        </div>`
    }
  };

  const pageId = document.body.dataset.page;
  const page = pages[pageId];
  if (!page) return;

  const navigation = [
    ['index.html', 'Painel', 'painel'],
    ['financeiro.html', 'Financeiro', 'financeiro'],
    ['vendas.html', 'Vendas', 'vendas'],
    ['estoque.html', 'Estoque', 'estoque'],
    ['relatorios.html', 'Relatórios', 'relatorios'],
    ['equipe.html', 'Equipe', 'equipe'],
    ['configuracoes.html', 'Configurações', 'configuracoes']
  ];

  const navLink = ([href, label, id]) => `<a class="nav-item${id === pageId ? ' active' : ''}" href="${href}"${id === pageId ? ' aria-current="page"' : ''}>${label}</a>`;

  root.innerHTML = `
    <div class="sidebar-overlay" id="overlay"></div>
    <div class="app">
      <aside class="sidebar" id="sidebar" aria-label="Navegação principal">
        <div class="brand"><img class="brand-logo" src="assets/sev-logo.jpeg" alt="SEV Gestão &amp; Sistemas"></div>
        <div class="nav-label">Geral</div><nav class="nav">${navigation.slice(0, 5).map(navLink).join('')}</nav>
        <div class="nav-label">Sistema</div><nav class="nav">${navigation.slice(5).map(navLink).join('')}</nav>
        <button class="sidebar-footer sidebar-profile" type="button" data-profile-trigger aria-label="Abrir menu do perfil"><div class="avatar-sm" data-profile-avatar>JM</div><div><div class="who" data-profile-name>João Marcos</div><div class="role" data-profile-role>Administrador</div></div></button>
      </aside>
      <div class="main">
        <header class="topbar">
          <button class="menu-toggle" id="menuToggle" type="button" aria-label="Abrir menu" aria-controls="sidebar" aria-expanded="false">☰</button>
          <div><div class="page-title">${page.title}</div><div class="page-sub">${page.subtitle}</div></div>
          <div class="topbar-actions">
            <div class="notification-wrap">
              <button class="icon-btn" id="notificationButton" type="button" aria-label="Notificações" aria-haspopup="dialog" aria-controls="notificationPanel" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z"/><path d="M10 21h4"/></svg><span class="dot" id="notificationDot"></span></button>
              <section class="notification-panel" id="notificationPanel" aria-label="Notificações" hidden><div class="notification-head"><div><strong>Notificações</strong><span id="notificationSummary"></span></div><button class="text-button" id="markNotificationsRead" type="button">Marcar todas como lidas</button></div><ul class="notification-list" id="notificationList"></ul></section>
            </div>
            <button class="avatar profile-trigger" type="button" data-profile-trigger aria-label="Abrir menu do perfil" data-profile-avatar>JM</button>
          </div>
        </header>
        <main class="content module-content">${page.content}</main>
      </div>
    </div>`;

  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const menuToggle = document.getElementById('menuToggle');
  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };

  menuToggle.addEventListener('click', () => {
    const willOpen = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', willOpen);
    overlay.classList.toggle('open', willOpen);
    menuToggle.setAttribute('aria-expanded', String(willOpen));
  });
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeMenu();
  });

  if (pageId === 'configuracoes') {
    const settingsForm = document.getElementById('settingsForm');
    const settingsStatus = document.getElementById('settingsStatus');
    const storageKey = 'cerne.settings.v1';
    const defaults = {
      companyName: 'SEV Gestão & Sistemas',
      companyShortName: 'SEV',
      language: 'pt-BR',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      criticalStockAlerts: true
    };

    const readSettings = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey));
        if (!stored || typeof stored !== 'object') return defaults;
        const settings = { ...defaults, ...stored };
        if (settings.companyName === 'Cerne') settings.companyName = defaults.companyName;
        if (settings.companyShortName === 'Cerne') settings.companyShortName = defaults.companyShortName;
        return settings;
      } catch {
        return defaults;
      }
    };

    const settings = readSettings();
    Object.entries(settings).forEach(([name, value]) => {
      const input = settingsForm.elements.namedItem(name);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    });

    settingsForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!settingsForm.reportValidity()) return;

      const updatedSettings = {
        companyName: settingsForm.elements.companyName.value.trim(),
        companyShortName: settingsForm.elements.companyShortName.value.trim(),
        language: settingsForm.elements.language.value,
        currency: settingsForm.elements.currency.value,
        timezone: settingsForm.elements.timezone.value,
        criticalStockAlerts: settingsForm.elements.criticalStockAlerts.checked
      };

      try {
        localStorage.setItem(storageKey, JSON.stringify(updatedSettings));
        settingsStatus.textContent = 'Configurações salvas neste dispositivo.';
      } catch {
        settingsStatus.textContent = 'Não foi possível salvar as configurações neste navegador.';
      }
    });
  }

  if (pageId === 'financeiro') {
    const paymentData = {
      pix: { label: 'Pix', amount: 'R$ 3.475', percent: '50%' },
      card: { label: 'Cartão', amount: 'R$ 2.919', percent: '42%' },
      boleto: { label: 'Boleto', amount: 'R$ 486', percent: '7%' },
      other: { label: 'Outros', amount: 'R$ 70', percent: '1%' }
    };
    const paymentMethod = document.getElementById('paymentMethod');
    const paymentAmount = document.getElementById('paymentAmount');
    const paymentPercent = document.getElementById('paymentPercent');
    const paymentButtons = document.querySelectorAll('[data-payment]');
    paymentButtons.forEach(button => {
      button.addEventListener('click', () => {
        const payment = paymentData[button.dataset.payment];
        if (!payment) return;
        paymentMethod.textContent = payment.label;
        paymentAmount.textContent = payment.amount;
        paymentPercent.textContent = `${payment.percent} das vendas`;
        paymentButtons.forEach(item => {
          const isSelected = item === button;
          item.classList.toggle('active', isSelected);
          item.setAttribute('aria-pressed', String(isSelected));
        });
      });
    });

  }

  if (pageId === 'estoque') {
    const stockForm = document.getElementById('stockForm');
    const stockStatus = document.getElementById('stockStatus');
    const stockSearch = document.getElementById('stockSearch');
    const stockTableBody = document.getElementById('stockTableBody');
    const stockProductCount = document.getElementById('stockProductCount');
    const stockLowCount = document.getElementById('stockLowCount');
    const stockOutCount = document.getElementById('stockOutCount');
    const stockListSummary = document.getElementById('stockListSummary');
    const stockFilterButtons = document.querySelectorAll('[data-stock-filter]');
    const submitButton = stockForm.querySelector('button[type="submit"]');
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    let products = [];
    let activeFilter = 'all';
    const productStatus = product => product.quantity === 0 ? 'out' : product.quantity <= product.minimumQuantity ? 'low' : 'ok';
    const statusLabel = status => ({ ok: 'Em estoque', low: 'Estoque baixo', out: 'Esgotado' })[status];
    const showStockStatus = (message, isError = false) => {
      stockStatus.textContent = message;
      stockStatus.classList.toggle('error', isError);
    };
    const renderStock = () => {
      const lowCount = products.filter(product => productStatus(product) === 'low').length;
      const outCount = products.filter(product => productStatus(product) === 'out').length;
      const query = stockSearch.value.trim().toLocaleLowerCase('pt-BR');
      const visibleProducts = products.filter(product => {
        const status = productStatus(product);
        const matchesFilter = activeFilter === 'all' || (activeFilter === 'critical' && status !== 'ok');
        return matchesFilter && product.name.toLocaleLowerCase('pt-BR').includes(query);
      });
      stockProductCount.textContent = String(products.length);
      stockLowCount.textContent = String(lowCount);
      stockOutCount.textContent = String(outCount);
      stockListSummary.textContent = `${visibleProducts.length} produto${visibleProducts.length === 1 ? '' : 's'} exibido${visibleProducts.length === 1 ? '' : 's'}`;
      stockTableBody.innerHTML = visibleProducts.length ? visibleProducts.map(product => {
        const status = productStatus(product);
        return `<tr><td><div class="prod-cell"><span class="prod-swatch stock-${status}"></span>${escapeHtml(product.name)}</div></td><td>${product.quantity}</td><td>${product.minimumQuantity}</td><td><span class="badge ${status}">${statusLabel(status)}</span></td></tr>`;
      }).join('') : '<tr><td class="empty-table" colspan="4">Nenhum produto encontrado.</td></tr>';
    };
    const setSubmitting = submitting => {
      submitButton.disabled = submitting;
      submitButton.textContent = submitting ? 'Salvando…' : 'Adicionar produto';
    };
    const loadProducts = async () => {
      showStockStatus('Carregando produtos…');
      try {
        const user = await window.SevAuth.ready;
        if (!user) return;
        products = await window.SevApi.getProducts();
        renderStock();
        showStockStatus('');
      } catch (error) {
        showStockStatus(error.message || 'Não foi possível carregar o estoque.', true);
      }
    };

    const requestedSearch = new URLSearchParams(window.location.search).get('search');
    if (requestedSearch) stockSearch.value = requestedSearch;
    renderStock();
    loadProducts();

    stockForm.addEventListener('submit', async event => {
      event.preventDefault();
      if (!stockForm.reportValidity()) return;
      const name = stockForm.elements.productName.value.trim();
      const quantity = Number(stockForm.elements.productQuantity.value);
      const minimumQuantity = Number(stockForm.elements.productMinimum.value);
      if (name.length < 3 || !Number.isSafeInteger(quantity) || !Number.isSafeInteger(minimumQuantity) || quantity < 0 || minimumQuantity < 0) {
        showStockStatus('Revise os dados do produto antes de salvar.', true);
        return;
      }
      if (products.some(product => product.name.localeCompare(name, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
        showStockStatus('Já existe um produto cadastrado com este nome.', true);
        stockForm.elements.productName.focus();
        return;
      }

      setSubmitting(true);
      showStockStatus('');
      try {
        const product = await window.SevApi.createProduct({ name, quantity, minimumQuantity });
        products = [...products, product].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
        window.dispatchEvent(new CustomEvent('sev:notifications-changed'));
        renderStock();
        stockForm.reset();
        showStockStatus('Produto cadastrado no estoque da empresa.');
        stockForm.elements.productName.focus();
      } catch (error) {
        showStockStatus(error.message || 'Não foi possível cadastrar o produto.', true);
      } finally {
        setSubmitting(false);
      }
    });
    stockSearch.addEventListener('input', renderStock);
    stockFilterButtons.forEach(button => {
      button.addEventListener('click', () => {
        activeFilter = button.dataset.stockFilter;
        stockFilterButtons.forEach(item => {
          const isActive = item === button;
          item.classList.toggle('active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });
        renderStock();
      });
    });
  }

  if (pageId === 'equipe') {
    const teamForm = document.getElementById('teamForm');
    const teamStatus = document.getElementById('teamStatus');
    const teamTableBody = document.getElementById('teamTableBody');
    const teamCount = document.getElementById('teamCount');
    const storageKey = 'cerne.team.v1';
    const roleLabels = { admin: 'Administrador', manager: 'Gerente', operator: 'Operacional' };
    const defaultTeam = [{
      id: 'joao-marcos',
      name: 'João Marcos',
      email: 'joao.marcos@sev.local',
      role: 'admin'
    }];
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    const readTeam = () => {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey));
        if (!Array.isArray(stored)) return defaultTeam;
        return stored.filter(member =>
          member && typeof member.name === 'string' && typeof member.email === 'string' && roleLabels[member.role]
        );
      } catch {
        return defaultTeam;
      }
    };
    let team = readTeam();
    if (!team.length) team = defaultTeam;
    const showTeamStatus = (message, isError = false) => {
      teamStatus.textContent = message;
      teamStatus.classList.toggle('error', isError);
    };

    const renderTeam = () => {
      teamCount.textContent = `${team.length} integrante${team.length === 1 ? '' : 's'} ativo${team.length === 1 ? '' : 's'}`;
      teamTableBody.innerHTML = team.map(member => `
        <tr>
          <td><div class="member-cell"><span class="member-initials" aria-hidden="true">${escapeHtml(member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())}</span><span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}</small></span></div></td>
          <td>${escapeHtml(roleLabels[member.role])}</td>
          <td><span class="badge ok">Ativo</span></td>
        </tr>`).join('');
    };

    renderTeam();
    teamForm.addEventListener('submit', event => {
      event.preventDefault();
      if (!teamForm.reportValidity()) return;

      const name = teamForm.elements.memberName.value.trim();
      const email = teamForm.elements.memberEmail.value.trim().toLowerCase();
      const role = teamForm.elements.memberRole.value;
      if (name.length < 3) {
        showTeamStatus('Informe um nome com pelo menos 3 caracteres.', true);
        teamForm.elements.memberName.focus();
        return;
      }
      if (team.some(member => member.email.toLowerCase() === email)) {
        showTeamStatus('Já existe um integrante cadastrado com este e-mail.', true);
        teamForm.elements.memberEmail.focus();
        return;
      }

      const newMember = { id: `${Date.now()}-${email}`, name, email, role };
      const updatedTeam = [...team, newMember];
      try {
        localStorage.setItem(storageKey, JSON.stringify(updatedTeam));
        team = updatedTeam;
        renderTeam();
        teamForm.reset();
        showTeamStatus('Integrante adicionado ao cadastro local.');
        teamForm.elements.memberName.focus();
      } catch {
        showTeamStatus('Não foi possível salvar a equipe neste navegador.', true);
      }
    });
  }
})();
