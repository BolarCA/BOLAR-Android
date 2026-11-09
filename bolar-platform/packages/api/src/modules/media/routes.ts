import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** media module. Routes are added by the media build days; see docs/architecture/module-conventions.md. */
export const mediaRoutes: RouteDef[] = [];

export const mediaRouter: Router = Router();
mount(mediaRouter, mediaRoutes);
