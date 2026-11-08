import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import {
  normalizeSnapshot,
  rawComposerSchema,
  type RawComposer,
  type ReviewedWork,
} from './catalog-core';

const { values } = parseArgs({
  options: {
    fetch: { type: 'boolean' },
    all: { type: 'boolean' },
    'dry-run': { type: 'boolean' },
    input: { type: 'string', default: 'scripts/sources/snapshot.json' },
    output: { type: 'string', default: 'src/data/catalog.json' },
    report: { type: 'string', default: 'docs/catalog-report.json' },
    names: { type: 'string', default: 'Mozart,Beethoven,Bach,Haydn,Schubert,Vivaldi,Chopin' },
  },
});
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let lastRequest = 0;
const errors: string[] = [];
async function request(endpoint: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await delay(Math.max(0, 1100 - (Date.now() - lastRequest)));
    lastRequest = Date.now();
    try {
      const response = await fetch(`https://api.openopus.org${endpoint}`, {
        signal: AbortSignal.timeout(20000),
        headers: {
          'User-Agent':
            'ClassicalListeningArchive/0.1 (offline catalog preparation; https://openopus.org)',
        },
      });
      if (!response.ok) {
        if (response.status === 429)
          await delay(
            Math.min(
              30000,
              Math.max(1500, Number(response.headers.get('retry-after') ?? 2) * 1000),
            ),
          );
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as Record<string, unknown>;
      if ((body.status as { success?: string } | undefined)?.success !== 'true')
        throw new Error('API 返回失败状态');
      return body;
    } catch (error) {
      errors.push(
        `${endpoint} 尝试 ${attempt + 1}: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt === 2) throw new Error(`无法获取 ${endpoint}`, { cause: error });
      await delay(1000 * 2 ** attempt);
    }
  }
  throw new Error('请求未完成');
}

async function main() {
  if (values.fetch) {
    const candidates = new Map<string, { id: string; name: string }>();
    const endpoints = values.all
      ? [
          'Medieval',
          'Renaissance',
          'Baroque',
          'Classical',
          'Early Romantic',
          'Romantic',
          'Late Romantic',
          '20th Century',
          'Post-War',
          '21st Century',
        ].map((epoch) => `/composer/list/epoch/${encodeURIComponent(epoch)}.json`)
      : values.names
          .split(',')
          .map((name) => `/composer/list/search/${encodeURIComponent(name.trim())}.json`);
    for (const endpoint of endpoints) {
      const body = await request(endpoint);
      for (const composer of body.composers as { id: string; name: string }[])
        candidates.set(composer.id, composer);
    }
    const composers: RawComposer[] = [];
    for (const composer of candidates.values()) {
      const body = await request(
        `/work/list/composer/${encodeURIComponent(composer.id)}/genre/all.json`,
      );
      composers.push(rawComposerSchema.parse({ ...(body.composer as object), works: body.works }));
      console.log(`已获取 ${composers.length}/${candidates.size}: ${composer.name}`);
    }
    await mkdir(path.dirname(values.input), { recursive: true });
    await writeFile(
      values.input,
      JSON.stringify(
        { retrievedAt: new Date().toISOString(), license: 'CC0-1.0', composers },
        null,
        2,
      ),
    );
  }
  const rawText = await readFile(values.input, 'utf8');
  const reviewed = JSON.parse(
    await readFile('scripts/reviewed-works.json', 'utf8'),
  ) as ReviewedWork[];
  const { catalog, reviews } = normalizeSnapshot(JSON.parse(rawText), reviewed);
  const report = {
    source: 'Open Opus',
    license: 'CC0-1.0',
    licenseReference: 'https://github.com/openopus-org/openopus_api#license',
    inputSha256: createHash('sha256').update(rawText).digest('hex'),
    generatedAt: new Date().toISOString(),
    dryRun: Boolean(values['dry-run']),
    composers: catalog.composers.length,
    works: catalog.works.length,
    identifiers: catalog.workIdentifiers.length,
    aliases: catalog.workAliases.length,
    reviewCount: reviews.length,
    completenessVerified: false,
    errors,
    reviews,
  };
  await mkdir(path.dirname(values.report), { recursive: true });
  await writeFile(values.report, JSON.stringify(report, null, 2));
  if (!values['dry-run']) {
    await mkdir(path.dirname(values.output), { recursive: true });
    await writeFile(values.output, JSON.stringify(catalog));
  }
  console.log(JSON.stringify({ ...report, reviews: undefined }));
}

await main().catch(async (error: unknown) => {
  await mkdir(path.dirname(values.report), { recursive: true });
  await writeFile(
    values.report,
    JSON.stringify(
      { failed: true, errors, message: error instanceof Error ? error.message : String(error) },
      null,
      2,
    ),
  );
  console.error(error);
  process.exitCode = 1;
});
