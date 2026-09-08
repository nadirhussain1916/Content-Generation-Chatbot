import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import {
  getWorkspaceMessageUsage,
  getWorkspaceAssetUsage,
} from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const billingRouter = new Hono<Env>();

billingRouter.use('*', authMiddleware);
billingRouter.use('*', workspaceMiddleware);

// ─── Response shapes ──────────────────────────────────────────────────────────

interface ModelUsage {
  model: string | null;
  count: number;
  cost: number;
  inputTokens?: number;
  outputTokens?: number;
}

interface CategoryUsage {
  cost: number;
  count: number;
  inputTokens?: number;
  outputTokens?: number;
  byModel: ModelUsage[];
}

export interface UsageSummary {
  totalCost: number;
  text: CategoryUsage;
  image: CategoryUsage;
  video: CategoryUsage;
}

// ─── GET /api/workspaces/:slug/billing ────────────────────────────────────────

billingRouter.get('/', async (c) => {
  const workspace = c.get('workspace');
  try {
    const [messageUsage, assetUsage] = await Promise.all([
      getWorkspaceMessageUsage(c.env.DB, workspace.id),
      getWorkspaceAssetUsage(c.env.DB, workspace.id),
    ]);

    // Text (messages)
    const text: CategoryUsage = { cost: 0, count: 0, inputTokens: 0, outputTokens: 0, byModel: [] };
    for (const row of messageUsage.results) {
      const cost = row.cost ?? 0;
      const inputTokens = row.input_tokens ?? 0;
      const outputTokens = row.output_tokens ?? 0;
      text.cost += cost;
      text.count += row.count;
      text.inputTokens = (text.inputTokens ?? 0) + inputTokens;
      text.outputTokens = (text.outputTokens ?? 0) + outputTokens;
      text.byModel.push({ model: row.model, count: row.count, cost, inputTokens, outputTokens });
    }

    // Image + video (assets)
    const image: CategoryUsage = { cost: 0, count: 0, byModel: [] };
    const video: CategoryUsage = { cost: 0, count: 0, byModel: [] };
    for (const row of assetUsage.results) {
      const bucket = row.type === 'video' ? video : image;
      const cost = row.cost ?? 0;
      bucket.cost += cost;
      bucket.count += row.count;
      bucket.byModel.push({ model: row.model, count: row.count, cost });
    }

    const usage: UsageSummary = {
      totalCost: text.cost + image.cost + video.cost,
      text,
      image,
      video,
    };

    return c.json<TfResponse<UsageSummary>>({ success: true, data: usage });
  } catch (error) {
    Logger.log('BillingUsageError', { workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to load usage' }, 500);
  }
});

export default billingRouter;
