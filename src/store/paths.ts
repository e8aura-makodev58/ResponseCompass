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

  /** Server-only crash-recovery journal for coordinated state/hidden writes. */
  roomTransactionFile(roomId: string): string {
    return join(this.roomDir(roomId), 'transaction.json');
  }

  get providerSettingsFile(): string {
    return join(this.dataRoot, 'provider-settings.json');
  }

  /** Owner-restricted provider secrets; never served or projected. */
  get providerCredentialsFile(): string {
    return join(this.dataRoot, 'provider-credentials.json');
  }

  /** Owner-restricted recovery journal; may transiently contain credentials. */
  get providerTransactionFile(): string {
    return join(this.dataRoot, 'provider-transaction.json');
  }
}
