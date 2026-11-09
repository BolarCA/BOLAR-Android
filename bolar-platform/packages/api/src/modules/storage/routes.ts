import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** storage module. Routes are added by the storage build days; see docs/architecture/module-conventions.md. */
export const storageRoutes: RouteDef[] = [];

export const storageRouter: Router = Router();
mount(storageRouter, storageRoutes);
