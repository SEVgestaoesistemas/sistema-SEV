/* Administração de empresas e validade de planos da plataforma SEV. */
(() => {
  if (!window.SevApi || document.body.dataset.page !== 'plataforma') return;

  const form = document.getElementById('platformCompanyForm');
  const status = document.getElementById('platformCompanyStatus');
  const body = document.getElementById('platformCompaniesBody');
  const summary = document.getElementById('platformCompaniesSummary');
  const refreshButton = document.getElementById('refreshPlatformCompanies');
  const temporaryCard = document.getElementById('temporaryAccessCard');
  const temporaryName = document.getElementById('temporaryAccessName');
  const temporaryEmail = document.getElementById('temporaryAccessEmail');
  const temporaryPassword = document.getElementById('temporaryAccessPassword');
  const copyPasswordButton = document.getElementById('copyTemporaryPassword');
  let companies = [];

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const dateOnly = value => {
    const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : '';
  };
  const dateLabel = value => {
    const date = dateOnly(value);
    if (!date) return 'Não definida';
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}`;
  };
  const statusLabel = statusValue => ({ active: 'Em dia', expired: 'Vencido', not_configured: 'Sem validade' })[statusValue] || 'Sem status';
  const statusClass = statusValue => ({ active: 'ok', expired: 'out', not_configured: 'low' })[statusValue] || 'low';
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };

  const render = () => {
    const active = companies.filter(company => company.planStatus === 'active').length;
    const expired = companies.filter(company => company.planStatus === 'expired').length;
    summary.textContent = `${companies.length} empresa${companies.length === 1 ? '' : 's'} cadastrada${companies.length === 1 ? '' : 's'} · ${active} em dia · ${expired} vencida${expired === 1 ? '' : 's'}`;
    body.innerHTML = companies.length ? companies.map(company => `
      <tr>
        <td><strong>${escapeHtml(company.name)}</strong><small>Criada em ${dateLabel(company.createdAt)}</small></td>
        <td>${company.administrator ? `<strong>${escapeHtml(company.administrator.name)}</strong><small>${escapeHtml(company.administrator.email)}</small>` : '—'}</td>
        <td>${dateLabel(company.planExpiresAt)}</td>
        <td><span class="badge ${statusClass(company.planStatus)}">${statusLabel(company.planStatus)}</span></td>
        <td><div class="plan-update-control"><input data-plan-date="${company.id}" type="date" value="${escapeHtml(dateOnly(company.planExpiresAt))}" aria-label="Nova validade para ${escapeHtml(company.name)}"><button class="secondary-button" type="button" data-save-plan="${company.id}">Salvar</button></div></td>
      </tr>`).join('') : '<tr><td class="empty-table" colspan="5">Nenhuma empresa cadastrada.</td></tr>';
  };

  const loadCompanies = async () => {
    summary.textContent = 'Carregando empresas…';
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      companies = await window.SevApi.getPlatformCompanies();
      render();
    } catch (error) {
      summary.textContent = error.message || 'Não foi possível carregar as empresas.';
      body.innerHTML = '<tr><td class="empty-table" colspan="5">Não foi possível carregar os dados.</td></tr>';
    }
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const submit = form.querySelector('button[type="submit"]');
    const payload = {
      companyName: form.elements.companyName.value.trim(),
      administratorName: form.elements.administratorName.value.trim(),
      administratorEmail: form.elements.administratorEmail.value.trim().toLowerCase(),
      planExpiresAt: form.elements.planExpiresAt.value
    };
    submit.disabled = true;
    submit.textContent = 'Criando…';
    showStatus('');
    try {
      const result = await window.SevApi.createPlatformCompany(payload);
      companies = [result.company, ...companies];
      render();
      form.reset();
      temporaryName.textContent = result.administrator.name;
      temporaryEmail.textContent = result.administrator.email;
      temporaryPassword.value = result.administrator.temporaryPassword;
      temporaryCard.hidden = false;
      showStatus('Empresa criada com sucesso. Guarde a senha temporária agora.');
    } catch (error) {
      showStatus(error.message || 'Não foi possível criar a empresa.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Criar empresa';
    }
  });

  body.addEventListener('click', async event => {
    const button = event.target.closest('[data-save-plan]');
    if (!button) return;
    const id = button.dataset.savePlan;
    const input = body.querySelector(`[data-plan-date="${id}"]`);
    if (!input?.value) {
      window.alert('Informe uma data de validade para salvar.');
      input?.focus();
      return;
    }
    button.disabled = true;
    button.textContent = 'Salvando…';
    try {
      const updated = await window.SevApi.updatePlatformCompanyPlan(id, input.value);
      companies = companies.map(company => company.id === id ? { ...company, ...updated } : company);
      render();
    } catch (error) {
      window.alert(error.message || 'Não foi possível atualizar a validade.');
      button.disabled = false;
      button.textContent = 'Salvar';
    }
  });

  refreshButton.addEventListener('click', loadCompanies);
  copyPasswordButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(temporaryPassword.value);
      copyPasswordButton.textContent = 'Senha copiada';
      window.setTimeout(() => { copyPasswordButton.textContent = 'Copiar senha'; }, 1800);
    } catch {
      temporaryPassword.focus();
      temporaryPassword.select();
      window.alert('Copie a senha selecionada manualmente.');
    }
  });

  loadCompanies();
})();
