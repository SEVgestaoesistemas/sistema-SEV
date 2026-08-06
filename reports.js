/* Downloads organization-scoped native Excel reports with an optional period filter. */
(() => {
  const form = document.getElementById('reportFilterForm');
  if (!form) return;

  const startDate = document.getElementById('reportStartDate');
  const endDate = document.getElementById('reportEndDate');
  const status = document.getElementById('reportsStatus');
  const buttons = [...document.querySelectorAll('[data-report]')];
  const labels = {
    sales: 'Relatório de vendas',
    stock: 'Relatório de estoque',
    expenses: 'Relatório de despesas',
    receivables: 'Relatório de contas a receber'
  };
  const buttonLabels = {
    sales: 'Baixar Excel de vendas',
    stock: 'Baixar Excel de estoque',
    expenses: 'Baixar Excel de despesas',
    receivables: 'Baixar Excel de contas'
  };
  const reportRoles = {
    sales: ['owner', 'admin', 'operator'],
    stock: ['owner', 'admin', 'finance', 'inventory', 'operator'],
    expenses: ['owner', 'admin', 'finance'],
    receivables: ['owner', 'admin', 'finance']
  };

  const setStatus = (message = '', isError = false) => {
    status.textContent = message;
    status.classList.toggle('error', isError);
  };

  const validatePeriod = () => {
    if (startDate.value && endDate.value && startDate.value > endDate.value) {
      setStatus('A data final deve ser igual ou posterior à data inicial.', true);
      endDate.focus();
      return false;
    }
    return true;
  };

  window.SevAuth?.ready.then(user => {
    if (!user) return;
    const role = user.organization?.role;
    buttons.forEach(button => {
      button.closest('.report-card').hidden = !reportRoles[button.dataset.report].includes(role);
    });
  });

  buttons.forEach(button => {
    button.addEventListener('click', async () => {
      if (!validatePeriod()) return;
      const report = button.dataset.report;
      button.disabled = true;
      button.textContent = 'Preparando Excel…';
      setStatus(`Preparando ${labels[report].toLowerCase()}…`);
      try {
        await window.SevApi.downloadReport(report, {
          startDate: startDate.value || undefined,
          endDate: endDate.value || undefined
        });
        setStatus(`${labels[report]} baixado com sucesso.`);
      } catch (error) {
        setStatus(error.message || 'Não foi possível preparar este relatório.', true);
      } finally {
        button.disabled = false;
        button.textContent = buttonLabels[report];
      }
    });
  });
})();
