import fs from 'node:fs';
import path from 'node:path';

export const ARTIFACTS_DIR = '/home/ubuntu/repos/.amp/in/artifacts';

export async function captureArtifactScreenshot(app: { screenshot(label?: string): Promise<string> }, artifactFilename: string): Promise<string> {
  const label = artifactFilename.replace(/\.png$/, '');
  const shotPath = await app.screenshot(label);
  if (!fs.existsSync(ARTIFACTS_DIR)) {
    fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  }
  const cleanName = artifactFilename.endsWith('.png') ? artifactFilename : `${artifactFilename}.png`;
  const targetPath = path.join(ARTIFACTS_DIR, cleanName);
  fs.copyFileSync(shotPath, targetPath);
  return targetPath;
}
