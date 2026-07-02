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

    // ── POST /submit-ccsol ────────────────────────────────────────────────
    if (request.method === 'POST' && url.pathname === '/submit-ccsol') {
      let sequence;
      try {
        ({ sequence } = await request.json());
      } catch {
        return json({ error: 'Invalid JSON body' }, 400);
      }
      if (!sequence) return json({ error: 'Missing sequence' }, 400);

      const attributes = JSON.stringify({
        email: 'user@example.com',
        algorithm: 'ccsol_omics',
        submission_title: 'query',
        type_algorithm: 'old',
        command: 'ccsol_omics.py -text=Yes -output_dir=<output_dir>',
        type_submit: 'text',
        title: 'query',
        protein_seq: `>query\n${sequence}`,
      });

      const formData = new FormData();
      formData.append('type_submit', 'text');
      formData.append('attributes', attributes);

      try {
        const resp = await fetch('https://tools.tartaglialab.com/form_submit', {
          method: 'POST',
          body: formData,
        });
        const data = await resp.json();
        if (!data.task_id) return json({ error: 'No task_id from ccSOL' }, 502);
        const baseDir = data.url.replace(/index\.html.*/, '');
        const tableUrl = `${baseDir}table.${data.task_id}.html`;
        return json({ task_id: data.task_id, tableUrl });
      } catch (e) {
        return json({ error: e.message }, 502);
      }
    }

    // ── GET /poll-ccsol?tableUrl=... ──────────────────────────────────────
    if (url.pathname === '/poll-ccsol') {
      const tableUrl = url.searchParams.get('tableUrl');
      if (!tableUrl) return json({ error: 'Missing tableUrl' }, 400);

      try {
        const resp = await fetch(tableUrl);
        if (!resp.ok) return json({ ready: false });
        const html = await resp.text();
        const tds = [...html.matchAll(/<td>(\d+)<\/td>/g)];
        if (tds.length < 2) return json({ ready: false });
        const score = parseInt(tds[1][1]);
        const relMatch = html.match(/data-sort-value="(\d+)"/);
        const reliability = relMatch ? parseInt(relMatch[1]) : null;
        return json({ ready: true, score, reliability });
      } catch (e) {
        return json({ ready: false, error: e.message });
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
