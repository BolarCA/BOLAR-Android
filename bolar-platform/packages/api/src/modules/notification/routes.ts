import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** notification module. Routes are added by the notification build days; see docs/architecture/module-conventions.md. */
export const notificationRoutes: RouteDef[] = [];

export const notificationRouter: Router = Router();
mount(notificationRouter, notificationRoutes);
