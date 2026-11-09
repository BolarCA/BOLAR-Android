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
import { assertBoundedListRoutes } from './shared/route.js';
import { rateLimitMiddleware } from './shared/rate-limit.js';
import { errorReportingHook, initTelemetry, requestTiming, timingLogProps } from './shared/observability.js';

export function createApp(): Express {
  const cfg = config();
  // Hardening (Days 91-104): fail fast if any page route lacks a bounded `limit`; exporters are lazy no-ops when unset.
  assertBoundedListRoutes();
  void initTelemetry(cfg);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestTiming());
  app.use(helmet());
  app.use(cors({ origin: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true, exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Retry-After', 'RateLimit-Limit', 'RateLimit-Remaining'] }));
  app.use((req, res, next) => (req.path.startsWith('/webhooks/') ? next() : express.json({ limit: '2mb' })(req, res, next)));
  app.use(
    pinoHttp({
      logger,
      autoLogging: cfg.NODE_ENV !== 'test',
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? undefined,
      customProps: (req, res) => timingLogProps(req as express.Request, res as express.Response),
    }),
  );
  app.use(buildContext);
  app.use(rateLimitMiddleware());

  const api = Router();
  registerModules(api);
  app.use('/', api);
  app.use((_req, _res, next) => next(errors.notFound('Route not found')));
  app.use(errorReportingHook);
  app.use(errorHandler);
  return app;
}
