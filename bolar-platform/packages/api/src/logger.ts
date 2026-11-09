import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.refreshToken', '*.accessToken', '*.ssn', '*.ssnLast4', '*.token', '*.secret', '*.email', '*.phone', '*.recipientAddress'],
    censor: '[redacted]',
  },
  base: { service: 'bolar-api', env: (() => { try { return config().NODE_ENV; } catch { return 'unknown'; } })() },
});
