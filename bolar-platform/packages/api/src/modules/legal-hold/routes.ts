import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** legal-hold module. Routes are added by the legal-hold build days; see docs/architecture/module-conventions.md. */
export const legalHoldRoutes: RouteDef[] = [];

export const legalHoldRouter: Router = Router();
mount(legalHoldRouter, legalHoldRoutes);
