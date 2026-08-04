/* Shared browser client for the SEV production API. */
(() => {
  const API_BASE_URL = 'https://sev-api-7j7b.onrender.com/api/v1';
  const csrfStorageKey = 'sev.csrf.v1';
  let csrfToken = null;

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

  const createApiError = (message, response, data) => {
    const error = new Error(message);
    error.name = 'SevApiError';
    error.status = response?.status || 0;
    error.code = data?.error?.code || 'REQUEST_FAILED';
    return error;
  };

  const readResponse = async response => {
    if (response.status === 204) return null;

    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await response.json() : null;

    if (!response.ok) {
      const message = data?.error?.message || 'Não foi possível concluir a solicitação.';
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
    login: async credentials => applyAuthenticatedSession(await request('/auth/login', {
      method: 'POST',
      body: credentials
    })),
    register: async account => applyAuthenticatedSession(await request('/auth/register', {
      method: 'POST',
      body: account
    })),
    logout: async () => {
      try {
        await request('/auth/logout', { method: 'POST', csrf: true });
      } finally {
        clearSessionState();
      }
    },
    getProducts: async () => (await request('/products')).products,
    createProduct: async product => (await request('/products', {
      method: 'POST',
      body: product,
      csrf: true
    })).product
  });
})();
