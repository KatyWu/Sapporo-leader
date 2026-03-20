import { Client } from '@notionhq/client';

const notion = new Client({ auth: process.env.NOTION_TOKEN });

async function getScheduledNotifications() {
  const response = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
    filter: {
      property: '已發送',
      checkbox: {
        equals: false,
      },
    },
  });
  return response.results;
}

async function markAsSent(pageId) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      已發送: {
        checkbox: true,
      },
    },
  });
}

async function sendLineMessage(message) {
  const body = {
    to: process.env.LINE_GROUP_ID,
    messages: [{ type: 'text', text: message }],
  };

  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE API error: ${err}`);
  }
}

export default async function handler(req, res) {
  try {
    const nowMs = Date.now();
    const notifications = await getScheduledNotifications();

    for (const page of notifications) {
      const props = page.properties;

      const sendTimeRaw = props['發送時間']?.date?.start;
      if (!sendTimeRaw) continue;

      // new Date() 會正確解析 Notion 回傳的 ISO 8601（含 +09:00 時區）
      const sendTimeMs = new Date(sendTimeRaw).getTime();

      // 比對時間：發送時間在「現在」到「現在 +15 分鐘」之間就發送
      const diffMs = sendTimeMs - nowMs;
      const diffMin = diffMs / 1000 / 60;

      if (diffMin >= 0 && diffMin < 1) {
        const title = props['通知標題']?.title?.[0]?.plain_text || '';
        const content = props['訊息內容']?.rich_text?.[0]?.plain_text || '';
        const link = props['Notion 連結']?.url || '';

        let message = content;
        if (link) {
          message += `\n\n${link}`;
        }

        await sendLineMessage(message);
        await markAsSent(page.id);

        console.log(`✅ 已發送通知：${title}`);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Cron error:', err);
    res.status(500).json({ error: err.message });
  }
}
