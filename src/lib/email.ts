import { ServerClient } from "postmark";

// Postmark client, created lazily. Notifications are disabled (no-op) unless
// both POSTMARK_SERVER_TOKEN and POSTMARK_FROM_EMAIL are set.
let client: ServerClient | null = null;

function getClient(): ServerClient | null {
  const token = process.env.POSTMARK_SERVER_TOKEN;
  if (!token) return null;
  if (!client) client = new ServerClient(token);
  return client;
}

export async function sendCommentNotificationEmail(opts: {
  toEmail: string;
  commenterName: string;
  postTitle: string;
  commentBody: string;
  postUrl: string;
}): Promise<void> {
  const c = getClient();
  const from = process.env.POSTMARK_FROM_EMAIL;
  if (!c || !from) return; // notifications disabled

  await c.sendEmail({
    From: from,
    To: opts.toEmail,
    Subject: `New comment on “${opts.postTitle}”`,
    TextBody:
      `${opts.commenterName} left a comment:\n\n${opts.commentBody}\n\n` +
      `Read it here: ${opts.postUrl}`,
    MessageStream: "outbound",
  });
}
