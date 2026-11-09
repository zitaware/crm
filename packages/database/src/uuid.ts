import { uuidv7 } from 'uuidv7';

/**
 * Application-generated UUID v7 identifier, per docs/07-database-conventions.md.
 * Public document numbers are separate from primary keys and are never
 * derived from this value.
 */
export function generateId(): string {
  return uuidv7();
}
