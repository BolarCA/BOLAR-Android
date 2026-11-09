import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** signature module. Routes are added by the signature build days; see docs/architecture/module-conventions.md. */
export const signatureRoutes: RouteDef[] = [];

export const signatureRouter: Router = Router();
mount(signatureRouter, signatureRoutes);
