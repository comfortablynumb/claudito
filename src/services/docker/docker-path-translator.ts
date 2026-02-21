/**
 * Docker Path Translator
 * Converts host file system paths to Docker-compatible mount paths
 *
 * On Windows, Docker Desktop expects paths like /d/Development/Project
 * instead of D:\Development\Project for bind mount -v arguments.
 * On Linux/macOS, paths pass through unchanged.
 */

const isWindows = process.platform === 'win32';

/**
 * Translate a host path to a Docker-compatible bind mount path.
 * Windows: D:\foo\bar → /d/foo/bar
 * Linux/macOS: /home/user/foo → /home/user/foo (passthrough)
 */
export function translateToDockerPath(hostPath: string): string {
  if (!isWindows) return hostPath;

  return translateWindowsPath(hostPath);
}

function translateWindowsPath(hostPath: string): string {
  // Replace backslashes with forward slashes
  let dockerPath = hostPath.replace(/\\/g, '/');

  // Convert drive letter: D:/foo → /d/foo
  const driveMatch = dockerPath.match(/^([A-Za-z]):\//);

  if (driveMatch) {
    const driveLetter = driveMatch[1]!.toLowerCase();
    dockerPath = `/${driveLetter}/${dockerPath.substring(3)}`;
  }

  return dockerPath;
}
