import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** compliance module. Routes are added by the compliance build days; see docs/architecture/module-conventions.md. */
export const complianceRoutes: RouteDef[] = [];

export const complianceRouter: Router = Router();
mount(complianceRouter, complianceRoutes);
