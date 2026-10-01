import { createBoard } from './store.js';

export function run(commands) {
  if (!Array.isArray(commands)) {
    throw new TypeError('commands must be an array');
  }

  const board = createBoard();
  const results = [];

  for (const command of commands) {
    if (!Array.isArray(command)) {
      throw new TypeError('each command must be an array tuple');
    }

    const [op, ...args] = command;

    switch (op) {
      case 'add': {
        if (command.length !== 3) {
          throw new TypeError(`invalid arity for add: expected 3 arguments, got ${command.length}`);
        }
        results.push(board.add(args[0], args[1]));
        break;
      }

      case 'update': {
        if (command.length !== 3) {
          throw new TypeError(`invalid arity for update: expected 3 arguments, got ${command.length}`);
        }
        results.push(board.update(args[0], args[1]));
        break;
      }

      case 'transition': {
        if (command.length !== 3) {
          throw new TypeError(`invalid arity for transition: expected 3 arguments, got ${command.length}`);
        }
        results.push(board.transition(args[0], args[1]));
        break;
      }

      case 'remove': {
        if (command.length !== 2) {
          throw new TypeError(`invalid arity for remove: expected 2 arguments, got ${command.length}`);
        }
        results.push(board.remove(args[0]));
        break;
      }

      case 'list': {
        if (command.length !== 1 && command.length !== 2) {
          throw new TypeError(`invalid arity for list: expected 1 or 2 arguments, got ${command.length}`);
        }
        results.push(board.list(command.length === 2 ? args[0] : {}));
        break;
      }

      default:
        throw new TypeError(`unknown operation: ${op}`);
    }
  }

  return results;
}