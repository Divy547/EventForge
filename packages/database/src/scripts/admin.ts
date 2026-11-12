import * as path from 'node:path';
import { parseArgs } from 'node:util';
import * as dotenv from 'dotenv';
import { getDatabaseConnection, closeDatabasePool } from '../client.js';
import {
  AdminError,
  createApiKey,
  createProject,
  findProject,
  listApiKeys,
  listProjects,
  revokeApiKey,
  rotateApiKey,
  type CreatedApiKey,
} from '../admin/admin.js';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const USAGE = `EventForge admin CLI

Usage: admin <command> [options]

Commands:
  project:create --name <name> [--slug <slug>]
  project:list
  key:create     --project <slug|id> --name <name> [--expires-in-days <n>]
  key:list       [--project <slug|id>]
  key:revoke     --key <id>
  key:rotate     --key <id> [--name <name>]

Raw API keys are printed exactly once. Only SHA-256 hashes are stored.`;

function need(value: string | undefined, flag: string): string {
  if (!value) {
    throw new AdminError(`Missing required option --${flag}\n\n${USAGE}`);
  }
  return value;
}

function printCreatedKey(created: CreatedApiKey): void {
  console.log('---------------------------------------------------------');
  console.log(`  Key ID  : ${created.key.id}`);
  console.log(`  Name    : ${created.key.name}`);
  console.log(`  API Key : ${created.rawKey}`);
  console.log('  Store this now. It cannot be shown again.');
  console.log('---------------------------------------------------------');
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  const { values } = parseArgs({
    args: rest,
    options: {
      name: { type: 'string' },
      slug: { type: 'string' },
      project: { type: 'string' },
      key: { type: 'string' },
      'expires-in-days': { type: 'string' },
    },
    strict: true,
  });

  const { db, pool } = getDatabaseConnection();
  try {
    switch (command) {
      case 'project:create': {
        const project = await createProject(db, {
          name: need(values.name, 'name'),
          ...(values.slug ? { slug: values.slug } : {}),
        });
        console.log(`Created project ${project.slug} (${project.id})`);
        break;
      }
      case 'project:list': {
        console.table(
          (await listProjects(db)).map((p) => ({ id: p.id, slug: p.slug, name: p.name })),
        );
        break;
      }
      case 'key:create': {
        const project = await findProject(db, need(values.project, 'project'));
        let expiresAt: Date | undefined;
        if (values['expires-in-days'] !== undefined) {
          const days = Number(values['expires-in-days']);
          if (!Number.isFinite(days) || days <= 0) {
            throw new AdminError('--expires-in-days must be a positive number.');
          }
          expiresAt = new Date(Date.now() + days * 86_400_000);
        }
        printCreatedKey(
          await createApiKey(db, {
            projectId: project.id,
            name: need(values.name, 'name'),
            ...(expiresAt ? { expiresAt } : {}),
          }),
        );
        break;
      }
      case 'key:list': {
        const project = values.project ? await findProject(db, values.project) : undefined;
        const keys = await listApiKeys(db, project ? { projectId: project.id } : {});
        console.table(
          keys.map((k) => ({
            id: k.id,
            project: k.projectId,
            name: k.name,
            prefix: k.keyPrefix,
            status: k.revokedAt ? 'revoked' : 'active',
            lastUsedAt: k.lastUsedAt?.toISOString() ?? '-',
            expiresAt: k.expiresAt?.toISOString() ?? '-',
          })),
        );
        break;
      }
      case 'key:revoke': {
        const key = await revokeApiKey(db, need(values.key, 'key'));
        console.log(`Revoked key ${key.id} (${key.keyPrefix}...)`);
        break;
      }
      case 'key:rotate': {
        const created = await rotateApiKey(db, need(values.key, 'key'), {
          ...(values.name ? { name: values.name } : {}),
        });
        console.log(`Rotated key ${values.key}: old key revoked, new key issued.`);
        printCreatedKey(created);
        break;
      }
      default:
        throw new AdminError(`Unknown command "${command}"\n\n${USAGE}`);
    }
  } finally {
    await closeDatabasePool(pool);
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof AdminError ? error.message : error);
  process.exitCode = 1;
});
