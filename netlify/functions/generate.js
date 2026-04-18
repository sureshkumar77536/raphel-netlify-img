const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateIPv4() {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  let a = octet();
  while (a === 10 || a === 127 || a === 192) a = octet();
  return `${a}.${octet()}.${octet()}.${octet()}`;
}

function createSession() {
  return { ip: generateIPv4(), ua: pickRandom(USER_AGENTS), cookies: '' };
}

async function fetchWithTimeout(url, options, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

function buildHeaders(session, extra = {}) {
  return {
    'User-Agent': session.ua,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://raphael.app',
    'Referer': 'https://raphael.app/',
    'Sec-Ch-Ua': '"Google Chrome";v="135", "Not-A.Brand";v="8"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'X-Forwarded-For': session.ip,
    'X-Real-IP': session.ip,
    'Client-IP': session.ip,
    ...(session.cookies ? { 'Cookie': session.cookies } : {}),
    ...extra,
  };
}

async function getFreshSession(session) {
  try {
    const resp = await fetchWithTimeout('https://raphael.app/', {
      method: 'GET',
      headers: buildHeaders(session, { 'Accept': 'text/html,application/xhtml+xml' }),
    }, 15000);
    const setCookies = resp.headers.getSetCookie?.() || [];
    if (setCookies.length === 0) {
      const sc = resp.headers.get('set-cookie');
      if (sc) setCookies.push(sc);
    }
    if (setCookies.length > 0) {
      session.cookies = setCookies.map(c => c.split(';')[0]).join('; ');
    }
    return session;
  } catch {
    return session;
  }
}

async function generateFromRaphael(prompt, aspect, quantity) {
  const session = createSession();
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) {
      session.ip = generateIPv4();
      session.ua = pickRandom(USER_AGENTS);
      session.cookies = '';
    }

    await getFreshSession(session);

    try {
      const resp = await fetchWithTimeout('https://raphael.app/api/generate-image', {
        method: 'POST',
        headers: buildHeaders(session, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          prompt,
          model_id: 'raphael-basic',
          aspect: aspect || '1:1',
          number_of_images: Math.min(Math.max(parseInt(quantity) || 1, 1), 4),
          isSafeContent: true,
          autoTranslate: true,
        }),
      }, 45000);

      if (resp.ok) {
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
          } catch {}
        }
        if (images.length > 0) return images;
      }

      if (resp.status === 429) {
        await sleep(1500 * (attempt + 1));
        continue;
      }

      await sleep(1000);
    } catch {
      if (attempt < maxRetries - 1) await sleep(2000);
    }
  }

  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
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

    const images = await generateFromRaphael(prompt.trim(), aspect, quantity);

    if (!images || images.length === 0) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Generation failed after retries. Try again.' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, data: { images } }) };

  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
