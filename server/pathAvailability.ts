import fs from 'fs';
import path from 'path';

const fsp = fs.promises;

async function getNearestExistingPath(targetPath: string): Promise<string | null> {
  let currentPath = path.resolve(targetPath);

  while (true) {
    try {
      await fsp.access(currentPath, fs.constants.F_OK);
      return currentPath;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code && nodeError.code !== 'ENOENT') {
        return null;
      }
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

export async function isPathAvailable(targetPath: string): Promise<boolean> {
  const existingPath = await getNearestExistingPath(targetPath);
  if (!existingPath) {
    return false;
  }

  try {
    await fsp.access(existingPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
