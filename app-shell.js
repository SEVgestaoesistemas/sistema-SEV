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
          <div class="settings-panel-head invoice-panel-head"><div><h2 id="invoiceImportTitle">Importar XML de NF-e</h2><p>Envie o XML da NF-e para extrair os dados antes de registrar uma despesa.</p></div><span class="local-label">Leitura real de XML</span></div>
          <div class="invoice-import-layout">
            <div class="invoice-dropzone" id="invoiceDropzone" role="button" tabindex="0" aria-controls="expenseInvoiceFile" aria-describedby="invoiceUploadHelp">
              <span class="invoice-upload-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/></svg></span>
              <strong>Arraste o arquivo ou selecione do computador</strong>
              <small id="invoiceUploadHelp">Aceita XML de NF-e, com até 1,5 MB.</small>
              <button class="secondary-button" id="invoiceBrowseButton" type="button">Selecionar arquivo</button>
              <input class="sr-only" id="expenseInvoiceFile" type="file" accept=".xml,application/xml,text/xml">
            </div>
            <div class="invoice-file-card" id="invoiceFileCard" hidden>
              <span class="invoice-file-icon" aria-hidden="true">NF</span>
              <div><strong id="invoiceFileName"></strong><small id="invoiceFileMeta"></small></div>
              <button class="text-button invoice-remove-file" id="invoiceRemoveFile" type="button">Remover</button>
            </div>
          </div>
          <div class="invoice-import-actions"><p id="invoiceStatus" role="status" aria-live="polite">O XML será lido pela API. A despesa só será salva após sua confirmação.</p><button class="primary-button" id="invoiceAnalyzeButton" type="button" disabled>Ler XML</button></div>
          <section class="invoice-review" id="invoiceReview" aria-labelledby="invoiceReviewTitle" hidden>
            <div class="invoice-review-head"><div><span class="invoice-review-kicker">Dados extraídos do XML</span><h3 id="invoiceReviewTitle">Confira antes de adicionar a despesa</h3><p id="invoiceReviewFile"></p></div><span class="review-badge">Confirmação obrigatória</span></div>
            <form id="invoiceReviewForm">
              <div class="invoice-fields">
                <label class="field"><span>Fornecedor</span><input name="supplier" type="text" minlength="3" maxlength="100" required></label>
                <label class="field"><span>CNPJ</span><input name="supplierCnpj" type="text" maxlength="18" placeholder="00.000.000/0000-00" inputmode="numeric"></label>
                <label class="field"><span>Número da nota</span><input name="documentNumber" type="text" maxlength="40" required></label>
                <label class="field"><span>Chave de acesso <small>Opcional</small></span><input name="documentKey" type="text" maxlength="44" inputmode="numeric" placeholder="44 dígitos"></label>
                <label class="field"><span>Data de emissão</span><input name="issueDate" type="date" required></label>
                <label class="field"><span>Categoria</span><select name="category"><option value="Fornecedores">Fornecedores</option><option value="Serviços">Serviços</option><option value="Impostos">Impostos</option><option value="Operacional">Operacional</option><option value="Outros">Outros</option></select></label>
                <label class="field"><span>Vencimento</span><input name="dueDate" type="date" required></label>
                <label class="field"><span>Valor total</span><input name="amount" type="text" inputmode="decimal" placeholder="0,00" required></label>
                <label class="field"><span>Descrição</span><input name="description" type="text" maxlength="140" required></label>
              </div>
              <section class="invoice-items-review" id="invoiceItemsReview" aria-labelledby="invoiceItemsTitle" hidden>
                <div class="invoice-items-head"><div><h4 id="invoiceItemsTitle">Itens identificados</h4><p id="invoiceItemsSummary"></p></div></div>
                <div class="table-wrap"><table><thead><tr><th>Produto</th><th>Qtd.</th><th>Un.</th><th>Valor</th></tr></thead><tbody id="invoiceItemsBody"></tbody></table></div>
              </section>
              <div class="invoice-review-actions"><button class="secondary-button" id="invoiceCancelReview" type="button">Cancelar</button><button class="primary-button" type="submit">Adicionar às despesas</button></div>
            </form>
          </section>
        </section>
        <section class="imported-expenses-panel" aria-labelledby="importedExpensesTitle">
          <div class="settings-panel-head invoice-panel-head"><div><h2 id="importedExpensesTitle">Despesas registradas</h2><p id="importedExpensesSummary">Carregando despesas da empresa…</p></div><span class="local-label">Sincronizado com a API</span></div>
          <div class="table-wrap"><table class="imported-expenses-table"><thead><tr><th>Fornecedor</th><th>Nota fiscal</th><th>Categoria</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody id="importedExpensesBody"></tbody></table></div>
        </section>
        <section class="payment-panel" aria-labelledby="paymentTitle">
          <div class="settings-panel-head"><div><h2 id="paymentTitle">Vendas por pagamento</h2><p>Distribuição das vendas registradas pela sua empresa.</p></div><span class="local-label">Sincronizado com a API</span></div>
          <div class="payment-chart-layout">
            <div class="payment-donut" id="paymentDonut" role="img" aria-label="Carregando distribuição das vendas por pagamento.">
              <div class="payment-center"><span id="paymentMethod">Carregando</span><strong id="paymentAmount">R$ 0,00</strong><small id="paymentPercent">Aguarde um instante</small></div>
            </div>
            <div class="payment-legend" id="paymentLegend" aria-label="Métodos de pagamento"></div>
          </div>
          <p class="payment-status" id="paymentStatus" role="status" aria-live="polite"></p>
        </section>
        <section class="pending-panel" aria-labelledby="pendingPaymentsTitle">
          <div class="settings-panel-head"><div><h2 id="pendingPaymentsTitle">Contas a receber</h2><p>Vendas a prazo aguardando o recebimento do cliente.</p></div><span class="local-label">Sincronizado com a API</span></div>
          <div class="pending-total"><span>Total a receber</span><strong id="receivableTotal">R$ 0,00</strong><small id="receivableSummary">Carregando contas da empresa…</small></div>
          <section class="pending-chart" aria-label="Gráfico de valores pendentes por cliente">
            <div class="pending-chart-head"><strong>Valores por cliente</strong><span>Valor a receber</span></div>
            <div id="receivableChart" aria-live="polite"></div>
          </section>
          <div class="table-wrap"><table class="pending-table"><thead><tr><th>Cliente</th><th>Vencimento</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody id="receivableTableBody"></tbody></table></div>
          <p class="receivable-status" id="receivableStatus" role="status" aria-live="polite"></p>
        </section>`
    },
    vendas: {
      title: 'Vendas',
      subtitle: 'Pedidos, clientes e ticket médio',
      content: `
        <section class="module-hero"><p class="eyebrow">Operação comercial</p><h1>Vendas</h1><p>Cadastre clientes, registre pedidos e acompanhe os recebimentos da sua empresa.</p></section>
        <section class="module-grid sales-summary-grid"><article class="module-card"><span>Pedidos no mês</span><strong id="salesOrderCount">0</strong><small id="salesOrderNote">Carregando pedidos…</small></article><article class="module-card"><span>Receita recebida</span><strong id="salesRevenue">R$ 0,00</strong><small>Vendas recebidas no mês</small></article><article class="module-card"><span>Ticket médio</span><strong id="salesAverageTicket">R$ 0,00</strong><small id="salesPendingNote">Nenhuma venda pendente</small></article></section>
        <section class="sales-layout">
          <section class="sales-panel" id="salesCustomerPanel" aria-labelledby="salesCustomerTitle">
            <div class="settings-panel-head"><div><h2 id="salesCustomerTitle">Cadastrar cliente</h2><p>Clientes pertencem somente à sua empresa.</p></div></div>
            <form class="sales-form-grid" id="customerForm">
              <label class="field"><span>Nome completo ou empresa</span><input name="name" type="text" minlength="3" maxlength="140" required autocomplete="name"></label>
              <label class="field"><span>CPF ou CNPJ <small>Opcional</small></span><input name="document" type="text" inputmode="numeric" maxlength="18" placeholder="Somente números"></label>
              <label class="field"><span>E-mail <small>Opcional</small></span><input name="email" type="email" maxlength="160" autocomplete="email"></label>
              <label class="field"><span>Telefone <small>Opcional</small></span><input name="phone" type="tel" maxlength="24" autocomplete="tel"></label>
              <div class="sales-form-actions"><p class="sales-status" id="customerStatus" role="status" aria-live="polite"></p><button class="primary-button" type="submit">Salvar cliente</button></div>
            </form>
          </section>
          <section class="sales-panel" id="salesOrderPanel" aria-labelledby="salesOrderTitle">
            <div class="settings-panel-head"><div><h2 id="salesOrderTitle">Novo pedido</h2><p>O estoque é baixado automaticamente ao confirmar.</p></div></div>
            <form class="sales-order-form" id="salesOrderForm">
              <div class="sales-form-grid sales-order-fields">
                <label class="field"><span>Cliente</span><select id="saleCustomer" name="customerId" required></select></label>
                <label class="field"><span>Forma de pagamento</span><select id="salePaymentMethod" name="paymentMethod"><option value="pix">Pix</option><option value="card">Cartão</option><option value="cash">Dinheiro</option><option value="boleto">Boleto</option><option value="bank_transfer">Transferência</option><option value="other">Outro</option></select></label>
                <label class="field"><span>Situação</span><select id="salePaymentStatus" name="paymentStatus"><option value="paid">Recebido</option><option value="pending">A prazo</option></select></label>
                <label class="field" id="saleDueDateField" hidden><span>Vencimento</span><input id="saleDueDate" name="dueDate" type="date"></label>
              </div>
              <div class="sales-line-form">
                <label class="field sales-product-field"><span>Produto</span><select id="saleProduct" aria-label="Produto do pedido"></select></label>
                <label class="field"><span>Quantidade</span><input id="saleQuantity" type="number" min="1" step="1" value="1" inputmode="numeric"></label>
                <label class="field"><span>Valor unitário (R$)</span><input id="saleUnitPrice" type="text" inputmode="decimal" placeholder="0,00"></label>
                <button class="secondary-button" id="addSaleItem" type="button">Adicionar item</button>
              </div>
              <div class="sales-draft"><div class="table-wrap"><table><thead><tr><th>Produto</th><th>Qtd.</th><th>Unitário</th><th>Subtotal</th><th><span class="sr-only">Remover</span></th></tr></thead><tbody id="saleDraftItems"></tbody></table></div><div class="sales-draft-total"><span>Total do pedido</span><strong id="saleDraftTotal">R$ 0,00</strong></div></div>
              <div class="sales-form-actions"><p class="sales-status" id="salesOrderStatus" role="status" aria-live="polite"></p><button class="primary-button" id="saveSalesOrder" type="submit">Confirmar pedido</button></div>
            </form>
          </section>
        </section>
        <section class="sales-panel sales-list-panel" aria-labelledby="salesListTitle">
          <div class="sales-list-head"><div><h2 id="salesListTitle">Pedidos registrados</h2><p id="salesListSummary">Carregando pedidos…</p></div><button class="secondary-button" id="refreshSales" type="button">Atualizar</button></div>
          <div class="table-wrap"><table class="sales-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Pagamento</th><th>Valor</th><th>Data</th><th>Status</th></tr></thead><tbody id="salesTableBody"></tbody></table></div>
        </section>
        <section class="sales-panel sales-list-panel" aria-labelledby="customersListTitle">
          <div class="sales-list-head"><div><h2 id="customersListTitle">Clientes cadastrados</h2><p id="customersListSummary">Carregando clientes…</p></div><label class="stock-search"><span class="sr-only">Buscar cliente</span><input id="customerSearch" type="search" placeholder="Buscar cliente"></label></div>
          <div class="table-wrap"><table class="sales-table"><thead><tr><th>Cliente</th><th>Documento</th><th>Contato</th><th>Cadastrado em</th></tr></thead><tbody id="customersTableBody"></tbody></table></div>
        </section>`
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
        <section class="module-hero"><p class="eyebrow">Análises</p><h1>Relatórios</h1><p>Exporte os dados reais da sua empresa em CSV para conferência e análise.</p></section>
        <section class="reports-panel" aria-labelledby="reportsExportTitle">
          <div class="settings-panel-head"><div><h2 id="reportsExportTitle">Exportar relatórios</h2><p>Escolha um período opcional e baixe o relatório desejado.</p></div><span class="local-label">Dados da sua empresa</span></div>
          <form class="reports-filter" id="reportFilterForm">
            <label class="field"><span>Data inicial <small>Opcional</small></span><input id="reportStartDate" name="startDate" type="date"></label>
            <label class="field"><span>Data final <small>Opcional</small></span><input id="reportEndDate" name="endDate" type="date"></label>
            <div class="reports-filter-note"><strong>Como o período é aplicado</strong><span>Vendas e estoque: data do pedido/movimentação. Despesas e contas a receber: vencimento.</span></div>
          </form>
          <div class="reports-grid">
            <article class="report-card"><span class="report-card-kicker">Comercial</span><h3>Vendas</h3><p>Pedidos, clientes, forma de pagamento, situação e total.</p><button class="secondary-button report-download" type="button" data-report="sales">Baixar CSV de vendas</button></article>
            <article class="report-card"><span class="report-card-kicker">Estoque</span><h3>Movimentações</h3><p>Entradas, saídas, ajustes e o saldo atual de cada produto.</p><button class="secondary-button report-download" type="button" data-report="stock">Baixar CSV de estoque</button></article>
            <article class="report-card"><span class="report-card-kicker">Financeiro</span><h3>Despesas</h3><p>Fornecedores, notas fiscais, vencimentos, valores e itens importados.</p><button class="secondary-button report-download" type="button" data-report="expenses">Baixar CSV de despesas</button></article>
            <article class="report-card"><span class="report-card-kicker">Financeiro</span><h3>Contas a receber</h3><p>Clientes, pedidos, vencimentos, recebimentos e situação.</p><button class="secondary-button report-download" type="button" data-report="receivables">Baixar CSV de contas</button></article>
          </div>
          <p class="reports-status" id="reportsStatus" role="status" aria-live="polite"></p>
        </section>`
    },
    equipe: {
      title: 'Equipe',
      subtitle: 'Usuários e permissões de acesso',
      content: `
        <section class="module-hero"><p class="eyebrow">Acessos</p><h1>Equipe</h1><p>Convide integrantes da empresa e defina permissões para cada função.</p></section>
        <section class="team-panel" aria-labelledby="addMemberTitle">
          <div class="settings-panel-head"><div><h2 id="addMemberTitle">Convidar integrante</h2><p>Compartilhe o link seguro gerado com a pessoa para concluir o cadastro.</p></div></div>
          <form class="team-form" id="teamForm">
            <label class="field"><span>Nome completo</span><input name="memberName" type="text" minlength="3" maxlength="80" required autocomplete="name"></label>
            <label class="field"><span>E-mail</span><input name="memberEmail" type="email" maxlength="120" required autocomplete="email"></label>
            <label class="field"><span>Função</span><select name="memberRole"><option value="admin">Administrador</option><option value="finance">Financeiro</option><option value="inventory">Estoque</option><option value="operator">Operacional</option></select></label>
            <button class="primary-button" type="submit">Gerar convite</button>
          </form>
          <p class="team-status" id="teamStatus" role="status" aria-live="polite"></p>
          <aside class="team-invitation-card" id="teamInvitationCard" hidden aria-live="polite"><strong>Convite criado</strong><p id="teamInvitationRecipient"></p><label>Link seguro do convite<input id="teamInvitationLink" type="text" readonly></label><button class="secondary-button" id="copyTeamInvitationLink" type="button">Copiar link</button><small>O convite expira em 7 dias e o integrante define a própria senha ao aceitá-lo.</small></aside>
        </section>
        <section class="team-panel" aria-labelledby="teamListTitle">
          <div class="settings-panel-head"><div><h2 id="teamListTitle">Integrantes da empresa</h2><p id="teamCount">Carregando integrantes…</p></div></div>
          <div class="table-wrap"><table class="team-table"><thead><tr><th>Integrante</th><th>Função</th><th>Status</th><th>Ações</th></tr></thead><tbody id="teamTableBody"></tbody></table></div>
        </section>`
    },
    configuracoes: {
      title: 'Configurações',
      subtitle: 'Preferências gerais do sistema',
      content: `
        <section class="module-hero"><p class="eyebrow">Preferências</p><h1>Configurações</h1><p>Defina as preferências gerais usadas por toda a empresa.</p></section>
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
        <section class="settings-panel platform-list-panel platform-support-panel" aria-labelledby="platformEscalationsTitle">
          <div class="settings-panel-head"><div><h2 id="platformEscalationsTitle">Encaminhamentos para atendimento humano</h2><p id="platformEscalationsSummary">Carregando encaminhamentos…</p></div><button class="secondary-button" id="refreshPlatformEscalations" type="button">Atualizar</button></div>
          <div class="table-wrap"><table class="platform-escalations-table"><thead><tr><th>Empresa</th><th>Pergunta</th><th>Cliente</th><th>Data</th></tr></thead><tbody id="platformEscalationsBody"></tbody></table></div>
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
        </div>
        <div class="profile-modal" id="platformSupportModal" role="dialog" aria-modal="true" aria-labelledby="platformSupportModalTitle" hidden>
          <div class="profile-modal-card platform-support-modal-card">
            <div class="profile-modal-head"><div><h2 id="platformSupportModalTitle">Histórico do suporte com IA</h2><p id="platformSupportModalCompany"></p></div><button class="modal-close" id="closePlatformSupportModal" type="button" aria-label="Fechar">×</button></div>
            <p class="platform-support-modal-status" id="platformSupportModalStatus" role="status" aria-live="polite"></p>
            <div class="table-wrap"><table class="platform-support-history-table"><thead><tr><th>Cliente</th><th>Pergunta</th><th>Resposta da IA</th><th>Data</th></tr></thead><tbody id="platformSupportHistoryBody"></tbody></table></div>
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
    const submitButton = settingsForm.querySelector('button[type="submit"]');
    const applySettings = settings => Object.entries(settings).forEach(([name, value]) => {
      const input = settingsForm.elements.namedItem(name);
      if (!input) return;
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = value;
    });
    const setSaving = saving => {
      submitButton.disabled = saving;
      submitButton.textContent = saving ? 'Salvando…' : 'Salvar alterações';
    };
    const showStatus = (message, isError = false) => {
      settingsStatus.textContent = message;
      settingsStatus.classList.toggle('error', isError);
    };
    const loadSettings = async () => {
      setSaving(true);
      showStatus('Carregando configurações da empresa…');
      try {
        const user = await window.SevAuth.ready;
        if (!user) return;
        applySettings(await window.SevApi.getSettings());
        showStatus('');
      } catch (error) {
        showStatus(error.message || 'Não foi possível carregar as configurações da empresa.', true);
      } finally {
        setSaving(false);
      }
    };

    settingsForm.addEventListener('submit', async event => {
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

      setSaving(true);
      showStatus('');
      try {
        applySettings(await window.SevApi.updateSettings(updatedSettings));
        showStatus('Configurações salvas para toda a empresa.');
      } catch (error) {
        showStatus(error.message || 'Não foi possível salvar as configurações da empresa.', true);
      } finally {
        setSaving(false);
      }
    });
    loadSettings();
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
    const submitButton = teamForm.querySelector('button[type="submit"]');
    const invitationCard = document.getElementById('teamInvitationCard');
    const invitationRecipient = document.getElementById('teamInvitationRecipient');
    const invitationLink = document.getElementById('teamInvitationLink');
    const copyInvitationLink = document.getElementById('copyTeamInvitationLink');
    const roleLabels = { owner: 'Proprietário', admin: 'Administrador', finance: 'Financeiro', inventory: 'Estoque', operator: 'Operacional' };
    const editableRoles = ['admin', 'finance', 'inventory', 'operator'];
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    let team = [];
    const showTeamStatus = (message, isError = false) => {
      teamStatus.textContent = message;
      teamStatus.classList.toggle('error', isError);
    };

    const roleSelect = member => `<select data-team-role="${member.id}" aria-label="Função de ${escapeHtml(member.name)}">${editableRoles.map(role => `<option value="${role}"${role === member.role ? ' selected' : ''}>${roleLabels[role]}</option>`).join('')}</select>`;
    const renderTeam = () => {
      const active = team.filter(member => member.status === 'active').length;
      teamCount.textContent = `${team.length} integrante${team.length === 1 ? '' : 's'} · ${active} ativo${active === 1 ? '' : 's'}`;
      teamTableBody.innerHTML = team.length ? team.map(member => {
        const editable = member.status === 'active' && member.role !== 'owner';
        const status = member.status === 'active' ? '<span class="badge ok">Ativo</span>' : member.status === 'invited' ? '<span class="badge low">Convite pendente</span>' : '<span class="badge out">Convite expirado</span>';
        return `
        <tr>
          <td><div class="member-cell"><span class="member-initials" aria-hidden="true">${escapeHtml(member.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase())}</span><span><strong>${escapeHtml(member.name)}</strong><small>${escapeHtml(member.email)}</small></span></div></td>
          <td>${editable ? roleSelect(member) : escapeHtml(roleLabels[member.role])}</td>
          <td>${status}</td>
          <td>${editable ? `<button class="secondary-button team-save-role" type="button" data-save-team-role="${member.id}">Salvar</button>` : '<span class="team-protected-role">Definido na criação da empresa</span>'}</td>
        </tr>`;
      }).join('') : '<tr><td class="empty-table" colspan="4">Nenhum integrante encontrado.</td></tr>';
    };
    const setSubmitting = submitting => {
      submitButton.disabled = submitting;
      submitButton.textContent = submitting ? 'Gerando…' : 'Gerar convite';
    };
    const loadTeam = async () => {
      showTeamStatus('Carregando integrantes…');
      try {
        const user = await window.SevAuth.ready;
        if (!user) return;
        team = await window.SevApi.getTeam();
        renderTeam();
        showTeamStatus('');
      } catch (error) {
        team = [];
        renderTeam();
        showTeamStatus(error.message || 'Não foi possível carregar a equipe da empresa.', true);
      }
    };
    teamForm.addEventListener('submit', async event => {
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
      setSubmitting(true);
      showTeamStatus('');
      try {
        const invitation = await window.SevApi.createTeamInvitation({ name, email, role });
        invitationRecipient.textContent = `${invitation.name} · ${roleLabels[invitation.role]}`;
        invitationLink.value = invitation.inviteLink;
        invitationCard.hidden = false;
        teamForm.reset();
        await loadTeam();
        showTeamStatus('Convite criado. Copie o link e envie ao integrante.');
        teamForm.elements.memberName.focus();
      } catch (error) {
        showTeamStatus(error.message || 'Não foi possível criar o convite.', true);
      } finally {
        setSubmitting(false);
      }
    });
    teamTableBody.addEventListener('click', async event => {
      const button = event.target.closest('[data-save-team-role]');
      if (!button || button.disabled) return;
      const member = team.find(item => item.id === button.dataset.saveTeamRole);
      const select = teamTableBody.querySelector(`[data-team-role="${button.dataset.saveTeamRole}"]`);
      if (!member || !select || select.value === member.role) return;
      button.disabled = true;
      button.textContent = 'Salvando…';
      try {
        const updated = await window.SevApi.updateTeamMemberRole(member.id, select.value);
        team = team.map(item => item.id === updated.id ? updated : item);
        renderTeam();
        showTeamStatus('Função do integrante atualizada.');
      } catch (error) {
        showTeamStatus(error.message || 'Não foi possível atualizar a função.', true);
        button.disabled = false;
        button.textContent = 'Salvar';
      }
    });
    copyInvitationLink.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(invitationLink.value);
        copyInvitationLink.textContent = 'Link copiado';
        window.setTimeout(() => { copyInvitationLink.textContent = 'Copiar link'; }, 1800);
      } catch {
        invitationLink.focus();
        invitationLink.select();
        showTeamStatus('Copie o link selecionado manualmente.', true);
      }
    });
    renderTeam();
    loadTeam();
  }
})();
