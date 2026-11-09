import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** lease module. Routes are added by the lease build days; see docs/architecture/module-conventions.md. */
export const leaseRoutes: RouteDef[] = [];

export const leaseRouter: Router = Router();
mount(leaseRouter, leaseRoutes);
