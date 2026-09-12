import { join, resolve, sep } from 'node:path';

/** Machine room identifiers are restricted so they can be path segments. */
const ROOM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidRoomId(roomId: string): boolean {
  return ROOM_ID_PATTERN.test(roomId);
}

export class DataPaths {
  constructor(readonly dataRoot: string) {}

  get roomsDir(): string {
    return join(this.dataRoot, 'rooms');
  }

  roomDir(roomId: string): string {
    if (!isValidRoomId(roomId)) {
      throw new Error(`Invalid room id: ${roomId}`);
    }
    const dir = resolve(join(this.roomsDir, roomId));
    // Belt and braces: the pattern already forbids separators and dots, but a
    // path that escaped the configured root would violate SOW s10.
    if (dir !== resolve(this.roomsDir) && !dir.startsWith(resolve(this.roomsDir) + sep)) {
      throw new Error(`Room path escapes data root: ${roomId}`);
    }
    return dir;
  }

  roomStateFile(roomId: string): string {
    return join(this.roomDir(roomId), 'state.json');
  }

  /** Server-only hidden truth; never served, never projected. */
  roomHiddenFile(roomId: string): string {
    return join(this.roomDir(roomId), 'hidden.json');
  }
}
