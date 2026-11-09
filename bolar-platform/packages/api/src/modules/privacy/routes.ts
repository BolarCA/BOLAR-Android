import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** privacy module. Routes are added by the privacy build days; see docs/architecture/module-conventions.md. */
export const privacyRoutes: RouteDef[] = [];

export const privacyRouter: Router = Router();
mount(privacyRouter, privacyRoutes);
