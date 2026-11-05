import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: 'subwatch' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-subwatch-signature"]',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.secret',
        '*.signingSecret',
        '*.apiKey',
        'payload.password',
        'payload.token',
      ],
      censor: '[redacted]',
    },
  });
}
