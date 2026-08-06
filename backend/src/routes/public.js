// This is intentionally limited to contact data that is already visible in the
// support link. Secrets and environment details are never returned to clients.
export const registerPublicRoutes = async app => {
  app.get('/public/support-contact', async () => ({
    whatsappNumber: app.config.adminWhatsAppNumber || null
  }));
};
