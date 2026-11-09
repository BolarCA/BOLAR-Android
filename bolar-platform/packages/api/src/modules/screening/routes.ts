import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** screening module. Routes are added by the screening build days; see docs/architecture/module-conventions.md. */
export const screeningRoutes: RouteDef[] = [];

export const screeningRouter: Router = Router();
mount(screeningRouter, screeningRoutes);
