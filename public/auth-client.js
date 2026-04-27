(() => {
  const tokenKey = 'jm-token';
  const userKey = 'jm-user';
  const token = () => localStorage.getItem(tokenKey) || '';
  const login = () => { window.location.href = '/'; };
  window.jmAuth = {
    token,
    user: () => {
      try { return JSON.parse(localStorage.getItem(userKey) || 'null'); } catch (_) { return null; }
    },
    headers: () => token() ? { Authorization: `Bearer ${token()}` } : {},
    logout: async () => {
      try { await fetch('/api/auth/logout', { method: 'POST', headers: window.jmAuth.headers() }); } catch (_) {}
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
      login();
    },
  };

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url && url.startsWith('/api/') && token()) {
      init.headers = { ...(init.headers || {}), Authorization: `Bearer ${token()}` };
    }
    return originalFetch(input, init);
  };

  async function guard() {
    if (!token()) return login();
    try {
      const res = await originalFetch('/api/auth/me', { headers: window.jmAuth.headers() });
      if (!res.ok) throw new Error('expired');
      const data = await res.json();
      localStorage.setItem(userKey, JSON.stringify(data.user));
      document.dispatchEvent(new CustomEvent('jm:user', { detail: data }));
    } catch (_) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem(userKey);
      login();
    }
  }
  guard();
})();
