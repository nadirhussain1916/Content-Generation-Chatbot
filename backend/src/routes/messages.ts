import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import { getThread, getMessages, createMessage, updateThread } from '../db/queries';
import { runPlanner, generateImageDraft, generateVideoScript, runFollowup, type FollowupResult } from '../services/openai';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Thread, Message } from '../types';
import { Logger } from '../utils/Logger';
import { kvRateLimiter } from '../middleware/rateLimiter';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const messagesRouter = new Hono<Env>();

messagesRouter.use('*', authMiddleware);
messagesRouter.use('*', workspaceMiddleware);
messagesRouter.use(
  '/:threadId/messages',
  kvRateLimiter({ windowMs: 60 * 1000, limit: 20, message: 'Slow down — 20 AI calls per minute max' })
);

// POST /api/workspaces/:slug/threads/:threadId/messages
// Handles ALL phases: planning → draft → followup
messagesRouter.post('/:threadId/messages', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');

  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    const body = await c.req.json() as { content: string };
    if (!body.content?.trim()) {
      return c.json<TfResponse<null>>({ success: false, message: 'Message content is required' }, 400);
    }

    // 1. Persist user message
    const userMsgId = crypto.randomUUID();
    await createMessage(c.env.DB, {
      id: userMsgId,
      thread_id: threadId,
      role: 'user',
      type: 'chat',
      content: body.content.trim(),
    });

    // 2. Build conversation history for AI
    const allMessages = await getMessages(c.env.DB, threadId);
    const history = allMessages.results.map((m) => ({
      role: m.role as 'user' | 'assistant',
      // For assistant draft/followup messages, include the post_package as context
      content: m.post_package ? `${m.content}\n\nPOST_PACKAGE:${m.post_package}` : m.content,
    }));

    const tone = workspace.ai_tone;
    const captionStyle = workspace.default_caption_style;
    const brand = {
      brand_name:         workspace.brand_name,
      brand_description:  workspace.brand_description,
      brand_voice:        workspace.brand_voice,
      target_audience:    workspace.target_audience,
      agent_instructions: workspace.agent_instructions,
    };

    let assistantContent: string;
    let postPackageJson: string | undefined;
    let newThreadStatus: Thread['status'] = thread.status;
    let newMediaType: Thread['media_type'] = thread.media_type;
    let messageType: Message['type'] = 'chat';

    // 3. Route to the correct AI phase
    if (thread.status === 'planning') {
      // Planning phase — gather info and detect readiness
      const planResult = await runPlanner({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand });

      if (planResult.mode === 'chat') {
        // Pure conversation — greetings, off-topic, etc.
        assistantContent = planResult.reply;
        messageType = 'chat';
      } else if (planResult.ready && planResult.mediaType !== null) {
        // AI has enough info — generate full draft immediately
        newMediaType = planResult.mediaType;
        newThreadStatus = planResult.mediaType === 'image' ? 'draft' : 'script_ready';
        messageType = 'draft';

        if (planResult.mediaType === 'image') {
          const draft = await generateImageDraft({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand });
          assistantContent = draft.content;
          postPackageJson = JSON.stringify(draft);
        } else {
          const script = await generateVideoScript({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand });
          assistantContent = script.content;
          postPackageJson = JSON.stringify(script);
        }
      } else {
        // Still gathering info — return planner reply with chip questions
        assistantContent = JSON.stringify(planResult);
        messageType = 'chat';
      }
    } else if (thread.status === 'draft' || thread.status === 'script_ready') {
      // Followup / refinement phase
      const followupResult: FollowupResult = await runFollowup({
        apiKey: c.env.OPENAI_API_KEY,
        messages: history,
        mediaType: thread.media_type === 'video' ? 'video' : 'image',
        tone,
        captionStyle,
        brand,
      });

      if (followupResult.mode === 'chat') {
        // Pure conversation — no content update
        assistantContent = followupResult.reply;
        messageType = 'chat';
      } else if (followupResult.mode === 'needs_context') {
        // Vague new topic — ask questions using the same planner-style JSON format
        assistantContent = JSON.stringify({
          reply: followupResult.reply,
          ready: false,
          mediaType: null,
          questions: followupResult.questions,
        });
        messageType = 'chat';
      } else {
        // Refined draft
        assistantContent = followupResult.package.content;
        postPackageJson = JSON.stringify(followupResult.package);
        messageType = 'followup';
      }
    } else {
      // Thread is published — allow minor followups as plain chat
      assistantContent = "This thread is already published. Start a new thread to create fresh content!";
    }

    // 4. Persist assistant message
    const assistantMsgId = crypto.randomUUID();
    await createMessage(c.env.DB, {
      id: assistantMsgId,
      thread_id: threadId,
      role: 'assistant',
      type: messageType,
      content: assistantContent,
      post_package: postPackageJson,
    });

    // 5. Update thread state
    const threadUpdate: Partial<Pick<Thread, 'status' | 'media_type' | 'active_draft_id' | 'title'>> = {};
    if (newThreadStatus !== thread.status) threadUpdate.status = newThreadStatus;
    if (newMediaType !== thread.media_type) threadUpdate.media_type = newMediaType;
    if (messageType === 'draft') threadUpdate.active_draft_id = assistantMsgId;
    if (!thread.title && body.content.length > 0) {
      threadUpdate.title = body.content.substring(0, 80);
    }

    if (Object.keys(threadUpdate).length > 0) {
      await updateThread(c.env.DB, threadId, threadUpdate);
    }

    return c.json<TfResponse<{
      userMessage: { id: string };
      assistantMessage: Message;
    }>>({
      success: true,
      data: {
        userMessage: { id: userMsgId },
        assistantMessage: {
          id: assistantMsgId,
          thread_id: threadId,
          role: 'assistant',
          type: messageType,
          content: assistantContent,
          post_package: postPackageJson ?? null,
          created_at: Math.floor(Date.now() / 1000),
        },
      },
    });
  } catch (error) {
    Logger.log('SendMessageError', { threadId, workspaceId: workspace.id }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to generate AI response' }, 500);
  }
});

export default messagesRouter;
