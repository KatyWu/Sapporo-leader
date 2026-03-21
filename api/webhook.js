import Anthropic from '@anthropic-ai/sdk';

const LINE_API = 'https://api.line.me/v2/bot/message/reply';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function replyMessage(replyToken, text) {
  await fetch(LINE_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}

async function askClaude(question) {
  const message = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: '你是北海道旅遊小助手，專門回答北海道旅遊相關問題。用繁體中文回答，簡潔清楚。',
    messages: [{ role: 'user', content: question }],
  });
  return message.content[0].text;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).send('OK');
  }

  const events = req.body?.events || [];

  for (const event of events) {
    const source = event.source;
    if (source?.type === 'group') {
      console.log('LINE_GROUP_ID:', source.groupId);
    }

    // 偵測群組訊息中有人 tag Bot
    if (
      event.type === 'message' &&
      event.message?.type === 'text' &&
      event.source?.type === 'group'
    ) {
      const text = event.message.text;
      const mentionees = event.message?.mention?.mentionees || [];
      const botUserId = process.env.LINE_BOT_USER_ID;

      const isMentioned =
        mentionees.some((m) => m.type === 'user' && m.userId === botUserId) ||
        (botUserId && text.includes(`@`));

      if (isMentioned) {
        // 移除 @mention 部分，取出實際問題
        const question = text.replace(/@\S+/g, '').trim();
        if (question) {
          try {
            const answer = await askClaude(question);
            await replyMessage(event.replyToken, answer);
          } catch (err) {
            console.error('Claude error:', err);
            await replyMessage(event.replyToken, '抱歉，AI 暫時無法回應，請稍後再試。');
          }
        }
      }
    }
  }

  res.status(200).send('OK');
}
