/* Real payment-method distribution from the sales dashboard API. */
(() => {
  const donut = document.getElementById('paymentDonut');
  if (!donut) return;

  const legend = document.getElementById('paymentLegend');
  const methodElement = document.getElementById('paymentMethod');
  const amountElement = document.getElementById('paymentAmount');
  const percentElement = document.getElementById('paymentPercent');
  const statusElement = document.getElementById('paymentStatus');
  const methods = {
    pix: { label: 'Pix', color: 'var(--brand)' },
    card: { label: 'Cartão', color: 'var(--info)' },
    cash: { label: 'Dinheiro', color: 'var(--success)' },
    boleto: { label: 'Boleto', color: 'var(--warning)' },
    bank_transfer: { label: 'Transferência', color: '#8b5cf6' },
    other: { label: 'Outros', color: 'var(--danger)' }
  };
  let payments = [];

  const formatCurrency = cents => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL'
  }).format(Number(cents || 0) / 100);

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);

  const setStatus = (message = '', isError = false) => {
    statusElement.textContent = message;
    statusElement.classList.toggle('error', isError);
  };

  const percentage = payment => {
    const total = payments.reduce((sum, item) => sum + Number(item.totalCents || 0), 0);
    return total ? (Number(payment.totalCents || 0) / total) * 100 : 0;
  };

  const selectPayment = paymentMethod => {
    const payment = payments.find(item => item.paymentMethod === paymentMethod) || payments[0];
    if (!payment) return;
    const descriptor = methods[payment.paymentMethod] || methods.other;
    const percent = percentage(payment);
    methodElement.textContent = descriptor.label;
    amountElement.textContent = formatCurrency(payment.totalCents);
    percentElement.textContent = `${percent.toFixed(percent >= 10 ? 0 : 1).replace('.', ',')}% das vendas`;
    legend.querySelectorAll('[data-payment]').forEach(button => {
      const active = button.dataset.payment === payment.paymentMethod;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  const render = () => {
    if (!payments.length) {
      donut.style.removeProperty('--payment-donut');
      donut.setAttribute('aria-label', 'Não há vendas registradas por forma de pagamento.');
      methodElement.textContent = 'Sem vendas';
      amountElement.textContent = formatCurrency(0);
      percentElement.textContent = 'Nenhuma venda registrada';
      legend.innerHTML = '<p class="payment-empty">As formas de pagamento aparecerão aqui após registrar vendas.</p>';
      return;
    }

    let currentPercentage = 0;
    const gradient = payments.map(payment => {
      const descriptor = methods[payment.paymentMethod] || methods.other;
      const nextPercentage = currentPercentage + percentage(payment);
      const segment = `${descriptor.color} ${currentPercentage.toFixed(3)}% ${nextPercentage.toFixed(3)}%`;
      currentPercentage = nextPercentage;
      return segment;
    }).join(', ');
    donut.style.setProperty('--payment-donut', `conic-gradient(${gradient})`);
    donut.setAttribute('aria-label', `Vendas por pagamento: ${payments.map(payment => {
      const descriptor = methods[payment.paymentMethod] || methods.other;
      return `${descriptor.label} ${percentage(payment).toFixed(1).replace('.', ',')}%`;
    }).join(', ')}.`);
    legend.innerHTML = payments.map(payment => {
      const descriptor = methods[payment.paymentMethod] || methods.other;
      const percent = percentage(payment);
      return `<button class="payment-legend-item" type="button" data-payment="${escapeHtml(payment.paymentMethod)}" aria-pressed="false"><span class="payment-dot" style="--payment-color:${descriptor.color}"></span><span>${escapeHtml(descriptor.label)}</span><strong>${percent.toFixed(percent >= 10 ? 0 : 1).replace('.', ',')}%</strong></button>`;
    }).join('');
    selectPayment(payments[0].paymentMethod);
  };

  const loadPayments = async () => {
    setStatus('Carregando formas de pagamento…');
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      const dashboard = await window.SevApi.getFinanceDashboard();
      payments = (dashboard.paymentMethods || [])
        .filter(payment => Number(payment.totalCents || 0) > 0)
        .sort((left, right) => Number(right.totalCents || 0) - Number(left.totalCents || 0));
      render();
      setStatus('');
    } catch (error) {
      donut.style.removeProperty('--payment-donut');
      donut.setAttribute('aria-label', 'Não foi possível carregar as formas de pagamento.');
      methodElement.textContent = 'Indisponível';
      amountElement.textContent = '—';
      percentElement.textContent = 'Dados indisponíveis';
      legend.innerHTML = '<p class="payment-empty">Não foi possível carregar as formas de pagamento.</p>';
      setStatus(error.message || 'Não foi possível carregar as formas de pagamento.', true);
    }
  };

  legend.addEventListener('click', event => {
    const button = event.target.closest('[data-payment]');
    if (button) selectPayment(button.dataset.payment);
  });

  loadPayments();
})();
