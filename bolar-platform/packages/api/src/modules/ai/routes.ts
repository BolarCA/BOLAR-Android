import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** ai module. Routes are added by the ai build days; see docs/architecture/module-conventions.md. */
export const aiRoutes: RouteDef[] = [];

export const aiRouter: Router = Router();
mount(aiRouter, aiRoutes);
