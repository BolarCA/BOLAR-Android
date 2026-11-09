import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** legal module. Routes are added by the legal build days; see docs/architecture/module-conventions.md. */
export const legalRoutes: RouteDef[] = [];

export const legalRouter: Router = Router();
mount(legalRouter, legalRoutes);
