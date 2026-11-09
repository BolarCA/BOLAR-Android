import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** document module. Routes are added by the document build days; see docs/architecture/module-conventions.md. */
export const documentRoutes: RouteDef[] = [];

export const documentRouter: Router = Router();
mount(documentRouter, documentRoutes);
