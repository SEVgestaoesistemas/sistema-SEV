export const registerHealthRoutes = async app => {
  app.get('/health', async () => ({
    status: 'ok',
    service: 'sev-backend',
    database: app.db.available ? 'configured' : 'not-configured'
  }));
};
