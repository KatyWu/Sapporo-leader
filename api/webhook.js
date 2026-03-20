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
  }

  res.status(200).send('OK');
}
