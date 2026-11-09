// packet-export contracts: request/response zod schemas. Export objects with .openapi('Name').
import { z } from './openapi-zod.js';
export const packetExportContractsReady = z.literal(true);
