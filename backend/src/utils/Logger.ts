interface SlackNotificationCache {
  lastSent: number;
  count: number;
}

export const _ERROR_THROTTLE_MS = 1 * 60 * 60 * 1000; // 1 hour

export class Logger {
  static log(action: string, details?: unknown, error?: Error | unknown) {
    const logEntry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      action,
      details,
    };

    if (error instanceof Error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } else if (error) {
      logEntry.error = error;
    }

    console.log(action, logEntry);
  }

  static async postToSlack(
    webhookUrl: string | undefined,
    environment: string | undefined,
    action: string,
    details?: unknown,
    error?: Error | unknown
  ) {
    if (environment === 'local' || !webhookUrl) {
      this.log('SlackSkipped', { action, reason: environment === 'local' ? 'local env' : 'no webhook' });
      return;
    }
    try {
      let errorString = '';
      if (error instanceof Error) {
        errorString = JSON.stringify({ name: error.name, message: error.message, stack: error.stack });
      } else if (error) {
        errorString = JSON.stringify(error);
      }

      const payload = {
        text: `ThreadForge Alert`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Environment:* \`${environment}\`\n*Action:* \`${action}\`\n*Time:* \`${new Date().toISOString()}\``,
            },
          },
          ...(details
            ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Details:* \`\`\`${JSON.stringify(details, null, 2)}\`\`\`` } }]
            : []),
          ...(errorString
            ? [{ type: 'section', text: { type: 'mrkdwn', text: `*Error:* \`\`\`${errorString}\`\`\`` } }]
            : []),
        ],
      };

      await fetch(webhookUrl, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      this.log('FailedPostToSlack', undefined, err);
    }
  }

  static async throttledSlackNotification(
    kv: KVNamespace,
    webhookUrl: string | undefined,
    environment: string | undefined,
    errorKey: string,
    action: string,
    details?: unknown,
    error?: Error | unknown
  ) {
    try {
      const now = Date.now();
      const cacheStr = await kv.get(`slack-error:${errorKey}`);
      const cache: SlackNotificationCache | null = cacheStr ? JSON.parse(cacheStr) : null;
      const lastSent = cache?.lastSent ?? 0;
      const count = cache?.count ?? 1;

      if (now - lastSent > _ERROR_THROTTLE_MS) {
        await Logger.postToSlack(webhookUrl, environment, action, { ...details as object, count }, error);
        await kv.put(`slack-error:${errorKey}`, JSON.stringify({ lastSent: now, count: count + 1 }), { expirationTtl: 7200 });
      } else {
        await kv.put(`slack-error:${errorKey}`, JSON.stringify({ lastSent, count: count + 1 }), { expirationTtl: 7200 });
      }
    } catch (err) {
      this.log('FailedThrottledSlackNotification', undefined, err);
    }
  }
}
