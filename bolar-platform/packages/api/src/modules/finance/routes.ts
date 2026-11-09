import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** finance module. Routes are added by the finance build days; see docs/architecture/module-conventions.md. */
export const financeRoutes: RouteDef[] = [];

export const financeRouter: Router = Router();
mount(financeRouter, financeRoutes);
