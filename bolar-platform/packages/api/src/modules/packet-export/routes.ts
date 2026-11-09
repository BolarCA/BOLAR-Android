import { Router } from 'express';
import { mount, type RouteDef } from '../../shared/route.js';

/** packet-export module. Routes are added by the packet-export build days; see docs/architecture/module-conventions.md. */
export const packetExportRoutes: RouteDef[] = [];

export const packetExportRouter: Router = Router();
mount(packetExportRouter, packetExportRoutes);
