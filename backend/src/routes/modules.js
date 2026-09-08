import { requireAccountAccess, requireAuth } from '../auth/middleware.js';
import { listActiveModules } from '../modules/service.js';

export const registerModuleRoutes = async app => {
  app.get('/empresa/modulos', {
    preHandler: [requireAuth, requireAccountAccess]
  }, async request => ({ modules: await listActiveModules(request.tenantDb) }));
};
