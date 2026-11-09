import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** integrations module. Routes are added by the integrations build days; see docs/architecture/module-conventions.md. */
export const integrationsRoutes: RouteDef[] = [];

export const integrationsRouter: Router = Router();
mount(integrationsRouter, integrationsRoutes);
