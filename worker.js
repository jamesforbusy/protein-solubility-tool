// Cloudflare Worker — Protein-Sol CORS proxy
// 部署步驟：
// 1. 前往 https://dash.cloudflare.com → Workers & Pages → Create Worker
// 2. 將此檔案全部內容貼上
// 3. 按 Deploy，複製 Worker 網址
// 4. 將 index.html 第一個 <script> 裡的 WORKER_URL 換成該網址

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS });
    }

    const url = new URL(request.url);

    // ── GET /poll?jobId=xxx ───────────────────────────────────────────────
    if (url.pathname === '/poll') {
      const jobId = url.searchParams.get('jobId');
      if (!jobId) return json({ error: 'Missing jobId' }, 400);

      const resultUrl = `https://protein-sol.manchester.ac.uk/results/solubility/run-${jobId}/results.html`;
      try {
        const resp = await fetch(resultUrl);
        if (!resp.ok) return json({ ready: false });
        const html = await resp.text();
        const match = html.match(/Predicted scaled solubility:<\/h5>\s*<p[^>]*>([\d.]+)<\/p>/);
        if (match) {
          return json({ ready: true, score: parseFloat(match[1]), jobId });
        }
        return json({ ready: false, jobId });
      } catch (e) {
        return json({ ready: false, error: e.message });
      }
    }

    // ── POST /submit ──────────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/submit') {
      let sequence;
      try {
        ({ sequence } = await request.json());
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!sequence) return json({ error: 'Missing sequence' }, 400);

      const formBody = new URLSearchParams({
        'sequence-input': `>query\n${sequence}`,
        'singleprediction': 'Submit',
      });

      try {
        const resp = await fetch(
          'https://protein-sol.manchester.ac.uk/cgi-bin/solubility/sequenceprediction.php',
          {
            method: 'POST',
            body: formBody.toString(),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          }
        );
        const html = await resp.text();
        const match = html.match(/var timestamp = "([a-z0-9]+)"/);
        if (!match) return json({ error: 'Protein-Sol did not return a job ID' }, 502);
        return json({ jobId: match[1] });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    // ── POST /submit-soluprot ─────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/submit-soluprot') {
      let sequence;
      try {
        ({ sequence } = await request.json());
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!sequence) return json({ error: 'Missing sequence' }, 400);

      const formBody = new URLSearchParams({ fasta: `>query\n${sequence}` });
      try {
        const resp = await fetch('https://loschmidt.chemi.muni.cz/soluprot/', {
          method: 'POST',
          body: formBody.toString(),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const html = await resp.text();
        const match = html.match(/<td[^>]*text-align:center[^>]*>([\d.]+)<\/td>/);
        if (!match) return json({ error: 'SoluProt did not return a score' }, 502);
        return json({ score: parseFloat(match[1]) });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
