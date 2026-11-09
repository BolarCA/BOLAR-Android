import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** notice module. Routes are added by the notice build days; see docs/architecture/module-conventions.md. */
export const noticeRoutes: RouteDef[] = [];

export const noticeRouter: Router = Router();
mount(noticeRouter, noticeRoutes);
