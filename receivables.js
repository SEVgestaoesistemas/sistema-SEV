/* Real accounts receivable, created from sales registered as a prazo. */
(() => {
  const totalElement = document.getElementById('receivableTotal');
  if (!totalElement) return;

  const summaryElement = document.getElementById('receivableSummary');
  const chartElement = document.getElementById('receivableChart');
  const tableBody = document.getElementById('receivableTableBody');
  const statusElement = document.getElementById('receivableStatus');
  const chartColors = ['var(--brand)', 'var(--info)', 'var(--warning)', 'var(--success)', '#8b5cf6'];
  let receivables = [];
  let currentUser = null;

  const formatCurrency = cents => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(Number(cents || 0) / 100);

  const formatDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return '—';
    const [year, month, day] = value.split('-');
    return `${day}/${month}/${year}`;
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const canReceivePayments = () => ['owner', 'admin', 'finance'].includes(currentUser?.organization?.role);

  const setStatus = (message = '', isError = false) => {
    statusElement.textContent = message;
    statusElement.classList.toggle('error', isError);
  };

  const statusView = status => {
    if (status === 'paid') return { label: 'Pago', className: 'ok' };
    if (status === 'overdue') return { label: 'Atrasado', className: 'out' };
    return { label: 'A vencer', className: 'low' };
  };

  const renderChart = customers => {
    if (!customers.length) {
      chartElement.innerHTML = '<p class="receivable-empty">Não há valores pendentes para exibir.</p>';
      return;
    }
    const maximum = Math.max(...customers.map(customer => Number(customer.amountCents || 0)), 1);
    chartElement.innerHTML = customers.map((customer, index) => {
      const size = Math.max(4, Math.min(100, (Number(customer.amountCents || 0) / maximum) * 100));
      const color = chartColors[index % chartColors.length];
      return `<div class="pending-chart-row"><span title="${escapeHtml(customer.customerName)}">${escapeHtml(customer.customerName)}</span><div class="pending-chart-track"><span class="pending-chart-bar" style="--bar-size:${size.toFixed(2)}%;--bar-color:${color}"></span></div><strong>${formatCurrency(customer.amountCents)}</strong></div>`;
    }).join('');
  };

  const renderTable = () => {
    if (!receivables.length) {
      tableBody.innerHTML = '<tr><td class="empty-table" colspan="5">Nenhuma conta a receber registrada para esta empresa.</td></tr>';
      return;
    }
    tableBody.innerHTML = receivables.map(receivable => {
      const status = statusView(receivable.status);
      const action = receivable.status === 'paid'
        ? '<span class="receivable-paid-note">Recebimento confirmado</span>'
        : canReceivePayments()
          ? `<button class="secondary-button receivable-mark-paid" type="button" data-receivable-id="${escapeHtml(receivable.id)}">Marcar como pago</button>`
          : '<span class="receivable-paid-note">Sem permissão para baixar</span>';
      return `<tr><td><strong>${escapeHtml(receivable.customerName)}</strong><small>Pedido #${escapeHtml(receivable.orderNumber)}</small></td><td>${formatDate(receivable.dueDate)}</td><td><strong>${formatCurrency(receivable.amountCents)}</strong></td><td><span class="badge ${status.className}">${status.label}</span></td><td>${action}</td></tr>`;
    }).join('');
  };

  const render = dashboard => {
    totalElement.textContent = formatCurrency(dashboard.pendingCents);
    if (!dashboard.pendingCount) {
      summaryElement.textContent = 'Nenhuma conta em aberto';
    } else if (dashboard.overdueCount) {
      summaryElement.textContent = `${dashboard.pendingCount} conta${dashboard.pendingCount === 1 ? '' : 's'} em aberto · ${dashboard.overdueCount} atrasada${dashboard.overdueCount === 1 ? '' : 's'}`;
    } else {
      summaryElement.textContent = `${dashboard.pendingCount} conta${dashboard.pendingCount === 1 ? '' : 's'} em aberto`;
    }
    renderChart(dashboard.customers || []);
    renderTable();
  };

  const loadReceivables = async () => {
    setStatus('Carregando contas a receber…');
    try {
      currentUser = await window.SevAuth.ready;
      if (!currentUser) return;
      const [dashboard, list] = await Promise.all([
        window.SevApi.getReceivablesDashboard(),
        window.SevApi.getReceivables({ limit: 100 })
      ]);
      receivables = list;
      render(dashboard);
      setStatus('');
    } catch (error) {
      totalElement.textContent = '—';
      summaryElement.textContent = 'Dados indisponíveis';
      chartElement.innerHTML = '<p class="receivable-empty">Não foi possível carregar as contas a receber.</p>';
      tableBody.innerHTML = '<tr><td class="empty-table" colspan="5">Não foi possível carregar as contas a receber.</td></tr>';
      setStatus(error.message || 'Não foi possível carregar as contas a receber.', true);
    }
  };

  tableBody.addEventListener('click', async event => {
    const button = event.target.closest('[data-receivable-id]');
    if (!button || button.disabled) return;
    const id = button.dataset.receivableId;
    button.disabled = true;
    button.textContent = 'Confirmando…';
    setStatus('Confirmando o recebimento…');
    try {
      await window.SevApi.markReceivablePaid(id);
      await loadReceivables();
      setStatus('Recebimento marcado como pago.');
    } catch (error) {
      button.disabled = false;
      button.textContent = 'Marcar como pago';
      setStatus(error.message || 'Não foi possível marcar o recebimento como pago.', true);
    }
  });

  loadReceivables();
})();
