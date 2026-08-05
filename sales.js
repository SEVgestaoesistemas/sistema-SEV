/* Customers and orders are loaded from the authenticated company's API data. */
(() => {
  if (document.body.dataset.page !== 'vendas' || !window.SevApi || !window.SevAuth) return;

  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const financialValue = (cents, redacted) => redacted
    ? '<span class="financial-value-blurred">R$ ••••</span>'
    : money(cents);
  const setFinancialValue = (element, cents, redacted) => {
    element.textContent = redacted ? 'R$ ••••' : money(cents);
    element.classList.toggle('financial-value-blurred', Boolean(redacted));
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const formatDate = value => {
    if (!value) return '—';
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
  };
  const paymentLabels = {
    pix: 'Pix', card: 'Cartão', cash: 'Dinheiro', boleto: 'Boleto', bank_transfer: 'Transferência', other: 'Outro'
  };
  const parseReais = rawValue => {
    const raw = String(rawValue || '').trim();
    if (!raw) return 0;
    const decimalIndex = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'));
    let whole = raw;
    let fraction = '';
    if (decimalIndex >= 0 && raw.length - decimalIndex <= 3) {
      whole = raw.slice(0, decimalIndex);
      fraction = raw.slice(decimalIndex + 1);
    }
    const wholeDigits = whole.replace(/\D/g, '');
    const fractionDigits = fraction.replace(/\D/g, '').slice(0, 2).padEnd(2, '0');
    if (!wholeDigits && !fractionDigits) return 0;
    const cents = Number(wholeDigits || '0') * 100 + Number(fractionDigits || '0');
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 1000000000000 ? cents : 0;
  };
  const priceInputValue = cents => (Number(cents || 0) / 100).toFixed(2).replace('.', ',');

  const customerForm = document.getElementById('customerForm');
  const salesOrderForm = document.getElementById('salesOrderForm');
  const customerPanel = document.getElementById('salesCustomerPanel');
  const salesOrderPanel = document.getElementById('salesOrderPanel');
  const customerStatus = document.getElementById('customerStatus');
  const salesOrderStatus = document.getElementById('salesOrderStatus');
  const customerSelect = document.getElementById('saleCustomer');
  const productSelect = document.getElementById('saleProduct');
  const quantityInput = document.getElementById('saleQuantity');
  const priceInput = document.getElementById('saleUnitPrice');
  const draftItemsBody = document.getElementById('saleDraftItems');
  const draftTotal = document.getElementById('saleDraftTotal');
  const salesTableBody = document.getElementById('salesTableBody');
  const customersTableBody = document.getElementById('customersTableBody');
  const customerSearch = document.getElementById('customerSearch');
  const paymentStatus = document.getElementById('salePaymentStatus');
  const dueDateField = document.getElementById('saleDueDateField');
  const dueDateInput = document.getElementById('saleDueDate');

  let customers = [];
  let products = [];
  let sales = [];
  let draftItems = [];
  let canCreate = false;

  const setStatus = (element, message = '', isError = false) => {
    element.textContent = message;
    element.classList.toggle('error', isError);
  };
  const setButtonState = (button, busy, busyLabel) => {
    if (!button) return;
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    if (busyLabel) button.textContent = busy ? busyLabel : button.dataset.label;
  };
  const paymentStatusLabel = status => status === 'paid' ? 'Recebido' : 'A receber';

  const renderSummary = dashboard => {
    const summary = dashboard.summary;
    const redacted = Boolean(dashboard.financialValuesRedacted);
    document.getElementById('salesOrderCount').textContent = String(summary.orderCount);
    document.getElementById('salesOrderNote').textContent = `${summary.orderCount === 1 ? '1 pedido registrado' : `${summary.orderCount} pedidos registrados`} no mês`;
    setFinancialValue(document.getElementById('salesRevenue'), summary.revenueCents, redacted);
    setFinancialValue(document.getElementById('salesAverageTicket'), summary.averageTicketCents, redacted);
    document.getElementById('salesPendingNote').textContent = redacted ? 'Valor a receber oculto' : summary.pendingCents > 0
      ? `${money(summary.pendingCents)} a receber`
      : 'Nenhuma venda pendente';
    document.getElementById('salesPendingNote').classList.toggle('financial-value-blurred', redacted);
  };

  const renderCustomerOptions = () => {
    const selected = customerSelect.value;
    customerSelect.innerHTML = `<option value="">Selecione um cliente</option>${customers.map(customer => (
      `<option value="${escapeHtml(customer.id)}">${escapeHtml(customer.name)}</option>`
    )).join('')}`;
    if (customers.some(customer => customer.id === selected)) customerSelect.value = selected;
  };

  const renderProductOptions = () => {
    const selected = productSelect.value;
    productSelect.innerHTML = `<option value="">Selecione um produto</option>${products.map(product => (
      `<option value="${escapeHtml(product.id)}" ${product.quantity < 1 ? 'disabled' : ''}>${escapeHtml(product.name)} · ${product.quantity} em estoque</option>`
    )).join('')}`;
    if (products.some(product => product.id === selected && product.quantity > 0)) productSelect.value = selected;
  };

  const renderDraft = () => {
    const totalCents = draftItems.reduce((total, item) => total + item.quantity * item.unitPriceCents, 0);
    draftTotal.textContent = money(totalCents);
    draftItemsBody.innerHTML = draftItems.length ? draftItems.map((item, index) => `
      <tr><td>${escapeHtml(item.productName)}</td><td>${item.quantity}</td><td>${money(item.unitPriceCents)}</td><td>${money(item.quantity * item.unitPriceCents)}</td><td><button class="sales-remove-item" type="button" data-sale-item-index="${index}" aria-label="Remover ${escapeHtml(item.productName)}">×</button></td></tr>`
    ).join('') : '<tr><td class="empty-table" colspan="5">Adicione produtos ao pedido.</td></tr>';
  };

  const renderCustomers = () => {
    const query = customerSearch.value.trim().toLocaleLowerCase('pt-BR');
    const visibleCustomers = customers.filter(customer => [customer.name, customer.document, customer.email, customer.phone]
      .filter(Boolean).some(value => value.toLocaleLowerCase('pt-BR').includes(query)));
    document.getElementById('customersListSummary').textContent = `${visibleCustomers.length} cliente${visibleCustomers.length === 1 ? '' : 's'} exibido${visibleCustomers.length === 1 ? '' : 's'}`;
    customersTableBody.innerHTML = visibleCustomers.length ? visibleCustomers.map(customer => `
      <tr><td><strong>${escapeHtml(customer.name)}</strong></td><td>${escapeHtml(customer.document || '—')}</td><td>${escapeHtml(customer.email || customer.phone || '—')}</td><td>${formatDate(customer.createdAt)}</td></tr>`
    ).join('') : '<tr><td class="empty-table" colspan="4">Nenhum cliente encontrado.</td></tr>';
  };

  const renderSales = () => {
    document.getElementById('salesListSummary').textContent = `${sales.length} pedido${sales.length === 1 ? '' : 's'} registrado${sales.length === 1 ? '' : 's'}`;
    salesTableBody.innerHTML = sales.length ? sales.map(sale => `
      <tr><td><strong>#${sale.orderNumber}</strong><small>${sale.itemCount} item${sale.itemCount === 1 ? '' : 'ns'}</small></td><td>${escapeHtml(sale.customerName)}</td><td>${escapeHtml(paymentLabels[sale.paymentMethod] || sale.paymentMethod)}</td><td>${financialValue(sale.totalCents, sale.financialValuesRedacted)}</td><td>${formatDate(sale.createdAt)}</td><td><span class="badge ${sale.paymentStatus === 'paid' ? 'ok' : 'low'}">${paymentStatusLabel(sale.paymentStatus)}</span></td></tr>`
    ).join('') : '<tr><td class="empty-table" colspan="6">Nenhum pedido registrado.</td></tr>';
  };

  const syncPaymentStatus = () => {
    const pending = paymentStatus.value === 'pending';
    dueDateField.hidden = !pending;
    dueDateInput.disabled = !pending;
    dueDateInput.required = pending;
    if (!pending) dueDateInput.value = '';
  };

  const loadData = async () => {
    setStatus(customerStatus, '');
    setStatus(salesOrderStatus, '');
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      canCreate = ['owner', 'admin', 'operator'].includes(user.organization?.role);
      customerPanel.hidden = !canCreate;
      salesOrderPanel.hidden = !canCreate;
      const requests = [window.SevApi.getCustomers(), window.SevApi.getSales(), window.SevApi.getSalesDashboard()];
      if (canCreate) requests.push(window.SevApi.getProducts());
      const response = await Promise.all(requests);
      [customers, sales] = response;
      renderSummary(response[2]);
      if (canCreate) products = response[3];
      renderCustomerOptions();
      renderProductOptions();
      renderCustomers();
      renderSales();
      renderDraft();
    } catch (error) {
      const message = error.message || 'Não foi possível carregar as vendas.';
      document.getElementById('salesListSummary').textContent = message;
      document.getElementById('customersListSummary').textContent = message;
    }
  };

  productSelect.addEventListener('change', () => {
    const product = products.find(item => item.id === productSelect.value);
    if (product) priceInput.value = priceInputValue(product.unitPriceCents);
  });
  paymentStatus.addEventListener('change', syncPaymentStatus);
  customerSearch.addEventListener('input', renderCustomers);
  document.getElementById('refreshSales').addEventListener('click', loadData);
  draftItemsBody.addEventListener('click', event => {
    const button = event.target.closest('[data-sale-item-index]');
    if (!button) return;
    draftItems.splice(Number(button.dataset.saleItemIndex), 1);
    renderDraft();
  });

  document.getElementById('addSaleItem').addEventListener('click', () => {
    const product = products.find(item => item.id === productSelect.value);
    const quantity = Number(quantityInput.value);
    const unitPriceCents = parseReais(priceInput.value);
    if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > product.quantity || unitPriceCents < 1) {
      setStatus(salesOrderStatus, 'Selecione um produto, informe uma quantidade disponível e um valor válido.', true);
      return;
    }
    if (draftItems.some(item => item.productId === product.id)) {
      setStatus(salesOrderStatus, 'Este produto já foi adicionado ao pedido.', true);
      return;
    }
    draftItems.push({ productId: product.id, productName: product.name, quantity, unitPriceCents });
    productSelect.value = '';
    quantityInput.value = '1';
    priceInput.value = '';
    setStatus(salesOrderStatus);
    renderDraft();
  });

  customerForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!customerForm.reportValidity()) return;
    const button = customerForm.querySelector('button[type="submit"]');
    const payload = Object.fromEntries(new FormData(customerForm).entries());
    setButtonState(button, true, 'Salvando…');
    setStatus(customerStatus, '');
    try {
      const customer = await window.SevApi.createCustomer(payload);
      customers = [...customers, customer].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));
      customerForm.reset();
      renderCustomerOptions();
      renderCustomers();
      customerSelect.value = customer.id;
      setStatus(customerStatus, 'Cliente cadastrado com sucesso.');
    } catch (error) {
      setStatus(customerStatus, error.message || 'Não foi possível cadastrar o cliente.', true);
    } finally {
      setButtonState(button, false);
    }
  });

  salesOrderForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!salesOrderForm.reportValidity()) return;
    if (!draftItems.length) {
      setStatus(salesOrderStatus, 'Adicione pelo menos um produto ao pedido.', true);
      return;
    }
    const saveButton = document.getElementById('saveSalesOrder');
    const payload = {
      customerId: customerSelect.value,
      paymentMethod: document.getElementById('salePaymentMethod').value,
      paymentStatus: paymentStatus.value,
      items: draftItems.map(({ productId, quantity, unitPriceCents }) => ({ productId, quantity, unitPriceCents }))
    };
    if (payload.paymentStatus === 'pending') payload.dueDate = dueDateInput.value;
    setButtonState(saveButton, true, 'Confirmando…');
    setStatus(salesOrderStatus, '');
    try {
      const sale = await window.SevApi.createSale(payload);
      draftItems = [];
      salesOrderForm.reset();
      syncPaymentStatus();
      renderDraft();
      await loadData();
      window.dispatchEvent(new CustomEvent('sev:notifications-changed'));
      setStatus(salesOrderStatus, `Pedido #${sale.orderNumber} registrado com sucesso.`);
    } catch (error) {
      setStatus(salesOrderStatus, error.message || 'Não foi possível registrar o pedido.', true);
    } finally {
      setButtonState(saveButton, false);
    }
  });

  syncPaymentStatus();
  renderDraft();
  loadData();
})();
