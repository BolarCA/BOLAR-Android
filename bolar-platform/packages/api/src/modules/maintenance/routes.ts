import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** maintenance module. Routes are added by the maintenance build days; see docs/architecture/module-conventions.md. */
export const maintenanceRoutes: RouteDef[] = [];

export const maintenanceRouter: Router = Router();
mount(maintenanceRouter, maintenanceRoutes);
