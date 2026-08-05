/* Notification center backed by the SEV API. */
(() => {
  const button = document.getElementById('notificationButton');
  const panel = document.getElementById('notificationPanel');
  const dot = document.getElementById('notificationDot');
  const summary = document.getElementById('notificationSummary');
  const list = document.getElementById('notificationList');
  const markAllRead = document.getElementById('markNotificationsRead');
  if (!button || !panel || !dot || !summary || !list || !markAllRead || !window.SevApi) return;

  const escapeHtml = value => String(value).replace(/[&<>'"]/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[character]);
  const formatTime = value => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Agora';
    const difference = Date.now() - date.getTime();
    const minutes = Math.floor(difference / 60000);
    if (minutes < 1) return 'Agora';
    if (minutes < 60) return `${minutes} min atrás`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} h atrás`;
    return date.toLocaleDateString('pt-BR');
  };

  let notifications = [];
  let loading = true;
  let loadError = '';

  const render = () => {
    const unreadCount = notifications.filter(notification => !notification.readAt).length;
    const unreadLabel = `${unreadCount} não lida${unreadCount === 1 ? '' : 's'}`;
    button.setAttribute('aria-label', `Notificações: ${unreadLabel}`);
    dot.hidden = unreadCount === 0;
    summary.textContent = unreadLabel;
    markAllRead.disabled = loading || unreadCount === 0;

    if (loading) {
      list.innerHTML = '<li class="notification-empty">Carregando notificações…</li>';
      return;
    }
    if (loadError) {
      list.innerHTML = `<li class="notification-empty">${escapeHtml(loadError)}</li>`;
      return;
    }
    list.innerHTML = notifications.length ? notifications.map(notification => {
      const unread = !notification.readAt;
      const action = unread ? 'Marcar como lida' : 'Notificação lida';
      return `<li class="notification-item${unread ? ' unread' : ''}" data-notification-id="${escapeHtml(notification.id)}"${unread ? ' role="button" tabindex="0"' : ''} aria-label="${action}: ${escapeHtml(notification.title)}"><span class="notification-marker" aria-hidden="true"></span><span><strong>${escapeHtml(notification.title)}</strong><small>${escapeHtml(notification.message)}</small><time datetime="${escapeHtml(notification.createdAt)}">${escapeHtml(formatTime(notification.createdAt))}</time></span></li>`;
    }).join('') : '<li class="notification-empty">Não há notificações no momento.</li>';
  };

  const loadNotifications = async () => {
    loading = true;
    loadError = '';
    render();
    try {
      const user = await window.SevAuth.ready;
      if (!user) return;
      notifications = await window.SevApi.getNotifications();
    } catch (error) {
      loadError = error.message || 'Não foi possível carregar as notificações.';
    } finally {
      loading = false;
      render();
    }
  };

  const markAsRead = async id => {
    const notification = notifications.find(item => item.id === id);
    if (!notification || notification.readAt) return;

    const previous = notifications;
    notifications = notifications.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item);
    render();
    try {
      const result = await window.SevApi.markNotificationRead(id);
      if (!result) await loadNotifications();
    } catch (error) {
      notifications = previous;
      render();
    }
  };

  const closePanel = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };

  button.addEventListener('click', () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    button.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) loadNotifications();
  });
  markAllRead.addEventListener('click', async () => {
    if (!notifications.some(notification => !notification.readAt)) return;
    markAllRead.disabled = true;
    try {
      await window.SevApi.markAllNotificationsRead();
      notifications = notifications.map(notification => ({ ...notification, readAt: new Date().toISOString() }));
      render();
    } catch (error) {
      markAllRead.disabled = false;
    }
  });
  list.addEventListener('click', event => {
    const item = event.target.closest('[data-notification-id]');
    if (item) markAsRead(item.dataset.notificationId);
  });
  list.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const item = event.target.closest('[data-notification-id]');
    if (!item) return;
    event.preventDefault();
    markAsRead(item.dataset.notificationId);
  });
  document.addEventListener('click', event => {
    if (!panel.hidden && !event.target.closest('.notification-wrap')) closePanel();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  window.addEventListener('sev:notifications-changed', loadNotifications);

  render();
  loadNotifications();
})();
