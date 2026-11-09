import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** tenant-profile module. Routes are added by the tenant-profile build days; see docs/architecture/module-conventions.md. */
export const tenantProfileRoutes: RouteDef[] = [];

export const tenantProfileRouter: Router = Router();
mount(tenantProfileRouter, tenantProfileRoutes);
