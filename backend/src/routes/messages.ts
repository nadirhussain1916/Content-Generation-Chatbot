import { Hono } from 'hono';
import { authMiddleware, workspaceMiddleware } from '../middleware/auth';
import {
  getThread, getMessages, createMessage, updateThread,
  getWorkspaceUploads, getWorkspaceUploadsByIds, updateWorkspaceUploadVisionDescription, updateMessage,
} from '../db/queries';
import { runAgent, type AgentResult } from '../services/openai';
import { calcTextCost } from '../services/costs';
import type { CloudflareBindings } from '../env';
import type { ContextVariables, TfResponse, Thread, Message } from '../types';
import { Logger } from '../utils/Logger';

type Env = { Bindings: CloudflareBindings; Variables: ContextVariables };

const messagesRouter = new Hono<Env>();

messagesRouter.use('*', authMiddleware);
messagesRouter.use('*', workspaceMiddleware);

// POST /api/workspaces/:slug/threads/:threadId/messages
// Single agentic handler — covers planning, questioning, drafting, and refinement
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

    // ── Pre-load cached vision descriptions for newly attached images ─────────
    // uploadMap is also used as an in-process cache by getVisionDescription /
    // resolveUpload so repeated DB lookups for the same ID are avoided.
    type UploadRecord = { id: string; vision_description: string | null; public_url: string | null; name: string };
    const uploadMap = new Map<string, UploadRecord>();
    if (imageReferences.length > 0) {
      try {
        const ids = imageReferences.map((r) => r.uploadId);
        const records = await getWorkspaceUploadsByIds(c.env.DB, ids, workspace.id);
        for (const u of records.results) uploadMap.set(u.id, u);
      } catch (err) {
        Logger.log('UploadPreloadError', { workspaceId: workspace.id }, err);
      }
    }

    // ── Build persisted image context from earlier messages in this thread ────
    // Descriptions cached from previous messages are injected into the system
    // prompt so the model always has full visual context in follow-up turns.
    let persistedImageContext = '';
    try {
      const threadUploads = await getWorkspaceUploads(c.env.DB, workspace.id);
      const currentIds = new Set(imageReferences.map((r) => r.uploadId));
      const lines = threadUploads.results
        .filter((u) => u.thread_id === threadId && u.vision_description && !currentIds.has(u.id))
        .map((u) => `[Image: ${u.name}] ${u.vision_description}`);
      persistedImageContext = lines.join('\n');
    } catch (err) {
      Logger.log('PersistedVisionError', { workspaceId: workspace.id, threadId }, err);
    }

    // 1. Persist user message
    const userMsgId = crypto.randomUUID();
    await createMessage(c.env.DB, {
      id: userMsgId,
      thread_id: threadId,
      role: 'user',
      type: 'chat',
      content: body.content.trim(),
      image_references: imageReferences.length > 0 ? JSON.stringify(imageReferences) : undefined,
    });

    // 2. Build conversation history
    // Assistant draft messages include POST_PACKAGE context so the model can
    // reference and refine the existing draft in follow-up turns.
    const allMessages = await getMessages(c.env.DB, threadId);
    const history = allMessages.results.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.post_package ? `${m.content}\n\nPOST_PACKAGE:${m.post_package}` : m.content,
    }));

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
      target_video_length:      workspace.target_video_length,
      default_video_dimensions: workspace.default_video_dimensions,
      character_name:           workspace.character_name,
      character_appearance:     workspace.character_appearance,
    };

    // 3. Run unified agent
    const agentResult: AgentResult = await runAgent({
      apiKey: c.env.OPENAI_API_KEY,
      messages: history,
      tone,
      captionStyle,
      brand,
      textModel,
      threadStatus: thread.status,
      imageReferences,
      persistedImageContext: persistedImageContext || undefined,
      // Check in-memory map first; fall back to DB for IDs not in current imageReferences
      // (e.g. upload IDs the agent finds in POST_PACKAGE.referenceUploadIds)
      getVisionDescription: async (uploadId) => {
        const inMap = uploadMap.get(uploadId);
        if (inMap !== undefined) return inMap.vision_description ?? null;
        try {
          const records = await getWorkspaceUploadsByIds(c.env.DB, [uploadId], workspace.id);
          const u = records.results[0];
          if (u) uploadMap.set(u.id, u); // cache for subsequent calls this turn
          return u?.vision_description ?? null;
        } catch (err) { Logger.log('GetVisionDescriptionError', { uploadId, workspaceId: workspace.id }, err); return null; }
      },
      saveVisionDescription: async (uploadId, description) => {
        await updateWorkspaceUploadVisionDescription(c.env.DB, uploadId, description);
        // Keep in-map cache fresh so a subsequent getVisionDescription hit is instant
        const cached = uploadMap.get(uploadId);
        if (cached) uploadMap.set(uploadId, { ...cached, vision_description: description });
      },
      // Resolve any upload ID the agent sees in the conversation to its public URL
      resolveUpload: async (uploadId) => {
        const inMap = uploadMap.get(uploadId);
        if (inMap?.public_url) return { publicUrl: inMap.public_url, name: inMap.name };
        try {
          const records = await getWorkspaceUploadsByIds(c.env.DB, [uploadId], workspace.id);
          const u = records.results[0];
          if (u) uploadMap.set(u.id, u);
          if (!u?.public_url) return null;
          return { publicUrl: u.public_url, name: u.name };
        } catch (err) { Logger.log('ResolveUploadError', { uploadId, workspaceId: workspace.id }, err); return null; }
      },
    });

    // 4. Map agent result → message fields + thread state
    let assistantContent: string;
    let postPackageJson: string | undefined;
    let newThreadStatus: Thread['status'] = thread.status;
    let newMediaType: Thread['media_type'] = thread.media_type;
    let messageType: Message['type'] = 'chat';

    if (agentResult.action === 'chat') {
      assistantContent = agentResult.reply;
      messageType = 'chat';
    } else if (agentResult.action === 'questions') {
      // Serialize in the same planner JSON format the frontend already parses
      assistantContent = JSON.stringify({
        reply: agentResult.reply,
        ready: false,
        mediaType: null,
        questions: agentResult.questions,
      });
      messageType = 'chat';
    } else if (agentResult.action === 'image_draft') {
      const isNewDraft = thread.status === 'planning';
      assistantContent = agentResult.reply;
      postPackageJson = JSON.stringify(agentResult.package);
      messageType = isNewDraft ? 'draft' : 'followup';
      if (isNewDraft) {
        newThreadStatus = 'draft';
        newMediaType = 'image';
      }
    } else {
      // video_script
      const isNewDraft = thread.status === 'planning';
      assistantContent = agentResult.reply;
      postPackageJson = JSON.stringify(agentResult.package);
      messageType = isNewDraft ? 'draft' : 'followup';
      if (isNewDraft) {
        newThreadStatus = 'script_ready';
        newMediaType = 'video';
      }
    }

    // ── Inject referenceUploadIds into post_package ───────────────────────────
    // Case A: agent just produced a fresh draft — stamp references onto it
    if (imageReferences.length > 0 && postPackageJson) {
      try {
        const draft = JSON.parse(postPackageJson);
        draft.referenceUploadIds = imageReferences.map((r) => r.uploadId);
        draft.primaryReferenceUploadId = imageReferences[0].uploadId;
        postPackageJson = JSON.stringify(draft);
      } catch (err) { Logger.log('PostPackageParseError', { workspaceId: workspace.id }, err); }
    }

    // Case C: agent produced a draft but user attached no new images
    // — carry over referenceUploadIds from the previous draft so they are not lost
    if (postPackageJson && imageReferences.length === 0) {
      try {
        const newDraft = JSON.parse(postPackageJson);
        if (!newDraft.referenceUploadIds?.length) {
          const prevDraft = [...allMessages.results]
            .reverse()
            .find((m) => (m.type === 'draft' || m.type === 'followup') && m.post_package);
          if (prevDraft?.post_package) {
            const prevPkg = JSON.parse(prevDraft.post_package);
            if (prevPkg.referenceUploadIds?.length) {
              newDraft.referenceUploadIds = prevPkg.referenceUploadIds;
              newDraft.primaryReferenceUploadId =
                prevPkg.primaryReferenceUploadId ?? prevPkg.referenceUploadIds[0] ?? null;
              postPackageJson = JSON.stringify(newDraft);
            }
          }
        }
      } catch (err) { Logger.log('RefCarryOverError', { threadId }, err); }
    }

    // Case B: agent returned chat/questions — merge new images into the existing draft
    // (e.g. user uploads a reference image while the AI asks a follow-up question)
    if (imageReferences.length > 0 && !postPackageJson) {
      try {
        const lastDraft = [...allMessages.results]
          .reverse()
          .find((m) => (m.type === 'draft' || m.type === 'followup') && m.post_package);

        if (lastDraft?.post_package) {
          const draftPkg = JSON.parse(lastDraft.post_package);
          const existingIds: string[] = draftPkg.referenceUploadIds ?? [];
          const newIds = imageReferences
            .map((r) => r.uploadId)
            .filter((id) => !existingIds.includes(id));

          if (newIds.length > 0) {
            const mergedIds = [...existingIds, ...newIds];
            draftPkg.referenceUploadIds = mergedIds;
            // Set primary only if one wasn't already chosen
            if (!draftPkg.primaryReferenceUploadId) {
              draftPkg.primaryReferenceUploadId = mergedIds[0] ?? null;
            }
            await updateMessage(c.env.DB, lastDraft.id, { post_package: JSON.stringify(draftPkg) });
            Logger.log('AutoRefInject', { threadId, injectedCount: newIds.length });
          }
        }
      } catch (err) {
        Logger.log('AutoRefInjectError', { threadId }, err);
      }
    }

    // 5. Persist assistant message (with model name and cost)
    const assistantMsgId = crypto.randomUUID();
    const agentCost = calcTextCost(textModel, agentResult.usage.inputTokens, agentResult.usage.outputTokens);
    await createMessage(c.env.DB, {
      id: assistantMsgId,
      thread_id: threadId,
      role: 'assistant',
      type: messageType,
      content: assistantContent,
      post_package: postPackageJson,
      model: textModel,
      cost_usd: agentCost,
      input_tokens: agentResult.usage.inputTokens,
      output_tokens: agentResult.usage.outputTokens,
    });

    // 6. Update thread state
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
      userMessage: { id: string; image_references: string | null };
      assistantMessage: Message;
    }>>({
      success: true,
      data: {
        userMessage: {
          id: userMsgId,
          image_references: imageReferences.length > 0 ? JSON.stringify(imageReferences) : null,
        },
        assistantMessage: {
          id: assistantMsgId,
          thread_id: threadId,
          role: 'assistant',
          type: messageType,
          content: assistantContent,
          post_package: postPackageJson ?? null,
          image_references: null,
          model: textModel,
          cost_usd: agentCost,
          input_tokens: agentResult.usage.inputTokens,
          output_tokens: agentResult.usage.outputTokens,
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

    const allMessages = await getMessages(c.env.DB, threadId);
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

// PATCH /api/workspaces/:slug/threads/:threadId/messages/:messageId/package
// Replaces the full post_package for manual draft edits from the Edit modal
messagesRouter.patch('/:threadId/messages/:messageId/package', async (c) => {
  const workspace = c.get('workspace');
  const threadId = c.req.param('threadId');
  const messageId = c.req.param('messageId');

  try {
    const thread = await getThread(c.env.DB, threadId);
    if (!thread || thread.workspace_id !== workspace.id) {
      return c.json<TfResponse<null>>({ success: false, message: 'Thread not found' }, 404);
    }

    const allMessages = await getMessages(c.env.DB, threadId);
    const msg = allMessages.results.find((m) => m.id === messageId);
    if (!msg || !msg.post_package) {
      return c.json<TfResponse<null>>({ success: false, message: 'Message not found or has no draft' }, 404);
    }

    const body = await c.req.json() as { post_package: string };

    // Validate it's parseable JSON before writing
    try { JSON.parse(body.post_package); } catch {
      return c.json<TfResponse<null>>({ success: false, message: 'Invalid post_package JSON' }, 400);
    }

    await updateMessage(c.env.DB, messageId, { post_package: body.post_package });

    return c.json<TfResponse<{ post_package: string }>>({
      success: true,
      data: { post_package: body.post_package },
    });
  } catch (error) {
    Logger.log('PatchPackageError', { messageId, threadId }, error);
    return c.json<TfResponse<null>>({ success: false, message: 'Failed to update draft' }, 500);
  }
});

export default messagesRouter;
