const winston = require('winston');
// constants.js lives at the repository root under /config
// this file is in src/utils, so go up two levels to reach it
const config = require('../../config/constants');

// Render a log info object to a single string, including any splat args.
const SPLAT = Symbol.for('splat');
function formatLine({ level, message, timestamp, stack, [SPLAT]: splat }) {
  let line = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  if (splat && splat.length > 0) {
    const extra = splat
      .map(s => (s instanceof Error ? s.stack || s.message : typeof s === 'object' ? JSON.stringify(s) : String(s ?? '')))
      .filter(Boolean)
      .join(' ');
    if (extra) line += ' ' + extra;
  }
  if (stack) line += '\n' + stack;
  return line;
}

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(formatLine)
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ level, message, timestamp, [SPLAT]: splat }) => {
          let line = `${timestamp} [${level}]: ${message}`;
          if (splat && splat.length > 0) {
            const extra = splat
              .map(s => (s instanceof Error ? s.message : typeof s === 'object' ? JSON.stringify(s) : String(s ?? '')))
              .filter(Boolean)
              .join(' ');
            if (extra) line += ' ' + extra;
          }
          return line;
        })
      ),
    }),
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});

module.exports = logger;
