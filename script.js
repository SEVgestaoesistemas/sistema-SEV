/* ==========================================================================
   Cerne · ERP dashboard base — script.js
   Troque os arrays de dados abaixo pelos dados reais vindos da sua API.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ------------------------------------------------------- menu lateral */
  const sidebar   = document.getElementById('sidebar');
  const overlay   = document.getElementById('overlay');
  const menuToggle= document.getElementById('menuToggle');
  if (!sidebar || !overlay || !menuToggle) return;

  const openMenu  = () => {
    sidebar.classList.add('open');
    overlay.classList.add('open');
    menuToggle.setAttribute('aria-expanded', 'true');
  };
  const closeMenu = () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
    menuToggle.setAttribute('aria-expanded', 'false');
  };

  menuToggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeMenu() : openMenu();
  });
  overlay.addEventListener('click', closeMenu);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  /* ---------------------------------------------- estoque do painel */
  const dashboardStockTable = document.getElementById('dashboardStockTableBody');
  if (dashboardStockTable && window.SevApi && window.SevAuth) {
    const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    })[character]);
    const productStatus = product => product.quantity === 0 ? 'out' : product.quantity <= product.minimumQuantity ? 'low' : 'ok';
    const statusLabel = status => ({ ok: 'Em estoque', low: 'Estoque baixo', out: 'Esgotado' })[status];
    const statusColor = status => ({ ok: 'var(--success)', low: 'var(--warning)', out: 'var(--danger)' })[status];
    const formatDate = value => {
      if (!value) return '—';
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR');
    };

    window.SevAuth.ready.then(async user => {
      if (!user) return;
      try {
        const products = await window.SevApi.getProducts();
        const visibleProducts = products.slice(0, 4);
        dashboardStockTable.innerHTML = visibleProducts.length ? visibleProducts.map(product => {
          const status = productStatus(product);
          return `<tr><td><div class="prod-cell"><span class="prod-swatch" style="background:${statusColor(status)}"></span>${escapeHtml(product.name)}</div></td><td>${product.quantity}</td><td><span class="badge ${status}">${statusLabel(status)}</span></td><td>${formatDate(product.updatedAt || product.createdAt)}</td></tr>`;
        }).join('') : '<tr><td class="empty-table" colspan="4">Nenhum produto cadastrado.</td></tr>';
      } catch (error) {
        dashboardStockTable.innerHTML = `<tr><td class="empty-table" colspan="4">${escapeHtml(error.message || 'Não foi possível carregar o estoque.')}</td></tr>`;
      }
    });
  }

  /* ---------------------------------------------------------- abas da tabela */
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tab.parentElement.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  /* -------------------------------------------------------------- charts */
  if (typeof Chart === 'undefined') return;

  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.color = '#9799AD';

  const months = ['Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul'];

  /* linha: receita x despesas */
  const revCtx = document.getElementById('revenueChart');
  if (revCtx) {
    const grad = revCtx.getContext('2d').createLinearGradient(0, 0, 0, 220);
    grad.addColorStop(0, 'rgba(91,78,242,0.22)');
    grad.addColorStop(1, 'rgba(91,78,242,0)');

    new Chart(revCtx, {
      type: 'line',
      data: {
        labels: months,
        datasets: [
          {
            label: 'Receita',
            data: [78000, 86000, 91000, 99000, 112000, 128400],
            borderColor: '#5B4EF2',
            backgroundColor: grad,
            borderWidth: 2.5,
            tension: 0.4,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#5B4EF2',
          },
          {
            label: 'Despesas',
            data: [52000, 55000, 58000, 60000, 63000, 66500],
            borderColor: '#C7C8DA',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 5],
            tension: 0.4,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#C7C8DA',
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#12142B',
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: R$ ${ctx.parsed.y.toLocaleString('pt-BR')}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: {
            grid: { color: '#EDEDF6' },
            border: { display: false },
            ticks: { callback: (v) => 'R$ ' + (v / 1000) + 'k' }
          }
        }
      }
    });
  }

  /* donut: nível de estoque por categoria */
  const donutCtx = document.getElementById('stockDonut');
  if (donutCtx) {
    new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Eletrônicos', 'Vestuário', 'Casa & decoração', 'Outros'],
        datasets: [{
          data: [42, 26, 19, 13],
          backgroundColor: ['#5B4EF2', '#12A96B', '#E88A1B', '#E6E7F2'],
          borderWidth: 0,
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#12142B',
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed}%` }
          }
        }
      }
    });
  }

  /* barras: pedidos por mês */
  const ordersCtx = document.getElementById('ordersChart');
  if (ordersCtx) {
    new Chart(ordersCtx, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: 'Pedidos',
          data: [180, 205, 230, 255, 288, 320],
          backgroundColor: '#5B4EF2',
          borderRadius: 6,
          maxBarThickness: 34,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#12142B',
            padding: 10,
            cornerRadius: 8,
            callbacks: { label: (ctx) => ` ${ctx.parsed.y} pedidos` }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false } },
          y: { grid: { color: '#EDEDF6' }, border: { display: false }, ticks: { stepSize: 100 } }
        }
      }
    });
  }

});
