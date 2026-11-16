import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@bolar/db';
import { isAppError, type ErrorBody } from '@bolar/shared';
import { logger } from '../logger.js';

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = req.ctx?.requestId ?? 'unknown';
  let body: ErrorBody;
  let status: number;
  if (isAppError(err)) {
    status = err.status;
    body = { code: err.code, message: err.message, requestId, ...(err.fieldErrors ? { fieldErrors: err.fieldErrors } : {}) };
  } else if (err instanceof ZodError) {
    status = 400;
    body = { code: 'validation_error', message: 'Validation failed', requestId, fieldErrors: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    status = 409;
    body = { code: 'conflict', message: 'A record with these values already exists', requestId };
  } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
    status = 404;
    body = { code: 'not_found', message: 'Not found', requestId };
  } else if (err instanceof SyntaxError && 'body' in (err as object)) {
    status = 400;
    body = { code: 'validation_error', message: 'Malformed JSON body', requestId };
  } else {
    status = 500;
    body = { code: 'internal_error', message: 'Internal error', requestId };
    logger.error({ err, requestId, path: req.path }, 'unhandled error');
  }
  if (status >= 500) {
    // already logged
  } else if (status === 403 || status === 401) {
    logger.info({ requestId, path: req.path, code: body.code }, 'request denied');
  }
  res.status(status).json(body);
};
