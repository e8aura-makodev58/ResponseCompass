import { readdir, stat } from 'node:fs/promises';

import type { RoomHealth, RoomSummary } from '../domain/types.js';
import type { RoomSeedSpec } from '../seed/seed.js';
import { seedRoom } from '../seed/seed.js';
import { loadPlant1Seed } from '../seed/plant1.js';
import { writeJsonIfAbsent } from './atomic.js';
import { DataPaths, isValidRoomId } from './paths.js';
import { RoomStore } from './roomStore.js';

export interface RoomEntry {
  roomId: string;
  health: RoomHealth;
  store: RoomStore;
  /** Operator-facing reason a room is FAILED; never contains a credential. */
  failure?: string;
}

/**
 * The room registry. Rooms load and fail independently (SOW s3.1): one room
 * whose state cannot be read is marked FAILED and every other room still
 * serves.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, RoomEntry>();

  private constructor(readonly paths: DataPaths) {}

  static async open(paths: DataPaths): Promise<RoomRegistry> {
    const registry = new RoomRegistry(paths);
    await registry.reload();
    return registry;
  }

  /**
   * Seed a genuinely empty data root, once.
   *
   * The guard is the existence of the rooms directory, not its contents: a
   * partially written or hand-edited volume is "nonempty" and must never be
   * merged, reset, or overwritten (SOW s10).
   */
  static async seedIfEmpty(
    paths: DataPaths,
    specs: RoomSeedSpec[],
    plant1SimulationSeedPath?: string,
  ): Promise<boolean> {
    if (await pathExists(paths.roomsDir)) return false;

    for (const spec of specs) {
      const { state, hidden } = spec.roomId === 'plant-1' && plant1SimulationSeedPath !== undefined
        ? await loadPlant1Seed(plant1SimulationSeedPath)
        : seedRoom(spec);
      await writeJsonIfAbsent(paths.roomStateFile(spec.roomId), state);
      await writeJsonIfAbsent(paths.roomHiddenFile(spec.roomId), hidden);
    }
    return true;
  }

  async reload(): Promise<void> {
    this.rooms.clear();
    for (const roomId of await this.discoverRoomIds()) {
      const store = new RoomStore(this.paths, roomId);
      try {
        await store.load();
        this.rooms.set(roomId, { roomId, health: 'READY', store });
      } catch (error) {
        // Isolate rather than guess or discard facts (SOW s3.2).
        this.rooms.set(roomId, {
          roomId,
          health: 'FAILED',
          store,
          failure: error instanceof Error ? error.message : 'unreadable room state',
        });
      }
    }
  }

  private async discoverRoomIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.paths.roomsDir, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    return entries
      .filter((entry) => entry.isDirectory() && isValidRoomId(entry.name))
      .map((entry) => entry.name)
      .sort();
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  get(roomId: string): RoomEntry | undefined {
    return this.rooms.get(roomId);
  }

  get size(): number {
    return this.rooms.size;
  }

  /** Room picker / management listing. A FAILED room reports no clock state. */
  async summaries(): Promise<RoomSummary[]> {
    const summaries: RoomSummary[] = [];
    for (const entry of this.rooms.values()) {
      if (entry.health === 'FAILED') {
        summaries.push({
          roomId: entry.roomId,
          displayName: entry.roomId,
          health: 'FAILED',
        });
        continue;
      }
      const state = await entry.store.read();
      summaries.push({
        roomId: entry.roomId,
        displayName: state.displayName,
        health: 'READY',
        clockState: state.clockState,
        mode: state.mode,
        revision: state.revision,
      });
    }
    return summaries.sort((a, b) => a.roomId.localeCompare(b.roomId));
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
