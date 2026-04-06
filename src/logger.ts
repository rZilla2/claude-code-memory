function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  const formatted = args.map((a) =>
    a instanceof Error
      ? JSON.stringify({ message: a.message, stack: a.stack })
      : JSON.stringify(a)
  );
  return ' [' + formatted.join(', ') + ']';
}

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    process.stderr.write(`[INFO] ${msg}${formatArgs(args)}\n`);
  },
  warn: (msg: string, ...args: unknown[]) => {
    process.stderr.write(`[WARN] ${msg}${formatArgs(args)}\n`);
  },
  error: (msg: string, ...args: unknown[]) => {
    process.stderr.write(`[ERROR] ${msg}${formatArgs(args)}\n`);
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (process.env.DEBUG) {
      process.stderr.write(`[DEBUG] ${msg}${formatArgs(args)}\n`);
    }
  },
};
