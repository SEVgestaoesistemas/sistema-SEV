/* Shared notification center. Notification content is demonstrative until the API is connected. */
(() => {
  const button = document.getElementById('notificationButton');
  const panel = document.getElementById('notificationPanel');
  const dot = document.getElementById('notificationDot');
  const summary = document.getElementById('notificationSummary');
  const list = document.getElementById('notificationList');
  const markAllRead = document.getElementById('markNotificationsRead');
  if (!button || !panel || !dot || !summary || !list || !markAllRead) return;

  const storageKey = 'cerne.notifications.v1';
  const stockStorageKey = 'cerne.stock.v1';
  const fallbackStock = [
    { id: 'fone-bluetooth', name: 'Fone bluetooth', quantity: 150, minimum: 30 },
    { id: 'mochila-urbana', name: 'Mochila urbana', quantity: 75, minimum: 25 },
    { id: 'luminaria-led', name: 'Luminária LED', quantity: 20, minimum: 50 },
    { id: 'teclado-mecanico', name: 'Teclado mecânico', quantity: 0, minimum: 10 }
  ];
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const readStoredNotifications = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey));
      if (!Array.isArray(stored)) return [];
      return stored.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.message === 'string' && typeof item.time === 'string');
    } catch {
      return [];
    }
  };
  const readStock = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(stockStorageKey));
      if (!Array.isArray(stored)) return fallbackStock;
      const validProducts = stored.filter(product => product && typeof product.id === 'string' && typeof product.name === 'string' && Number.isSafeInteger(product.quantity) && product.quantity >= 0 && Number.isSafeInteger(product.minimum) && product.minimum >= 0);
      return validProducts.length ? validProducts : fallbackStock;
    } catch {
      return fallbackStock;
    }
  };
  const buildStockAlerts = () => readStock().filter(product => product.quantity <= product.minimum).map(product => ({
    id: `stock-${product.id}`,
    title: product.quantity === 0 ? 'Produto esgotado' : 'Estoque baixo',
    message: product.quantity === 0 ? `${product.name} não possui unidades em estoque.` : `${product.name} tem ${product.quantity} unidade${product.quantity === 1 ? '' : 's'} disponível${product.quantity === 1 ? '' : 'is'}.`,
    time: 'Atualizado agora'
  }));
  const readNotifications = () => {
    const readState = new Map(readStoredNotifications().map(notification => [notification.id, notification.unread]));
    return buildStockAlerts().map(notification => ({
      ...notification,
      unread: readState.has(notification.id) ? Boolean(readState.get(notification.id)) : true
    }));
  };
  let notifications = readNotifications();

  const persist = () => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(notifications));
      return true;
    } catch {
      return false;
    }
  };
  const render = () => {
    const unreadCount = notifications.filter(notification => notification.unread).length;
    const unreadLabel = `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}`;
    button.setAttribute('aria-label', `Notificações: ${unreadLabel}`);
    dot.hidden = unreadCount === 0;
    summary.textContent = unreadLabel;
    markAllRead.disabled = unreadCount === 0;
    list.innerHTML = notifications.length ? notifications.map(notification => `
      <li class="notification-item${notification.unread ? ' unread' : ''}">
        <span class="notification-marker" aria-hidden="true"></span>
        <span><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.message)}</small><time>${escapeHtml(notification.time)}</time></span>
      </li>`).join('') : '<li class="notification-empty">Não há alertas de estoque no momento.</li>';
  };
  const closePanel = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
  });
  markAllRead.addEventListener('click', () => {
    notifications = notifications.map(notification => ({ ...notification, unread: false }));
    persist();
    render();
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !event.target.closest('.notification-wrap')) closePanel();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  window.addEventListener('cerne:stock-updated', () => {
    notifications = readNotifications();
    render();
  });
  render();
})();
