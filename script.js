/* Dashboard values are loaded from the authenticated company's API data. */
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('overlay');
  const menuToggle = document.getElementById('menuToggle');
  if (!sidebar || !overlay || !menuToggle) return;

  const openMenu = () => {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    menuToggle.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };
  menuToggle.addEventListener('click', () => sidebar.classList.contains('open') ? closeMenu() : openMenu());
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeMenu(); });

  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const setFinancialValue = (element, cents, redacted) => {
    element.textContent = redacted ? 'R$ ••••' : money(cents);
    element.classList.toggle('financial-value-blurred', Boolean(redacted));
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const formatDate = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
  };
  const monthLabel = value => new Date(`${value}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' })
    .replace('.', '').replace(/^./, letter => letter.toUpperCase());
  const productStatus = product => product.quantity === 0 ? 'out' : product.quantity <= product.minimumQuantity ? 'low' : 'ok';
  const statusLabel = status => ({ ok: 'Em estoque', low: 'Estoque baixo', out: 'Esgotado' })[status];
  const statusColor = status => ({ ok: 'var(--success)', low: 'var(--warning)', out: 'var(--danger)' })[status];

  const dashboardStockTable = document.getElementById('dashboardStockTableBody');
  const renderStock = products => {
    if (!dashboardStockTable) return;
    const visibleProducts = products.slice(0, 4);
    dashboardStockTable.innerHTML = visibleProducts.length ? visibleProducts.map(product => {
      const status = productStatus(product);
      return `<tr><td><div class="prod-cell"><span class="prod-swatch" style="background:${statusColor(status)}"></span>${escapeHtml(product.name)}</div></td><td>${product.quantity}</td><td><span class="badge ${status}">${statusLabel(status)}</span></td><td>${formatDate(product.updatedAt || product.createdAt)}</td></tr>`;
    }).join('') : '<tr><td class="empty-table" colspan="4">Nenhum produto cadastrado.</td></tr>';
  };

  let revenueChart;
  let ordersChart;
  let stockChart;
  const renderCharts = dashboard => {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#9799AD';
    const labels = dashboard.monthly.map(month => monthLabel(month.month));
    const revenue = dashboard.monthly.map(month => Number(month.revenueCents) / 100);
    const expenses = dashboard.monthly.map(month => Number(month.expenseCents) / 100);
    const orderCounts = dashboard.monthly.map(month => month.orderCount);

    const revenueCanvas = document.getElementById('revenueChart');
    if (revenueCanvas) {
      revenueCanvas.closest('.panel')?.classList.toggle('financial-panel-redacted', Boolean(dashboard.financialValuesRedacted));
      if (dashboard.financialValuesRedacted) {
        revenueChart?.destroy();
      }
      revenueChart?.destroy();
      const gradient = revenueCanvas.getContext('2d').createLinearGradient(0, 0, 0, 220);
      gradient.addColorStop(0, 'rgba(91,78,242,0.22)');
      gradient.addColorStop(1, 'rgba(91,78,242,0)');
      revenueChart = new Chart(revenueCanvas, {
        type: 'line',
        data: { labels, datasets: [
          { label: 'Receita', data: revenue, borderColor: '#5B4EF2', backgroundColor: gradient, borderWidth: 2.5, tension: .4, fill: true, pointRadius: 0, pointHoverRadius: 5 },
          { label: 'Despesas', data: expenses, borderColor: '#C7C8DA', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 5], tension: .4, fill: false, pointRadius: 0, pointHoverRadius: 5 }
        ] },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#12142B', padding: 10, cornerRadius: 8, callbacks: { label: context => ` ${context.dataset.label}: ${money(Math.round(context.parsed.y * 100))}` } } }, scales: { x: { grid: { display: false }, border: { display: false } }, y: { grid: { color: '#EDEDF6' }, border: { display: false }, ticks: { callback: value => money(Number(value) * 100) } } } }
      });
    }

    const ordersCanvas = document.getElementById('ordersChart');
    if (ordersCanvas) {
      ordersChart?.destroy();
      ordersChart = new Chart(ordersCanvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'Pedidos', data: orderCounts, backgroundColor: '#5B4EF2', borderRadius: 6, maxBarThickness: 34 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { backgroundColor: '#12142B', padding: 10, cornerRadius: 8, callbacks: { label: context => ` ${context.parsed.y} pedido${context.parsed.y === 1 ? '' : 's'}` } } }, scales: { x: { grid: { display: false }, border: { display: false } }, y: { beginAtZero: true, grid: { color: '#EDEDF6' }, border: { display: false }, ticks: { precision: 0 } } } }
      });
    }

    const stockCanvas = document.getElementById('stockDonut');
    if (stockCanvas) {
      const summary = dashboard.summary;
      const available = Math.max(summary.productCount - summary.lowStockCount - summary.outOfStockCount, 0);
      stockChart?.destroy();
      stockChart = new Chart(stockCanvas, {
        type: 'doughnut',
        data: { labels: ['Em estoque', 'Estoque baixo', 'Esgotados'], datasets: [{ data: [available, summary.lowStockCount, summary.outOfStockCount], backgroundColor: ['#12A96B', '#E88A1B', '#F04465'], borderWidth: 0, hoverOffset: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '72%', plugins: { legend: { display: false }, tooltip: { backgroundColor: '#12142B', padding: 10, cornerRadius: 8 } } }
      });
    }
  };

  const renderDashboard = dashboard => {
    const summary = dashboard.summary;
    setFinancialValue(document.getElementById('dashboardRevenue'), summary.revenueCents, dashboard.financialValuesRedacted);
    document.getElementById('dashboardOrders').textContent = String(summary.orderCount);
    document.getElementById('dashboardStockUnits').textContent = String(summary.unitsInStock);
    setFinancialValue(document.getElementById('dashboardAverageTicket'), summary.averageTicketCents, dashboard.financialValuesRedacted);
    document.getElementById('salesNavBadge').textContent = String(summary.orderCount);
    const availableProducts = summary.productCount - summary.outOfStockCount;
    const availability = summary.productCount ? Math.round((availableProducts / summary.productCount) * 100) : 0;
    document.getElementById('dashboardStockAvailability').textContent = `${availability}%`;
    document.getElementById('dashboardStockAvailabilityLabel').textContent = summary.productCount ? 'disponível' : 'sem produtos';
    document.getElementById('dashboardProductCount').textContent = String(summary.productCount);
    document.getElementById('dashboardAvailableProducts').textContent = String(availableProducts);
    document.getElementById('dashboardLowStock').textContent = String(summary.lowStockCount);
    document.getElementById('dashboardOutStock').textContent = String(summary.outOfStockCount);
    renderCharts(dashboard);
  };

  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tab.parentElement.querySelectorAll('.tab').forEach(item => item.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  window.SevAuth?.ready.then(async user => {
    if (!user) return;
    try {
      renderDashboard(await window.SevApi.getDashboardOverview());
    } catch {
      // The dashboard keeps empty states until the API becomes available.
    }
    try {
      renderStock(await window.SevApi.getProducts());
    } catch (error) {
      if (dashboardStockTable) dashboardStockTable.innerHTML = `<tr><td class="empty-table" colspan="4">${escapeHtml(error.message || 'Não foi possível carregar o estoque.')}</td></tr>`;
    }
  });
});
