import Anthropic from '@anthropic-ai/sdk';

const LINE_API = 'https://api.line.me/v2/bot/message/reply';
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// 各地點座標
const LOCATIONS = {
  二世谷: { lat: 42.9, lon: 140.9, name: '二世谷' },
  niseko: { lat: 42.9, lon: 140.9, name: '二世谷' },
  札幌: { lat: 43.06, lon: 141.35, name: '札幌' },
  sapporo: { lat: 43.06, lon: 141.35, name: '札幌' },
  北海道: { lat: 42.9, lon: 140.9, name: '二世谷' },
};

// Open-Meteo 天氣查詢（免費，不需要 API Key）
async function getWeather(location = '二世谷') {
  const loc = LOCATIONS[location.toLowerCase()] ||
    LOCATIONS[location] ||
    LOCATIONS['二世谷'];

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&current=temperature_2m,apparent_temperature,precipitation,snowfall,windspeed_10m,weathercode` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,snowfall_sum,weathercode` +
    `&timezone=Asia%2FTokyo&forecast_days=3`;

  const res = await fetch(url);
  const data = await res.json();

  const c = data.current;
  const d = data.daily;

  const weatherDesc = (code) => {
    if (code === 0) return '晴天☀️';
    if (code <= 3) return '多雲🌤️';
    if (code <= 48) return '霧🌫️';
    if (code <= 67) return '下雨🌧️';
    if (code <= 77) return '下雪❄️';
    if (code <= 82) return '陣雨🌦️';
    if (code <= 86) return '雪陣⛄';
    return '雷雨⛈️';
  };

  return {
    location: loc.name,
    current: {
      temp: c.temperature_2m,
      feelsLike: c.apparent_temperature,
      precipitation: c.precipitation,
      snowfall: c.snowfall,
      windspeed: c.windspeed_10m,
      description: weatherDesc(c.weathercode),
    },
    forecast: d.time.map((date, i) => ({
      date,
      max: d.temperature_2m_max[i],
      min: d.temperature_2m_min[i],
      precipitation: d.precipitation_sum[i],
      snowfall: d.snowfall_sum[i],
      description: weatherDesc(d.weathercode[i]),
    })),
  };
}

// Claude Tool Use
const weatherTool = {
  name: 'get_weather',
  description: '查詢北海道指定地點的即時天氣和未來3天預報。當使用者問到天氣、氣溫、下雪、雪況等相關問題時使用。',
  input_schema: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: '地點名稱，如：二世谷、札幌、北海道',
      },
    },
    required: ['location'],
  },
};

async function askClaude(question) {
  // 第一輪：讓 Claude 決定是否需要查天氣
  const firstResponse = await anthropic.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: '你是北海道旅遊小助手，專門回答北海道旅遊相關問題。用繁體中文回答，簡潔清楚。如果有人問天氣、氣溫、下雪、雪況、要穿什麼，請使用 get_weather 工具取得即時資料再回答。',
    tools: [weatherTool],
    messages: [{ role: 'user', content: question }],
  });

  // 如果 Claude 要呼叫工具
  if (firstResponse.stop_reason === 'tool_use') {
    const toolUse = firstResponse.content.find((b) => b.type === 'tool_use');
    const weatherData = await getWeather(toolUse.input.location);

    // 第二輪：把天氣資料回給 Claude 整理成回答
    const secondResponse = await anthropic.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 1024,
      system: '你是北海道旅遊小助手，專門回答北海道旅遊相關問題。用繁體中文回答，簡潔清楚。',
      tools: [weatherTool],
      messages: [
        { role: 'user', content: question },
        { role: 'assistant', content: firstResponse.content },
        {
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(weatherData),
          }],
        },
      ],
    });

    return secondResponse.content.find((b) => b.type === 'text')?.text || '無法取得回應';
  }

  return firstResponse.content.find((b) => b.type === 'text')?.text || '無法取得回應';
}

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
        (botUserId && text.includes('@'));

      if (isMentioned) {
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
