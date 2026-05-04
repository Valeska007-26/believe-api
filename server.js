const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAKE_WEBHOOK = 'https://hook.us2.make.com/4eft8tidygmq8xuyc3n2zxxa5hqe25d4';

function callClaude(payload, cb) {
  const nombre = payload.nombre || 'Candidato';
  const rol = payload.rol_actual || 'Profesional';
  const meta = payload.meta_posicion || 'Crecer profesionalmente';
  const salario = payload.salario_deseado || 'No especificado';
  const obstaculo = payload.obstaculo || 'No especificado';
  const cv = (payload.cv_texto || 'Sin CV').substring(0, 2000);

  const prompt = 'Eres una experta headhunter. Analiza este perfil y devuelve UNICAMENTE un objeto JSON valido, sin texto adicional, sin markdown.\n\nNombre: ' + nombre + '\nRol: ' + rol + '\nMeta: ' + meta + '\nSalario: ' + salario + '\nObstaculo: ' + obstaculo + '\nCV: ' + cv + '\n\nDevuelve exactamente este JSON:\n{"score":45,"quote":"frase motivadora para ' + nombre + '","impacto":"analisis del CV","gaps":{"actitudes":["gap1","gap2"],"certificaciones":["cert1","cert2"],"conocimientos":["con1","con2"],"habilidades":["hab1","hab2"]},"preguntas_poder":["p1","p2","p3"],"fortalezas":["f1","f2","f3"],"proximos_pasos":["paso1","paso2","paso3"]}';

  const bodyData = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const opts = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(bodyData)
    }
  };

  const req = https.request(opts, function(res) {
    let data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) { cb(new Error(parsed.error.message || 'API error')); return; }
        const text = (parsed.content || []).map(function(b) { return b.text || ''; }).join('').trim();
        const start = text.indexOf('{');
        const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) { cb(new Error('No JSON found')); return; }
        cb(null, JSON.parse(text.substring(start, end + 1)));
      } catch(e) {
        cb(new Error('Parse error: ' + e.message));
      }
    });
  });
  req.on('error', cb);
  req.write(bodyData);
  req.end();
}

function sendToMake(payload) {
  try {
    const bodyData = JSON.stringify(payload);
    const url = new URL(MAKE_WEBHOOK);
    const opts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyData) }
    };
    const req = https.request(opts, function(res) { res.resume(); });
    req.on('error', function() {});
    req.write(bodyData);
    req.end();
  } catch(e) {}
}

const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Believe API OK');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/analyze') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    try {
      const payload = JSON.parse(body);
      sendToMake(payload);
      callClaude(payload, function(err, result) {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        }
      });
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, function() {
  console.log('Believe API running on port ' + PORT);
});
