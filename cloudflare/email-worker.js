// Cloudflare Email Worker — forwards inbound emails (e.g. forwarded receipts) to the
// app's /api/inbox/:token endpoint as clean JSON. Deploy with wrangler and point a
// Cloudflare Email Routing rule at it. Set INBOX_TOKEN + APP_URL as worker vars/secrets.
//
// Uses postal-mime to parse MIME (the one worker dependency):  npm i postal-mime
import PostalMime from 'postal-mime';

export default {
  async email(message, env) {
    const parsed = await PostalMime.parse(message.raw);

    const attachments = (parsed.attachments || []).map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.mimeType || 'application/octet-stream',
      dataBase64: bytesToBase64(a.content),
    }));

    const res = await fetch(`${env.APP_URL}/api/inbox/${env.INBOX_TOKEN}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        from: message.from,
        subject: parsed.subject || '',
        attachments,
      }),
    });

    if (!res.ok) {
      // Reject so the sender gets a bounce / Cloudflare retries, rather than silently dropping.
      message.setReject(`Inbox rejected the message (${res.status})`);
    }
  },
};

function bytesToBase64(content) {
  // postal-mime gives an ArrayBuffer (binary) or string (text attachments).
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : new Uint8Array(content);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
