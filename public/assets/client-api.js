(function () {
  const TOKEN_KEY = 'authToken';

  function getToken() {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch (err) {
      console.warn('Unable to read auth token from storage:', err);
      return null;
    }
  }

  function setToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch (err) {
      console.warn('Unable to persist auth token:', err);
    }
  }

  function clearToken() {
    setToken(null);
  }

  async function request(path, options = {}) {
    const { skipRedirect, rawResponse, ...fetchOptions } = options;
    const headers = new Headers(fetchOptions.headers || {});
    let body = fetchOptions.body;

    if (body && !(body instanceof FormData) && typeof body !== 'string') {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(body);
    }

    const token = getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const requestInit = {
      method: fetchOptions.method || 'GET',
      headers
    };

    if (body !== undefined) {
      requestInit.body = body;
    }

    if (fetchOptions.signal) {
      requestInit.signal = fetchOptions.signal;
    }

    const response = await fetch(path, requestInit);
    let data = null;
    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      data = await response.json().catch(() => null);
    } else {
      const text = await response.text();
      data = text || null;
    }

    if (response.status === 401) {
      if (!skipRedirect) {
        clearToken();
        if (window.location.pathname !== '/auth.html') {
          window.location.href = '/auth.html';
        }
      }
      const error = new Error((data && data.error) || 'Unauthorized');
      error.status = response.status;
      error.data = data;
      throw error;
    }

    if (!response.ok) {
      const message = (data && data.error) || response.statusText || 'Request failed';
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return rawResponse ? response : data;
  }

  async function ensureAuthenticated() {
    try {
      const session = await request('/api/auth/session', { skipRedirect: true });
      if (session && session.authenticated) {
        return session;
      }
    } catch (err) {
      // ignore and redirect below
    }
    clearToken();
    if (window.location.pathname !== '/auth.html') {
      window.location.href = '/auth.html';
    }
    throw new Error('Not authenticated');
  }

  async function logout() {
    try {
      await request('/api/auth/logout', { method: 'POST', skipRedirect: true });
    } catch (err) {
      // ignore logout failures
    } finally {
      clearToken();
    }
  }

  window.API = {
    request,
    ensureAuthenticated,
    getToken,
    setToken,
    clearToken,
    logout
  };
})();
