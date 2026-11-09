import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** retention module. Routes are added by the retention build days; see docs/architecture/module-conventions.md. */
export const retentionRoutes: RouteDef[] = [];

export const retentionRouter: Router = Router();
mount(retentionRouter, retentionRoutes);
