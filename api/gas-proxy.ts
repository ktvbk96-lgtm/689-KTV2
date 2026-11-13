export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const body = typeof req.body === 'string' ? (() => {
      try { return JSON.parse(req.body); } catch { return {}; }
    })() : (req.body || {});

    const targetUrl = (req.query?.url as string) || (body && body.url);
    if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.startsWith('http')) {
      return res.status(400).json({ success: false, error: 'Missing or invalid target Google Apps Script URL' });
    }

    if (targetUrl.includes('AKfycbwP7K5U-POS-689KTV-WEBAPP') || targetUrl.includes('AKfycb...')) {
      return res.status(200).json({
        success: false,
        error: 'Google Apps Script URL is placeholder (not deployed yet)',
        isPlaceholder: true,
      });
    }

    const method = req.method === 'POST' ? 'POST' : 'GET';
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 14000);

    let fetchUrl = targetUrl;
    const fetchOptions: RequestInit = {
      method,
      signal: controller.signal,
      redirect: 'follow',
    };

    if (method === 'GET') {
      const queryParams = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query || {})) {
        if (k !== 'url' && v !== undefined) {
          queryParams.append(k, Array.isArray(v) ? String(v[0]) : String(v));
        }
      }
      if (queryParams.toString()) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + queryParams.toString();
      }
      fetchOptions.headers = {
        Accept: 'application/json, text/plain, */*',
      };
    } else {
      fetchOptions.headers = {
        'Content-Type': 'text/plain;charset=utf-8',
      };
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(body);
    }

    const gasResponse = await fetch(fetchUrl, fetchOptions);
    clearTimeout(timeoutId);

    const responseText = await gasResponse.text();
    let responseJson: any = null;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      if (responseText.includes('accounts.google.com') || responseText.includes('Service Login')) {
        return res.status(200).json({
          success: false,
          error: 'Google Apps Script requires authorization. Please set "Who has access" to "Anyone" when deploying.',
        });
      }
      return res.status(200).json({
        success: gasResponse.ok,
        message: responseText.slice(0, 500),
      });
    }

    return res.status(200).json(responseJson);
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      return res.status(200).json({ success: false, error: 'Google Apps Script request timed out (14s)' });
    }
    return res.status(200).json({
      success: false,
      error: err?.message || 'Error connecting to Google Apps Script',
    });
  }
}
