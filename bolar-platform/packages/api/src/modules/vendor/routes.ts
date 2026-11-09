import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** vendor module. Routes are added by the vendor build days; see docs/architecture/module-conventions.md. */
export const vendorRoutes: RouteDef[] = [];

export const vendorRouter: Router = Router();
mount(vendorRouter, vendorRoutes);
