import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { upsertUser, getUser, setUserOnboarded, updateUserProfile, createWorkspace, getWorkspacesByOwner } from '../db/queries';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Workspace } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const onboardingRouter = new Hono<Env>();

onboardingRouter.use('*', authMiddleware);

// Called on every page load — ensures the user row exists and returns onboarding state
onboardingRouter.post('/bootstrap', async (c) => {
  const userId = c.get('userId');
  try {
    await upsertUser(c.env.DB, userId);
    const [user, workspaces] = await Promise.all([
      getUser(c.env.DB, userId),
      getWorkspacesByOwner(c.env.DB, userId),
    ]);

    // Populate name/email from Clerk on first bootstrap (or if either is missing).
    if (user && (!user.email || !user.name)) {
      try {
        const clerkRes = await fetch(`https://api.clerk.com/v1/users/${userId}`, {
          headers: { Authorization: `Bearer ${c.env.CLERK_SECRET_KEY}` },
        });
        if (clerkRes.ok) {
          const data = await clerkRes.json() as {
            first_name?: string | null;
            last_name?: string | null;
            username?: string | null;
            primary_email_address_id?: string;
            email_addresses?: { id: string; email_address: string }[];
          };

          const primary = data.email_addresses?.find(
            (e) => e.id === data.primary_email_address_id
          );
          const email = primary?.email_address ?? undefined;
          const fullName = [data.first_name, data.last_name].filter(Boolean).join(' ') || data.username || undefined;

          const profile: { email?: string; name?: string } = {};
          if (!user.email && email) profile.email = email;
          if (!user.name && fullName) profile.name = fullName;

          if (Object.keys(profile).length > 0) {
            await updateUserProfile(c.env.DB, userId, profile);
          }
        }
      } catch (profileErr) {
        // Non-fatal — don't block the bootstrap response
        Logger.log('OnboardingProfileFetchError', { userId }, profileErr);
      }
    }

    return c.json<TfResponse<{ onboarded: boolean; workspaceSlug: string | null }>>({
      success: true,
      data: {
        onboarded: !!user?.onboarded,
        workspaceSlug: workspaces.results[0]?.slug ?? null,
      },
    });
  } catch (error) {
    Logger.log('OnboardingBootstrapError', { userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

const CompleteSchema = z.object({
  workspaceName: z.string().min(1).max(60),
  aiTone: z.enum(['professional', 'casual', 'witty', 'formal', 'inspirational']).default('professional'),
  defaultCaptionStyle: z.enum(['short', 'medium', 'long']).default('short'),
  defaultPlatforms: z.array(z.enum(['instagram', 'tiktok'])).min(1).default(['instagram']),
});

// Called once after the user fills in the workspace setup form
onboardingRouter.post('/complete', async (c) => {
  const userId = c.get('userId');
  try {
    const body = await c.req.json();
    const parsed = CompleteSchema.safeParse(body);
    if (!parsed.success) {
      return c.json<TfResponse<null>>({ success: false, message: parsed.error.message }, 400);
    }

    const { workspaceName, aiTone, defaultCaptionStyle, defaultPlatforms } = parsed.data;
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + crypto.randomUUID().slice(0, 6);
    const workspaceId = crypto.randomUUID();

    await upsertUser(c.env.DB, userId);
    await createWorkspace(c.env.DB, {
      id: workspaceId,
      owner_id: userId,
      name: workspaceName,
      slug,
      ai_tone: aiTone,
      default_caption_style: defaultCaptionStyle,
      default_platforms: JSON.stringify(defaultPlatforms),
    });
    await setUserOnboarded(c.env.DB, userId);

    const workspace = { id: workspaceId, name: workspaceName, slug } as Workspace;
    return c.json<TfResponse<{ workspace: Workspace }>>({ success: true, data: { workspace } });
  } catch (error) {
    Logger.log('OnboardingCompleteError', { userId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Internal server error' }, 500);
  }
});

export default onboardingRouter;
