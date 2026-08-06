/* Shared browser client for the SEV production API. */
(() => {
  const API_BASE_URL = 'https://sev-api-7j7b.onrender.com/api/v1';
  const csrfStorageKey = 'sev.csrf.v1';
  let csrfToken = null;

  const fallbackMessages = {
    VALIDATION_ERROR: 'Verifique os campos preenchidos e tente novamente.',
    BAD_REQUEST: 'Revise os dados informados e tente novamente.',
    INVALID_CREDENTIALS: 'E-mail ou senha incorretos. Confira os dados e tente novamente.',
    INVALID_CURRENT_PASSWORD: 'A senha atual está incorreta. Confira-a e tente novamente.',
    CONFLICT: 'Este dado já existe ou foi alterado por outra pessoa. Atualize a tela e tente novamente.',
    FORBIDDEN: 'Sua conta não tem permissão para realizar esta ação.',
    UNAUTHENTICATED: 'Sua sessão expirou. Entre novamente para continuar.',
    CSRF_REJECTED: 'A confirmação de segurança expirou. Atualize a página e tente novamente.',
    NOT_FOUND: 'O item solicitado não foi encontrado.',
    RATE_LIMITED: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos antes de tentar novamente.',
    SERVICE_UNAVAILABLE: 'Este serviço está temporariamente indisponível. Tente novamente em alguns minutos.',
    EMAIL_DELIVERY_UNAVAILABLE: 'A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.',
    MANUAL_PASSWORD_RESET_REQUIRED: 'Para redefinir a senha, fale com o suporte da SEV.',
    TEMPORARY_PASSWORD_EXPIRED: 'A senha temporária expirou. Fale com o suporte para receber uma nova senha.',
    INTERNAL_ERROR: 'O servidor encontrou um problema temporário. Nenhuma alteração foi confirmada; tente novamente em alguns minutos.',
    INVALID_PASSWORD_RESET_TOKEN: 'Este link de recuperação é inválido ou expirou. Solicite um novo link.',
    PLAN_EXPIRED: 'O plano desta empresa expirou. Entre em contato com a SEV para regularizar o acesso.',
    COMPANY_SUSPENDED: 'O acesso desta empresa está suspenso. Entre em contato com a SEV para regularizar.'
  };

  try {
    csrfToken = sessionStorage.getItem(csrfStorageKey);
  } catch {
    // The token remains available for the current page when browser storage is unavailable.
  }

  const saveCsrfToken = token => {
    csrfToken = token || null;
    try {
      if (csrfToken) sessionStorage.setItem(csrfStorageKey, csrfToken);
      else sessionStorage.removeItem(csrfStorageKey);
    } catch {
      // A session can still work without sessionStorage while this page stays open.
    }
  };

  const clearSessionState = () => saveCsrfToken(null);

  const messageForResponse = (response, data, fallback) => {
    const code = data?.error?.code;
    const serverMessage = data?.error?.message;
    if (fallbackMessages[code]) return fallbackMessages[code];
    if (serverMessage) return serverMessage;
    if (response?.status === 429) return fallbackMessages.RATE_LIMITED;
    if (response?.status >= 500) return fallbackMessages.INTERNAL_ERROR;
    if (response?.status === 404) return fallbackMessages.NOT_FOUND;
    if (response?.status === 403) return fallbackMessages.FORBIDDEN;
    return serverMessage || fallback;
  };

  const createApiError = (message, response, data) => {
    const error = new Error(message);
    error.name = 'SevApiError';
    error.status = response?.status || 0;
    error.code = data?.error?.code || 'REQUEST_FAILED';
    error.retryAfterSeconds = Number(response?.headers?.get('retry-after')) || null;
    return error;
  };

  const readResponse = async response => {
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      const message = messageForResponse(response, data, 'Não foi possível concluir a solicitação.');
      const error = createApiError(message, response, data);
      if (error.status === 401) {
        clearSessionState();
        window.dispatchEvent(new CustomEvent('sev:unauthenticated'));
      }
      throw error;
    }

    return data;
  };

  const request = async (path, { method = 'GET', body, csrf = false } = {}) => {
    const headers = new Headers({ Accept: 'application/json' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    if (csrf) {
      const token = await getCsrfToken();
      headers.set('X-CSRF-Token', token);
    }

    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        credentials: 'include',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch {
      throw createApiError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    }

    return readResponse(response);
  };

  const downloadFile = async (path, fileName) => {
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      });
    } catch {
      throw createApiError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.');
    }
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const data = contentType.includes('application/json') ? await response.json() : null;
      const error = createApiError(messageForResponse(response, data, 'Não foi possível preparar o relatório.'), response, data);
      if (error.status === 401) {
        clearSessionState();
        window.dispatchEvent(new CustomEvent('sev:unauthenticated'));
      }
      throw error;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const queryString = parameters => {
    const query = new URLSearchParams();
    Object.entries(parameters || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const serialized = query.toString();
    return serialized ? `?${serialized}` : '';
  };

  const getCsrfToken = async () => {
    if (csrfToken) return csrfToken;
    const data = await request('/auth/csrf', { method: 'POST' });
    saveCsrfToken(data.csrfToken);
    return csrfToken;
  };

  const applyAuthenticatedSession = data => {
    saveCsrfToken(data.csrfToken);
    window.dispatchEvent(new CustomEvent('sev:authenticated', { detail: data.user }));
    return data.user;
  };

  window.SevApi = Object.freeze({
    baseUrl: API_BASE_URL,
    request,
    getCurrentUser: () => request('/auth/me'),
    getManualPasswordResetContact: () => request('/public/support-contact'),
    login: async credentials => applyAuthenticatedSession(await request('/auth/login', {
      method: 'POST',
      body: credentials
    })),
    requestPasswordReset: async email => request('/auth/password/reset', {
      method: 'POST',
      body: { email }
    }),
    confirmPasswordReset: async reset => request('/auth/password/reset/confirm', {
      method: 'POST',
      body: reset
    }),
    register: async account => applyAuthenticatedSession(await request('/auth/register', {
      method: 'POST',
      body: account
    })),
    acceptInvitation: async invitation => applyAuthenticatedSession(await request('/auth/invitations/accept', {
      method: 'POST',
      body: invitation
    })),
    logout: async () => {
      try {
        await request('/auth/logout', { method: 'POST', csrf: true });
      } finally {
        clearSessionState();
      }
    },
    changePassword: async password => request('/auth/password/change', {
      method: 'POST',
      body: password,
      csrf: true
    }),
    getProfile: async () => (await request('/profile')).profile,
    updateProfile: async profile => (await request('/profile', {
      method: 'PATCH',
      body: profile,
      csrf: true
    })).profile,
    bootstrapPlatformAdmin: async payload => (await request('/platform/bootstrap', {
      method: 'POST',
      body: payload
    })).administrator,
    getPlatformCompanies: async () => (await request('/platform/companies')).companies,
    getPlatformCompanyUsers: id => request(`/platform/companies/${encodeURIComponent(id)}/users`),
    createPlatformCompany: async company => request('/platform/companies', {
      method: 'POST',
      body: company,
      csrf: true
    }),
    updatePlatformCompanyPlan: async (id, planExpiresAt) => (await request(`/platform/companies/${encodeURIComponent(id)}/plan`, {
      method: 'PATCH',
      body: { planExpiresAt },
      csrf: true
    })).company,
    setPlatformCompanySuspension: async (id, suspended) => (await request(`/platform/companies/${encodeURIComponent(id)}/suspension`, {
      method: 'PATCH',
      body: { suspended },
      csrf: true
    })).company,
    updatePlatformCompanyAdministrator: async (id, administrator) => (await request(`/platform/companies/${encodeURIComponent(id)}/administrator`, {
      method: 'PATCH',
      body: administrator,
      csrf: true
    })).company,
    resetPlatformCompanyPassword: async id => request(`/platform/companies/${encodeURIComponent(id)}/temporary-password`, {
      method: 'POST',
      csrf: true
    }),
    resetPlatformCompanyUserPassword: async (companyId, userId) => request(
      `/platform/companies/${encodeURIComponent(companyId)}/users/${encodeURIComponent(userId)}/temporary-password`,
      { method: 'POST', csrf: true }
    ),
    deletePlatformCompany: async (id, confirmationName) => request(`/platform/companies/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      body: { confirmationName },
      csrf: true
    }),
    getPlatformCompanySupportConversations: async id => request(`/platform/companies/${encodeURIComponent(id)}/support/conversations`),
    getPlatformSupportEscalations: async () => (await request('/platform/support/escalations')).escalations,
    getSettings: async () => (await request('/settings')).settings,
    updateSettings: async settings => (await request('/settings', {
      method: 'PATCH',
      body: settings,
      csrf: true
    })).settings,
    getTeam: async () => (await request('/team')).members,
    createTeamInvitation: async invitation => (await request('/team/invitations', {
      method: 'POST',
      body: invitation,
      csrf: true
    })).invitation,
    updateTeamMemberRole: async (id, role) => (await request(`/team/members/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { role },
      csrf: true
    })).member,
    getProducts: async () => (await request('/products')).products,
    createProduct: async product => (await request('/products', {
      method: 'POST',
      body: product,
      csrf: true
    })).product,
    getCustomers: async parameters => (await request(`/customers${queryString(parameters)}`)).customers,
    createCustomer: async customer => (await request('/customers', {
      method: 'POST',
      body: customer,
      csrf: true
    })).customer,
    getSales: async parameters => (await request(`/sales${queryString(parameters)}`)).sales,
    createSale: async sale => (await request('/sales', {
      method: 'POST',
      body: sale,
      csrf: true
    })).sale,
    getSalesDashboard: async () => (await request('/sales/dashboard')).dashboard,
    getFinanceDashboard: async () => (await request('/finance/dashboard')).dashboard,
    getDashboardOverview: async () => (await request('/dashboard/overview')).dashboard,
    downloadReport: async (report, period) => {
      const reportFileLabels = {
        sales: 'vendas',
        stock: 'estoque',
        expenses: 'despesas',
        receivables: 'contas-a-receber'
      };
      const suffix = period?.startDate || period?.endDate
        ? `-${period?.startDate || 'inicio'}-a-${period?.endDate || 'hoje'}`
        : '-todos-os-periodos';
      const fileLabel = reportFileLabels[report] || 'dados';
      return downloadFile(`/reports/${encodeURIComponent(report)}.xlsx${queryString(period)}`, `sev-relatorio-${fileLabel}${suffix}.xlsx`);
    },
    getReceivables: async parameters => (await request(`/receivables${queryString(parameters)}`)).receivables,
    getReceivablesDashboard: async () => (await request('/receivables/dashboard')).dashboard,
    markReceivablePaid: async id => (await request(`/receivables/${encodeURIComponent(id)}/mark-paid`, {
      method: 'PATCH',
      csrf: true
    })).receivable,
    getExpenses: async parameters => (await request(`/expenses${queryString(parameters)}`)).expenses,
    parseNfeXml: async invoice => (await request('/expenses/parse-nfe-xml', {
      method: 'POST',
      body: invoice,
      csrf: true
    })).invoice,
    createExpense: async expense => (await request('/expenses', {
      method: 'POST',
      body: expense,
      csrf: true
    })).expense,
    getNotifications: async () => (await request('/notifications')).notifications,
    markNotificationRead: async id => (await request(`/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      csrf: true
    })).notification,
    markAllNotificationsRead: async () => request('/notifications/read-all', {
      method: 'POST',
      csrf: true
    }),
    sendSupportMessage: async message => request('/support/chat', {
      method: 'POST',
      body: { message },
      csrf: true
    })
  });
})();
