import { z } from 'zod';
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
// Ensure the api's zod instance carries .openapi() even if pnpm resolves a separate copy from contracts.
extendZodWithOpenApi(z);
export { z };
