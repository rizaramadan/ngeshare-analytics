// Simple console logger with timestamps and colors

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
};

function timestamp() {
  return new Date().toISOString();
}

export const logger = {
  info: (message, ...args) => {
    console.log(`${COLORS.green}[INFO]${COLORS.reset} ${timestamp()} ${message}`, ...args);
  },

  warn: (message, ...args) => {
    console.warn(`${COLORS.yellow}[WARN]${COLORS.reset} ${timestamp()} ${message}`, ...args);
  },

  error: (message, ...args) => {
    console.error(`${COLORS.red}[ERROR]${COLORS.reset} ${timestamp()} ${message}`, ...args);
  },

  debug: (message, ...args) => {
    if (process.env.DEBUG === 'true') {
      console.log(`${COLORS.gray}[DEBUG]${COLORS.reset} ${timestamp()} ${message}`, ...args);
    }
  },
};
