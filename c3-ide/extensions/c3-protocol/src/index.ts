/**
 * @c3/protocol — Shared types between IDE and C3 backend
 *
 * This is the single source of truth for all WebSocket message types.
 * Both IDE (Theia) and backend import from here.
 */

export * from './messages';
export * from './channels';
export * from './constants';
