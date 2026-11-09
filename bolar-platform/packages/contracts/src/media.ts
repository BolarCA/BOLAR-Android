// media contracts: request/response zod schemas. Export objects with .openapi('Name').
import { z } from './openapi-zod.js';
export const mediaContractsReady = z.literal(true);
