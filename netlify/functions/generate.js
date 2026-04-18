const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRandomIP() {
  return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { prompt, aspect, quantity } = body;

    if (!prompt || prompt.trim().length < 3) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Prompt must be at least 3 characters' }) };
    }

    const ua = getRandomUA();
    const spoofIP = getRandomIP();

    const requestBody = JSON.stringify({
      prompt: prompt.trim(),
      model_id: 'raphael-basic',
      aspect: aspect || '1:1',
      number_of_images: Math.min(Math.max(parseInt(quantity) || 1, 1), 4),
      isSafeContent: true,
      autoTranslate: true,
    });

    const resp = await fetch('https://raphael.app/api/generate-image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': ua,
        'Origin': 'https://raphael.app',
        'Referer': 'https://raphael.app/',
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Google Chrome";v="135", "Not-A.Brand";v="8"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'X-Forwarded-For': spoofIP,
        'X-Real-IP': spoofIP,
      },
      body: requestBody,
    });

    if (!resp.ok) {
      const text = await resp.text();
      return { statusCode: resp.status, headers, body: JSON.stringify({ error: `API error: ${text.slice(0, 200)}` }) };
    }

    const text = await resp.text();
    const lines = text.trim().split('\n').filter(l => l.trim());
    const images = [];

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        if (data.url) {
          images.push({
            url: data.url.startsWith('http') ? data.url : `https://raphael.app${data.url}`,
            seed: data.seed || 0,
            width: data.width || 0,
            height: data.height || 0,
          });
        }
      } catch { /* skip */ }
    }

    if (images.length === 0) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'No images generated' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { images } }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
