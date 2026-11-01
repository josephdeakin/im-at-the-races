import fs from 'node:fs';
import path from 'node:path';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { getArtifact, resolveRacesDir } from '@races/db';
import { artifactBytesMatch } from '@/lib/server/artifacts';
import { getDb } from '@/lib/server/db';
import { apiError, guard, notFoundError } from '@/lib/server/http';

export const runtime = 'nodejs';

/**
 * Serve a recorded artifact by ID. Paths resolve under the runtime directory
 * and are confined there after symlink resolution; unknown IDs and missing
 * files are explicit 404s, never empty successes.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> },
) {
  return guard(async () => {
    const { artifactId } = await params;
    const artifact = getArtifact(getDb(), artifactId);
    if (!artifact) return notFoundError(`Artifact not found: ${artifactId}`);
    const racesDir = resolveRacesDir();
    const absolute = path.resolve(racesDir, artifact.relativePath);
    let real: string;
    try {
      real = fs.realpathSync(absolute);
    } catch {
      return notFoundError(`Artifact file missing: ${artifactId}`);
    }
    const realRoot = fs.realpathSync(racesDir);
    const confined = real === realRoot || real.startsWith(`${realRoot}${path.sep}`);
    if (!confined) return notFoundError(`Artifact not found: ${artifactId}`);
    let data: Buffer;
    try {
      data = fs.readFileSync(real);
    } catch {
      return notFoundError(`Artifact file missing: ${artifactId}`);
    }
    if (!artifactBytesMatch(artifact.sha256, data)) {
      return apiError(
        'INTERNAL_ERROR',
        `Artifact bytes do not match the recorded hash: ${artifactId}`,
        500,
      );
    }
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(data.length),
        'cache-control': 'private, max-age=3600',
      },
    });
  });
}
