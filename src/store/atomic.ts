import { mkdir, open, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Write a file atomically: a reader either sees the previous complete contents
 * or the new complete contents, never a partial write. Persisted room state is
 * canonical (SOW s3.2), so a torn write during a crash is data loss.
 */
export async function writeFileAtomic(
  filePath: string,
  contents: string,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });
  const tempPath = join(dir, `.${Date.now()}-${process.pid}.tmp`);

  const handle = await open(tempPath, 'w');
  try {
    await handle.writeFile(contents, 'utf8');
    // Flush the bytes before the rename, so the rename cannot expose an empty
    // file if the machine loses power immediately afterwards.
    await handle.sync();
  } finally {
    await handle.close();
  }

  await rename(tempPath, filePath);
  await syncDirectory(dir);
}

/** Persist the rename itself, not just the file contents. */
async function syncDirectory(dir: string): Promise<void> {
  let handle;
  try {
    handle = await open(dir, 'r');
    await handle.sync();
  } catch {
    // Directory fsync is not supported on every platform/filesystem; the
    // rename is still atomic, so this is a durability nicety, not correctness.
  } finally {
    await handle?.close();
  }
}

export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
): Promise<void> {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/** Write only if the path does not already exist. Never merges or overwrites. */
export async function writeJsonIfAbsent(
  filePath: string,
  value: unknown,
): Promise<boolean> {
  await mkdir(dirname(filePath), { recursive: true });
  try {
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}
