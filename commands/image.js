const ACCESS_TOKEN = process.env.IMAGE_ACCESS_TOKEN || '';

const IMAGE_API = process.env.IMAGE_API_URL || 'http://127.0.0.1:3001';
const IMAGE_AGENT_ID = process.env.IMAGE_AGENT_ID || '8fea0355-e592-4b88-adeb-ed92599682e2';
const IMAGE_ENDPOINT = `${IMAGE_API}/api/tools/generate-image`;
const GENERATION_TIMEOUT_MS = 15 * 60 * 1000;

async function generateImage(prompt, negativePrompt) {
  const headers = { 'Content-Type': 'application/json' };
  if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;
  const body = { agentId: IMAGE_AGENT_ID, prompt };
  if (negativePrompt && negativePrompt.trim()) body.negativePrompt = negativePrompt.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const res = await fetch(IMAGE_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      throw new Error(json && json.error ? json.error : `Image API HTTP ${res.status}`);
    }
    const base = new URL(IMAGE_API).origin;
    const url = new URL(json.data.url, base).href;
    return { ...json.data, url };
  } finally {
    clearTimeout(timer);
  }
}

async function handleImage(message, args) {
  const text = (args || []).join(' ').trim();
  if (!text) {
    await message.reply(
      'Usage: `!image <prompt>` \u2014 generates a 1024x1024 photo on the local GPU (Z-Image Turbo).\n' +
      'Optional style hint: `!image <prompt> -- <negative prompt>`.',
    );
    return;
  }

  let prompt = text;
  let negativePrompt = null;
  const negIdx = text.indexOf('--');
  if (negIdx > 0) {
    prompt = text.slice(0, negIdx).trim();
    negativePrompt = text.slice(negIdx + 2).trim() || null;
  }

  const reply = await message.reply('\u{1F4F7} Generating image \u2014 this takes 1\u20132 minutes\u2026');
  try {
    const img = await generateImage(prompt, negativePrompt);
    const detail = [`\u{1F4F7} **${message.author.username}**: ${prompt.slice(0, 300)}`];
    if (img.width && img.height) detail.push(`${img.width}\u00D7${img.height}`);
    detail.push(`${(img.fileSize / 1024 / 1024).toFixed(1)} MB`);
    detail.push(`\u23F1\uFE0F ${Math.round(img.durationMs / 1000)}s`);
    const content = detail.join(' \u00B7 ');

    const res = await fetch(img.url);
    if (!res.ok) throw new Error(`Failed to download image (HTTP ${res.status})`);
    const buf = Buffer.from(await res.arrayBuffer());
    await reply.edit({ content, files: [{ attachment: buf, name: 'generated.png' }] });
  } catch (e) {
    await reply.edit(`Image generation failed: ${e.message}`);
  }
}

module.exports = { handleImage, generateImage };
