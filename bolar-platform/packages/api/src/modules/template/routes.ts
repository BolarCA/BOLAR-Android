import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** template module. Routes are added by the template build days; see docs/architecture/module-conventions.md. */
export const templateRoutes: RouteDef[] = [];

export const templateRouter: Router = Router();
mount(templateRouter, templateRoutes);
