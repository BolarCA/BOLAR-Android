import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** property module. Routes are added by the property build days; see docs/architecture/module-conventions.md. */
export const propertyRoutes: RouteDef[] = [];

export const propertyRouter: Router = Router();
mount(propertyRouter, propertyRoutes);
