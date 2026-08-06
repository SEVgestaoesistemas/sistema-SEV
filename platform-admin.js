/* Administração de empresas e validade de planos da plataforma SEV. */
(() => {
  if (!window.SevApi || document.body.dataset.page !== 'plataforma') return;

  const form = document.getElementById('platformCompanyForm');
  const status = document.getElementById('platformCompanyStatus');
  const body = document.getElementById('platformCompaniesBody');
  const summary = document.getElementById('platformCompaniesSummary');
  const refreshButton = document.getElementById('refreshPlatformCompanies');
  const search = document.getElementById('platformCompanySearch');
  const temporaryCard = document.getElementById('temporaryAccessCard');
  const temporaryName = document.getElementById('temporaryAccessName');
  const temporaryEmail = document.getElementById('temporaryAccessEmail');
  const temporaryPassword = document.getElementById('temporaryAccessPassword');
  const temporaryExpiration = document.getElementById('temporaryAccessExpiration');
  const copyPasswordButton = document.getElementById('copyTemporaryPassword');
  const administratorModal = document.getElementById('platformAdministratorModal');
  const administratorForm = document.getElementById('platformAdministratorForm');
  const administratorModalCompany = document.getElementById('platformAdministratorModalCompany');
  const administratorStatus = document.getElementById('platformAdministratorStatus');
  const closeAdministratorModalButton = document.getElementById('closePlatformAdministratorModal');
  const escalationsBody = document.getElementById('platformEscalationsBody');
  const escalationsSummary = document.getElementById('platformEscalationsSummary');
  const refreshEscalationsButton = document.getElementById('refreshPlatformEscalations');
  const supportModal = document.getElementById('platformSupportModal');
  const supportModalCompany = document.getElementById('platformSupportModalCompany');
  const supportModalStatus = document.getElementById('platformSupportModalStatus');
  const supportHistoryBody = document.getElementById('platformSupportHistoryBody');
  const closeSupportModalButton = document.getElementById('closePlatformSupportModal');
  const usersModal = document.getElementById('platformUsersModal');
  const usersModalCompany = document.getElementById('platformUsersModalCompany');
  const usersModalStatus = document.getElementById('platformUsersModalStatus');
  const usersBody = document.getElementById('platformUsersBody');
  const closeUsersModalButton = document.getElementById('closePlatformUsersModal');
  let companies = [];
  let escalations = [];
  let editingCompanyId = null;
  let managedCompanyId = null;
  let managedUsers = [];

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
  const dateTimeLabel = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Não informada';
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo'
    }).format(date);
  };
  const planStatusLabel = statusValue => ({ active: 'Em dia', expired: 'Vencido', not_configured: 'Sem validade' })[statusValue] || 'Sem status';
  const planStatusClass = statusValue => ({ active: 'ok', expired: 'out', not_configured: 'low' })[statusValue] || 'low';
  const showStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle('error', error);
  };
  const findCompany = id => companies.find(company => company.id === id);
  const closeActionMenus = () => {
    document.querySelectorAll('[data-platform-actions-popover]').forEach(popover => { popover.hidden = true; });
    document.querySelectorAll('[data-toggle-actions-menu]').forEach(button => { button.setAttribute('aria-expanded', 'false'); });
  };
  const visibleCompanies = () => {
    const query = search.value.trim().toLocaleLowerCase('pt-BR');
    if (!query) return companies;
    return companies.filter(company => [company.name, company.administrator?.name, company.administrator?.email]
      .filter(Boolean)
      .some(value => value.toLocaleLowerCase('pt-BR').includes(query)));
  };
  const showTemporaryAccess = (administrator, label = 'Acesso temporário criado') => {
    temporaryCard.querySelector('.temporary-access-kicker').textContent = label;
    temporaryName.textContent = administrator.name;
    temporaryEmail.textContent = administrator.email;
    temporaryPassword.value = administrator.temporaryPassword;
    temporaryExpiration.textContent = administrator.temporaryPasswordExpiresAt
      ? `Entregue esta senha ao cliente por um canal seguro. Ela expira em ${dateTimeLabel(administrator.temporaryPasswordExpiresAt)} e não poderá ser consultada novamente.`
      : 'Entregue esta senha ao cliente por um canal seguro. Ela não poderá ser consultada novamente.';
    temporaryCard.hidden = false;
    temporaryCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };
  const closeAdministratorModal = () => {
    administratorModal.hidden = true;
    administratorStatus.textContent = '';
    administratorStatus.classList.remove('error');
    editingCompanyId = null;
  };
  const openAdministratorModal = company => {
    if (!company?.administrator) return;
    editingCompanyId = company.id;
    administratorModalCompany.textContent = company.name;
    administratorForm.elements.administratorName.value = company.administrator.name;
    administratorForm.elements.administratorEmail.value = company.administrator.email;
    administratorModal.hidden = false;
    administratorForm.elements.administratorName.focus();
  };
  const closeSupportModal = () => {
    supportModal.hidden = true;
    supportModalStatus.textContent = '';
  };
  const renderSupportHistory = conversations => {
    supportHistoryBody.innerHTML = conversations.length ? conversations.map(conversation => `
      <tr>
        <td>${escapeHtml(conversation.userName || 'Usuário removido')}</td>
        <td class="platform-support-text">${escapeHtml(conversation.question)}</td>
        <td class="platform-support-text">${escapeHtml(conversation.answer)}</td>
        <td>${dateTimeLabel(conversation.createdAt)}</td>
      </tr>`).join('') : '<tr><td class="empty-table" colspan="4">Esta empresa ainda não possui conversas registradas.</td></tr>';
  };
  const openSupportHistory = async company => {
    if (!company) return;
    supportModalCompany.textContent = company.name;
    supportModalStatus.textContent = 'Carregando histórico da empresa…';
    supportHistoryBody.innerHTML = '<tr><td class="empty-table" colspan="4">Carregando…</td></tr>';
    supportModal.hidden = false;
    try {
      const result = await window.SevApi.getPlatformCompanySupportConversations(company.id);
      supportModalCompany.textContent = result.company.name;
      supportModalStatus.textContent = `${result.conversations.length} conversa${result.conversations.length === 1 ? '' : 's'} mais recente${result.conversations.length === 1 ? '' : 's'}.`;
      renderSupportHistory(result.conversations);
    } catch (error) {
      supportModalStatus.textContent = error.message || 'Não foi possível carregar o histórico de suporte.';
      supportHistoryBody.innerHTML = '<tr><td class="empty-table" colspan="4">Não foi possível carregar as conversas.</td></tr>';
    }
  };
  const roleLabel = role => ({
    owner: 'Proprietário', admin: 'Administrador', finance: 'Financeiro', inventory: 'Estoque', operator: 'Operacional'
  })[role] || role;
  const closeUsersModal = () => {
    usersModal.hidden = true;
    usersModalStatus.textContent = '';
    usersModalStatus.classList.remove('error');
    managedCompanyId = null;
    managedUsers = [];
  };
  const renderUsers = () => {
    usersBody.innerHTML = managedUsers.length ? managedUsers.map(user => {
      const pendingPassword = user.passwordChangeRequired
        ? `<small>Senha temporária até ${dateTimeLabel(user.temporaryPasswordExpiresAt)}</small>`
        : '<small>Senha regular</small>';
      const accountStatus = user.isActive ? pendingPassword : '<small>Conta inativa</small>';
      const disabled = user.isPlatformAdministrator || !user.isActive ? 'disabled' : '';
      const protectedNote = user.isPlatformAdministrator ? '<small>Conta da plataforma protegida</small>' : '';
      return `
        <tr>
          <td><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.email)}</small></td>
          <td>${escapeHtml(roleLabel(user.role))}</td>
          <td>${accountStatus}${protectedNote}</td>
          <td><button class="secondary-button" type="button" data-reset-company-user="${user.id}" ${disabled}>Gerar senha temporária</button></td>
        </tr>`;
    }).join('') : '<tr><td class="empty-table" colspan="4">Nenhum usuário encontrado nesta empresa.</td></tr>';
  };
  const openUsersModal = async company => {
    managedCompanyId = company.id;
    usersModalCompany.textContent = company.name;
    usersModalStatus.textContent = 'Carregando usuários…';
    usersModalStatus.classList.remove('error');
    usersBody.innerHTML = '<tr><td class="empty-table" colspan="4">Carregando…</td></tr>';
    usersModal.hidden = false;
    try {
      const result = await window.SevApi.getPlatformCompanyUsers(company.id);
      if (managedCompanyId !== company.id) return;
      usersModalCompany.textContent = result.company.name;
      managedUsers = result.users;
      usersModalStatus.textContent = `${managedUsers.length} usuário${managedUsers.length === 1 ? '' : 's'} cadastrado${managedUsers.length === 1 ? '' : 's'}.`;
      usersModalStatus.classList.remove('error');
      renderUsers();
    } catch (error) {
      usersModalStatus.textContent = error.message || 'Não foi possível carregar os usuários.';
      usersBody.innerHTML = '<tr><td class="empty-table" colspan="4">Não foi possível carregar os usuários.</td></tr>';
    }
  };
  const renderEscalations = () => {
    escalationsSummary.textContent = escalations.length
      ? `${escalations.length} encaminhamento${escalations.length === 1 ? '' : 's'} mais recente${escalations.length === 1 ? '' : 's'} para acompanhamento.`
      : 'Nenhum encaminhamento para atendimento humano.';
    escalationsBody.innerHTML = escalations.length ? escalations.map(escalation => `
      <tr>
        <td><strong>${escapeHtml(escalation.companyName)}</strong></td>
        <td class="platform-support-text">${escapeHtml(escalation.question)}</td>
        <td>${escapeHtml(escalation.userName || 'Usuário removido')}</td>
        <td>${dateTimeLabel(escalation.createdAt)}</td>
      </tr>`).join('') : '<tr><td class="empty-table" colspan="4">Nenhum encaminhamento encontrado.</td></tr>';
  };
  const loadEscalations = async () => {
    escalationsSummary.textContent = 'Carregando encaminhamentos…';
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      escalations = await window.SevApi.getPlatformSupportEscalations();
      renderEscalations();
    } catch (error) {
      escalationsSummary.textContent = error.message || 'Não foi possível carregar os encaminhamentos.';
      escalationsBody.innerHTML = '<tr><td class="empty-table" colspan="4">Não foi possível carregar os dados.</td></tr>';
    }
  };

  const render = () => {
    const visible = visibleCompanies();
    const active = companies.filter(company => company.planStatus === 'active' && !company.isSuspended).length;
    const suspended = companies.filter(company => company.isSuspended).length;
    const expired = companies.filter(company => company.planStatus === 'expired' && !company.isSuspended).length;
    const filtered = visible.length !== companies.length ? ` · ${visible.length} exibida${visible.length === 1 ? '' : 's'}` : '';
    summary.textContent = `${companies.length} empresa${companies.length === 1 ? '' : 's'} cadastrada${companies.length === 1 ? '' : 's'} · ${active} em dia · ${expired} vencida${expired === 1 ? '' : 's'} · ${suspended} suspensa${suspended === 1 ? '' : 's'}${filtered}`;
    body.innerHTML = visible.length ? visible.map(company => {
      const protectedAccount = company.containsPlatformAdmin;
      const accountStatus = company.isSuspended
        ? '<span class="badge out">Suspensa</span>'
        : `<span class="badge ${planStatusClass(company.planStatus)}">${planStatusLabel(company.planStatus)}</span>`;
      const protectedMessage = protectedAccount ? '<small class="platform-protected-note">Conta da plataforma protegida</small>' : '';
      return `
        <tr>
          <td><strong>${escapeHtml(company.name)}</strong><small>Criada em ${dateLabel(company.createdAt)}</small></td>
          <td>${company.administrator ? `<strong>${escapeHtml(company.administrator.name)}</strong><small>${escapeHtml(company.administrator.email)}</small>` : '—'}</td>
          <td>${dateLabel(company.planExpiresAt)}</td>
          <td><div class="platform-status-stack">${accountStatus}${company.isSuspended ? `<small>Plano: ${planStatusLabel(company.planStatus)}</small>` : ''}</div></td>
          <td><div class="plan-update-control"><input data-plan-date="${company.id}" type="date" value="${escapeHtml(dateOnly(company.planExpiresAt))}" aria-label="Nova validade para ${escapeHtml(company.name)}"><button class="secondary-button" type="button" data-save-plan="${company.id}">Salvar</button></div></td>
          <td><div class="platform-actions-cell">
            <button class="platform-access-toggle${company.isSuspended ? ' is-suspended' : ''}" type="button" role="switch" aria-checked="${String(!company.isSuspended)}" aria-label="${company.isSuspended ? 'Reativar' : 'Suspender'} acesso de ${escapeHtml(company.name)}" data-toggle-suspension="${company.id}">
              <span class="platform-toggle-track" aria-hidden="true"><span></span></span><span class="platform-toggle-label">${company.isSuspended ? 'Suspenso' : 'Ativo'}</span>
            </button>
            <div class="platform-actions-menu">
              <button class="platform-actions-trigger" type="button" aria-label="Mais ações para ${escapeHtml(company.name)}" aria-haspopup="menu" aria-controls="platform-actions-${company.id}" aria-expanded="false" data-toggle-actions-menu="${company.id}"><span aria-hidden="true">⋮</span></button>
              <div class="platform-actions-popover" id="platform-actions-${company.id}" role="menu" data-platform-actions-popover hidden>
                <button type="button" role="menuitem" data-edit-administrator="${company.id}" ${protectedAccount ? 'disabled' : ''}>Editar responsável</button>
                <button type="button" role="menuitem" data-reset-password="${company.id}" ${protectedAccount ? 'disabled' : ''}>Gerar nova senha</button>
                <button type="button" role="menuitem" data-manage-users="${company.id}">Gerenciar usuários</button>
                <button type="button" role="menuitem" data-view-support-history="${company.id}">Ver conversas do suporte</button>
                <div class="platform-actions-divider" role="separator"></div>
                <button class="platform-delete-button" type="button" role="menuitem" data-delete-company="${company.id}" ${protectedAccount ? 'disabled' : ''}><span class="platform-menu-trash" aria-hidden="true">🗑</span>Excluir permanentemente</button>
                ${protectedMessage}
              </div>
            </div>
          </div></td>
        </tr>`;
    }).join('') : '<tr><td class="empty-table" colspan="6">Nenhuma empresa encontrada.</td></tr>';
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
      body.innerHTML = '<tr><td class="empty-table" colspan="6">Não foi possível carregar os dados.</td></tr>';
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
      showTemporaryAccess(result.administrator);
      showStatus('Empresa criada com sucesso. Guarde a senha temporária agora.');
    } catch (error) {
      showStatus(error.message || 'Não foi possível criar a empresa.', true);
    } finally {
      submit.disabled = false;
      submit.textContent = 'Criar empresa';
    }
  });

  body.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const id = button.dataset.toggleActionsMenu || button.dataset.savePlan || button.dataset.editAdministrator || button.dataset.resetPassword || button.dataset.manageUsers || button.dataset.toggleSuspension || button.dataset.deleteCompany || button.dataset.viewSupportHistory;
    if (!id) return;
    const company = findCompany(id);
    if (!company) return;

    if (button.dataset.toggleActionsMenu) {
      const popover = document.getElementById(`platform-actions-${id}`);
      const willOpen = Boolean(popover?.hidden);
      closeActionMenus();
      if (popover) popover.hidden = !willOpen;
      button.setAttribute('aria-expanded', String(willOpen));
      return;
    }

    closeActionMenus();

    if (button.dataset.viewSupportHistory) {
      openSupportHistory(company);
      return;
    }

    if (button.dataset.manageUsers) {
      openUsersModal(company);
      return;
    }

    if (button.dataset.savePlan) {
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
        companies = companies.map(item => item.id === id ? updated : item);
        render();
      } catch (error) {
        window.alert(error.message || 'Não foi possível atualizar a validade.');
        button.disabled = false;
        button.textContent = 'Salvar';
      }
      return;
    }

    if (button.dataset.editAdministrator) {
      openAdministratorModal(company);
      return;
    }

    if (button.dataset.resetPassword) {
      if (!window.confirm(`Gerar uma nova senha temporária para ${company.administrator?.name || 'o responsável'}? Todas as sessões dessa pessoa serão encerradas.`)) return;
      button.disabled = true;
      button.textContent = 'Gerando…';
      try {
        const result = await window.SevApi.resetPlatformCompanyPassword(id);
        companies = companies.map(item => item.id === id ? result.company : item);
        render();
        showTemporaryAccess(result.administrator, 'Nova senha temporária gerada');
      } catch (error) {
        window.alert(error.message || 'Não foi possível gerar uma nova senha.');
        button.disabled = false;
        button.textContent = 'Nova senha';
      }
      return;
    }

    if (button.dataset.toggleSuspension) {
      const nextSuspension = !company.isSuspended;
      const message = nextSuspension
        ? `Suspender ${company.name}? Os dados serão preservados, mas o acesso da empresa será bloqueado imediatamente.`
        : `Reativar ${company.name}? O acesso voltará a depender apenas da validade do plano.`;
      if (!window.confirm(message)) return;
      button.disabled = true;
      button.textContent = nextSuspension ? 'Suspendendo…' : 'Reativando…';
      try {
        const updated = await window.SevApi.setPlatformCompanySuspension(id, nextSuspension);
        companies = companies.map(item => item.id === id ? updated : item);
        render();
      } catch (error) {
        window.alert(error.message || 'Não foi possível alterar o acesso da empresa.');
        button.disabled = false;
        button.textContent = nextSuspension ? 'Suspender acesso' : 'Reativar acesso';
      }
      return;
    }

    const confirmationName = window.prompt(`Esta ação excluirá permanentemente a empresa, usuários sem outros vínculos e todos os dados dela.\n\nPara confirmar, digite exatamente: ${company.name}`);
    if (confirmationName === null) return;
    button.disabled = true;
    button.textContent = 'Excluindo…';
    try {
      await window.SevApi.deletePlatformCompany(id, confirmationName);
      companies = companies.filter(item => item.id !== id);
      render();
      showStatus(`${company.name} foi excluída permanentemente.`);
    } catch (error) {
      window.alert(error.message || 'Não foi possível excluir a empresa.');
      button.disabled = false;
      button.textContent = 'Excluir permanentemente';
    }
  });

  administratorForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!administratorForm.reportValidity() || !editingCompanyId) return;
    const button = administratorForm.querySelector('button[type="submit"]');
    const payload = {
      administratorName: administratorForm.elements.administratorName.value.trim(),
      administratorEmail: administratorForm.elements.administratorEmail.value.trim().toLowerCase()
    };
    button.disabled = true;
    button.textContent = 'Salvando…';
    administratorStatus.textContent = '';
    try {
      const updated = await window.SevApi.updatePlatformCompanyAdministrator(editingCompanyId, payload);
      companies = companies.map(item => item.id === editingCompanyId ? updated : item);
      render();
      closeAdministratorModal();
      showStatus('Responsável atualizado com sucesso.');
    } catch (error) {
      administratorStatus.textContent = error.message || 'Não foi possível atualizar o responsável.';
      administratorStatus.classList.add('error');
    } finally {
      button.disabled = false;
      button.textContent = 'Salvar responsável';
    }
  });

  refreshButton.addEventListener('click', loadCompanies);
  refreshEscalationsButton.addEventListener('click', loadEscalations);
  search.addEventListener('input', render);
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
  usersBody.addEventListener('click', async event => {
    const button = event.target.closest('[data-reset-company-user]');
    const userId = button?.dataset.resetCompanyUser;
    if (!userId || !managedCompanyId || button.disabled) return;
    const user = managedUsers.find(item => item.id === userId);
    if (!user) return;
    if (!window.confirm(`Gerar uma nova senha temporária para ${user.name}? Todas as sessões dessa pessoa serão encerradas.`)) return;
    button.disabled = true;
    button.textContent = 'Gerando…';
    usersModalStatus.textContent = '';
    usersModalStatus.classList.remove('error');
    try {
      const result = await window.SevApi.resetPlatformCompanyUserPassword(managedCompanyId, userId);
      managedUsers = managedUsers.map(item => item.id === userId ? {
        ...item,
        passwordChangeRequired: true,
        temporaryPasswordExpiresAt: result.user.temporaryPasswordExpiresAt
      } : item);
      renderUsers();
      showTemporaryAccess(result.user, 'Nova senha temporária gerada');
      usersModalStatus.textContent = `Senha temporária gerada para ${result.user.name}.`;
      usersModalStatus.classList.remove('error');
    } catch (error) {
      usersModalStatus.textContent = error.message || 'Não foi possível gerar a senha temporária.';
      usersModalStatus.classList.add('error');
      button.disabled = false;
      button.textContent = 'Gerar senha temporária';
    }
  });
  closeAdministratorModalButton.addEventListener('click', closeAdministratorModal);
  administratorModal.addEventListener('click', event => { if (event.target === administratorModal) closeAdministratorModal(); });
  closeUsersModalButton.addEventListener('click', closeUsersModal);
  usersModal.addEventListener('click', event => { if (event.target === usersModal) closeUsersModal(); });
  closeSupportModalButton.addEventListener('click', closeSupportModal);
  supportModal.addEventListener('click', event => { if (event.target === supportModal) closeSupportModal(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('.platform-actions-menu')) closeActionMenus();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeAdministratorModal();
      closeUsersModal();
      closeSupportModal();
      closeActionMenus();
    }
  });

  loadCompanies();
  loadEscalations();
})();
