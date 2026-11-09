import express, { Router, type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildContext } from './shared/context.js';
import { errorHandler } from './shared/errors.js';
import { errors } from '@bolar/shared';
import { registerModules } from './modules/index.js';

export function createApp(): Express {
  const cfg = config();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed'] }));
  app.use(express.json({ limit: '2mb' }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: cfg.NODE_ENV !== 'test',
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? undefined,
      customProps: (req) => ({ requestId: (req as express.Request).ctx?.requestId }),
    }),
  );
  app.use(buildContext);

  const api = Router();
  registerModules(api);
  app.use('/', api);
  app.use((_req, _res, next) => next(errors.notFound('Route not found')));
  app.use(errorHandler);
  return app;
}
