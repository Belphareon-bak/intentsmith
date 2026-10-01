import { createService } from './service.js';

export function run(commands) {
  if (!Array.isArray(commands)) {
    throw new TypeError('commands must be an array');
  }

  const service = createService();
  return commands.map((command) => {
    if (!Array.isArray(command)) {
      throw new TypeError('each command must be a tuple');
    }

    const [op, ...args] = command;

    switch (op) {
      case 'add': {
        if (args.length !== 2) {
          throw new RangeError("'add' requires exactly amount and category arguments");
        }
        service.add(args[0], args[1]);
        return undefined;
      }

      case 'list': {
        if (args.length !== 0) {
          throw new RangeError("'list' takes no arguments");
        }
        return service.list();
      }

      case 'total': {
        if (args.length !== 0) {
          throw new RangeError("'total' takes no arguments");
        }
        return service.total();
      }

      case 'categories': {
        if (args.length !== 0) {
          throw new RangeError("'categories' takes no arguments");
        }
        return service.categories();
      }

      default:
        throw new Error(`unknown operation: ${String(op)}`);
    }
  });
}
