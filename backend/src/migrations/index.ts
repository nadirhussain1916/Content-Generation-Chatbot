import { migrateUsersTable } from './001_users';
import { migrateWorkspacesTable } from './002_workspaces';
import { migrateThreadsTable } from './003_threads';
import { migrateMessagesTable } from './004_messages';
import { migrateAssetsTable } from './005_assets';
import { migrateSocialAccountsTable } from './006_social_accounts';
import { migratePublishRecordsTable } from './007_publish_records';
import { migrateWorkspaceBrandFields } from './008_workspace_brand';
import { migrateWorkspaceMediaDefaults } from './009_workspace_media_defaults';
import { migrateAssetErrorColumn } from './010_asset_error';

export async function runAllMigrations(db: D1Database): Promise<string[]> {
  const all: string[] = ['[Migrations] Starting...'];

  const migrations = [
    migrateUsersTable,
    migrateWorkspacesTable,
    migrateThreadsTable,
    migrateMessagesTable,
    migrateAssetsTable,
    migrateSocialAccountsTable,
    migratePublishRecordsTable,
    migrateWorkspaceBrandFields,
    migrateWorkspaceMediaDefaults,
    migrateAssetErrorColumn,
  ];

  for (const migrate of migrations) {
    try {
      const msgs = await migrate(db);
      all.push(...msgs);
    } catch (error) {
      all.push(`[Migrations] Unexpected error: ${error}`);
    }
  }

  all.push('[Migrations] Done');
  return all;
}
