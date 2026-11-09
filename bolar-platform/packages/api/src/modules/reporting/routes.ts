import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** reporting module. Routes are added by the reporting build days; see docs/architecture/module-conventions.md. */
export const reportingRoutes: RouteDef[] = [];

export const reportingRouter: Router = Router();
mount(reportingRouter, reportingRoutes);
