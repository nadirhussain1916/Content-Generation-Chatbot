import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import {
  getThread, getMessages, createMessage, updateThread,
  getWorkspaceUploads, getWorkspaceUploadsByIds, updateWorkspaceUploadVisionDescription, updateMessage,
} from '../db/queries';
import { runPlanner, generateImageDraft, generateVideoScript, runFollowup, resolveImageContext, type FollowupResult } from '../services/openai';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Thread, Message } from '../types';
import { Logger } from '../utils/Logger';
import { kvRateLimiter } from '../middleware/rateLimiter';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const messagesRouter = new Hono<Env>();

messagesRouter.use('*', authMiddleware);
messagesRouter.use('*', workspaceMiddleware);
// messagesRouter.use(
//   '/:threadId/messages',
//   kvRateLimiter({ windowMs: 60 * 1000, limit: 20, message: 'Slow down — 20 AI calls per minute max' })
// );

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

    const body = await c.req.json() as {
      content: string;
      textModel?: string;
      imageReferences?: { uploadId: string; publicUrl: string; name: string }[];
    };
    if (!body.content?.trim()) {
      return c.json<TfResponse<null>>({ success: false, message: 'Message content is required' }, 400);
    }
    const textModel = body.textModel ?? 'gpt-4o';
    const imageReferences = body.imageReferences ?? [];

    // ── Vision context ────────────────────────────────────────────────────────
    // Two sources:
    // 1. Images attached to THIS message → run agentic pre-flight (always analyzes every image)
    // 2. Images attached to PREVIOUS messages in this thread → pulled from DB cache
    // Both are merged and injected into conversation history so the AI always has
    // full context, even in follow-up messages where no images are re-attached.
    let visionContext = '';

    // Source 1: pre-flight for images attached to this message
    if (imageReferences.length > 0) {
      try {
        const uploadIds = imageReferences.map((r) => r.uploadId);
        const uploadRecords = await getWorkspaceUploadsByIds(c.env.DB, uploadIds, workspace.id);
        const uploadMap = new Map(uploadRecords.results.map((u) => [u.id, u]));

        const freshContext = await resolveImageContext({
          apiKey: c.env.OPENAI_API_KEY,
          userMessage: body.content.trim(),
          imageReferences,
          getVisionDescription: async (uploadId) => uploadMap.get(uploadId)?.vision_description ?? null,
          saveVisionDescription: async (uploadId, description) => {
            await updateWorkspaceUploadVisionDescription(c.env.DB, uploadId, description);
          },
        });
        if (freshContext) visionContext = freshContext;
      } catch (err) {
        Logger.log('VisionPreflightError', { workspaceId: workspace.id }, err);
      }
    }

    // Source 2: already-analyzed uploads scoped to this thread (persistent across messages)
    try {
      const threadUploads = await getWorkspaceUploads(c.env.DB, workspace.id);
      const currentUploadIds = new Set(imageReferences.map((r) => r.uploadId));
      const persistedLines = threadUploads.results
        .filter((u) => u.thread_id === threadId && u.vision_description && !currentUploadIds.has(u.id))
        .map((u) => `[Image: ${u.name}] ${u.vision_description}`);
      if (persistedLines.length > 0) {
        const persistedContext = persistedLines.join('\n');
        visionContext = visionContext
          ? `${persistedContext}\n${visionContext}`
          : persistedContext;
      }
    } catch (err) {
      Logger.log('PersistedVisionError', { workspaceId: workspace.id, threadId }, err);
    }

    // 1. Persist user message (store original content without vision context)
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

    // Prepend vision context to the last (current) user message in history
    if (visionContext && history.length > 0) {
      const last = history[history.length - 1];
      if (last.role === 'user') {
        history[history.length - 1] = {
          ...last,
          content: `${visionContext}\n\n${last.content}`,
        };
      }
    }

    const tone = workspace.ai_tone;
    const captionStyle = workspace.default_caption_style;
    const brand = {
      brand_name:               workspace.brand_name,
      brand_description:        workspace.brand_description,
      brand_voice:              workspace.brand_voice,
      target_audience:          workspace.target_audience,
      agent_instructions:       workspace.agent_instructions,
      default_image_size:       workspace.default_image_size,
      default_video_duration:   workspace.default_video_duration,
      default_video_dimensions: workspace.default_video_dimensions,
    };

    let assistantContent: string;
    let postPackageJson: string | undefined;
    let newThreadStatus: Thread['status'] = thread.status;
    let newMediaType: Thread['media_type'] = thread.media_type;
    let messageType: Message['type'] = 'chat';

    // 3. Route to the correct AI phase
    if (thread.status === 'planning') {
      // Planning phase — gather info and detect readiness
      const planResult = await runPlanner({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand, textModel });

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
          const draft = await generateImageDraft({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand, textModel });
          assistantContent = draft.content;
          postPackageJson = JSON.stringify(draft);
        } else {
          const script = await generateVideoScript({ apiKey: c.env.OPENAI_API_KEY, messages: history, tone, captionStyle, brand, textModel });
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
        textModel,
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

    // ── Inject referenceUploadIds into post_package (after AI generation) ────
    if (imageReferences.length > 0 && postPackageJson) {
      try {
        const draft = JSON.parse(postPackageJson);
        draft.referenceUploadIds = imageReferences.map((r) => r.uploadId);
        draft.primaryReferenceUploadId = imageReferences[0].uploadId;
        postPackageJson = JSON.stringify(draft);
      } catch { /* leave postPackageJson unchanged on parse error */ }
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

// PATCH /api/workspaces/:slug/threads/:threadId/messages/:messageId/references
// Updates referenceUploadIds + primaryReferenceUploadId inside an existing draft's post_package
messagesRouter.patch('/:threadId/messages/:messageId/references', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  const messageId = c.req.param('messageId');

  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    const { getMessages: _getMessages } = await import('../db/queries');
    const allMessages = await _getMessages(c.env.DB, threadId);
    const msg = allMessages.results.find((m) => m.id === messageId);
    if (!msg || !msg.post_package) {
      return c.json<TfResponse<null>>({ success: false, message: 'Message not found or has no draft' }, 404);
    }

    const body = await c.req.json() as {
      referenceUploadIds: string[];
      primaryReferenceUploadId: string | null;
    };

    const draft = JSON.parse(msg.post_package);
    draft.referenceUploadIds = body.referenceUploadIds;
    draft.primaryReferenceUploadId = body.primaryReferenceUploadId;
    const newPostPackage = JSON.stringify(draft);

    await updateMessage(c.env.DB, messageId, { post_package: newPostPackage });

    return c.json<TfResponse<{ post_package: string }>>({
      success: true,
      data: { post_package: newPostPackage },
    });
  } catch (error) {
    Logger.log('PatchReferencesError', { messageId, threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to update references' }, 500);
  }
});

export default messagesRouter;
