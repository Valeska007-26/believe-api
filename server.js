const http = require('http');
const https = require('https');
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const BREVO_KEY = process.env.BREVO_API_KEY || '';
const FROM_EMAIL = 'valeskaponce3@gmail.com';
const COACHING_EMAIL = 'valeskaponce3@gmail.com';
const BREVO_LIST_ID = parseInt(process.env.BREVO_LIST_ID || '2');

// ─── 1. ANALISIS CON CLAUDE ───────────────────────────────────────
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
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(bodyData) }
  };
  const req = https.request(opts, function(res) {
    let data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) { cb(new Error(parsed.error.message || 'API error')); return; }
        const text = (parsed.content || []).map(function(b) { return b.text || ''; }).join('').trim();
        const start = text.indexOf('{'); const end = text.lastIndexOf('}');
        if (start === -1 || end === -1) { cb(new Error('No JSON found')); return; }
        cb(null, JSON.parse(text.substring(start, end + 1)));
      } catch(e) { cb(new Error('Parse error: ' + e.message)); }
    });
  });
  req.on('error', cb);
  req.write(bodyData);
  req.end();
}

// ─── 2. ENVIO DE EMAIL ────────────────────────────────────────────
function sendEmailBrevo(to, subject, htmlBody) {
  const emailData = JSON.stringify({
    sender: { name: 'Valeska Ponce — Believe', email: FROM_EMAIL },
    to: [{ email: to }],
    subject: subject,
    htmlContent: htmlBody
  });
  const opts = {
    hostname: 'api.brevo.com', path: '/v3/smtp/email', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY,
      'Content-Length': Buffer.byteLength(emailData) }
  };
  const req = https.request(opts, function(res) {
    let data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Email enviado OK a:', to);
      } else {
        console.error('Error Brevo email ' + res.statusCode + ':', data);
      }
    });
  });
  req.on('error', function(e) { console.error('Error email:', e.message); });
  req.write(emailData);
  req.end();
}

// ─── 3. GUARDAR LEAD EN LISTA DE BREVO ───────────────────────────
function saveLeadToBrevo(payload, score) {
  const nombre = (payload.nombre || '').trim();
  const partes = nombre.split(' ');
  const firstName = partes[0] || nombre;
  const lastName = partes.slice(1).join(' ') || '';
  const email = payload.email || '';
  if (!email) return;

  // Intenta actualizar si ya existe, si no crea nuevo contacto
  const contactData = JSON.stringify({
    email: email,
    attributes: {
      FIRSTNAME: firstName,
      LASTNAME: lastName,
      SMS: payload.telefono || '',
      ROL_ACTUAL: payload.rol_actual || '',
      META_POSICION: payload.meta_posicion || '',
      SALARIO_DESEADO: payload.salario_deseado || '',
      OBSTACULO: payload.obstaculo || '',
      CV_SCORE: score || 0,
      FUENTE: 'believe-web-cv',
      FECHA_LEAD: new Date().toISOString().split('T')[0]
    },
    listIds: [BREVO_LIST_ID],
    updateEnabled: true
  });

  const opts = {
    hostname: 'api.brevo.com', path: '/v3/contacts', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY,
      'Content-Length': Buffer.byteLength(contactData) }
  };
  const req = https.request(opts, function(res) {
    let data = '';
    res.on('data', function(chunk) { data += chunk; });
    res.on('end', function() {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('Lead guardado en Brevo:', email, '| Score:', score);
      } else {
        console.error('Error guardando lead en Brevo ' + res.statusCode + ':', data);
      }
    });
  });
  req.on('error', function(e) { console.error('Error saveLeadToBrevo:', e.message); });
  req.write(contactData);
  req.end();
}

// ─── 4. EMAILS + GUARDAR LEAD ────────────────────────────────────
function sendEmails(payload, diagnostico) {
  const nombre = payload.nombre || 'Candidato';
  const emailDestino = payload.email || '';
  if (!emailDestino) return;

  const score = diagnostico.score || '--';
  const quote = diagnostico.quote || '';
  const impacto = diagnostico.impacto || '';
  const fortalezas = (diagnostico.fortalezas || []).map(function(f) {
    return '<li style="margin-bottom:6px">' + f + '</li>';
  }).join('');
  const pasos = (diagnostico.proximos_pasos || []).map(function(p) {
    return '<li style="margin-bottom:6px">' + p + '</li>';
  }).join('');
  const gaps = diagnostico.gaps || {};
  const gapsHtml = Object.entries(gaps).map(function(entry) {
    return '<li style="margin-bottom:6px"><strong>' + entry[0] + ':</strong> ' + (entry[1] || []).join(', ') + '</li>';
  }).join('');

  // Email al usuario con su diagnóstico
  const htmlUsuario = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#f7f4ef;padding:20px">' +
    '<div style="background:#1a1610;padding:30px;border-radius:12px;text-align:center;margin-bottom:16px">' +
    '<h1 style="color:#c4922a;font-size:28px;margin:0;font-family:Georgia,serif">BELIEVE</h1>' +
    '<p style="color:#fff;margin:8px 0 0;font-size:13px">por Valeska Ponce · Coach de Carrera</p></div>' +
    '<div style="background:#fff;padding:28px;border-radius:12px;margin-bottom:16px">' +
    '<h2 style="color:#1a1610;margin:0 0 10px">Hola ' + nombre + ' 👋</h2>' +
    '<p style="color:#6b5e4a;font-size:15px;line-height:1.6;font-style:italic">"' + quote + '"</p></div>' +
    '<div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px;text-align:center">' +
    '<p style="color:#6b5e4a;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.1em">Tu Índice de Empleabilidad</p>' +
    '<div style="font-size:56px;font-weight:700;color:#c4922a;line-height:1">' + score + '<span style="font-size:24px">/100</span></div>' +
    '<p style="color:#6b5e4a;font-size:13px;margin:10px 0 0;line-height:1.5">' + impacto + '</p></div>' +
    '<div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px">' +
    '<h3 style="color:#1a1610;margin:0 0 14px;font-size:16px">✅ Tus Fortalezas</h3>' +
    '<ul style="color:#2c2418;font-size:14px;line-height:1.7;padding-left:20px;margin:0">' + fortalezas + '</ul></div>' +
    '<div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px">' +
    '<h3 style="color:#1a1610;margin:0 0 14px;font-size:16px">⚡ Áreas de Mejora</h3>' +
    '<ul style="color:#2c2418;font-size:14px;line-height:1.7;padding-left:20px;margin:0">' + gapsHtml + '</ul></div>' +
    '<div style="background:#fff;padding:24px;border-radius:12px;margin-bottom:16px">' +
    '<h3 style="color:#1a1610;margin:0 0 14px;font-size:16px">🎯 Próximos Pasos</h3>' +
    '<ul style="color:#2c2418;font-size:14px;line-height:1.7;padding-left:20px;margin:0">' + pasos + '</ul></div>' +
    '<div style="background:#1a1610;padding:28px;border-radius:12px;text-align:center">' +
    '<p style="color:#e8c97a;font-size:16px;font-weight:700;margin:0 0 8px">¿Lista para transformar este diagnóstico?</p>' +
    '<a href="https://wa.me/593980088203?text=Hola%20Valeska!%20Recibi%20mi%20diagnostico%20y%20quiero%20avanzar" ' +
    'style="display:inline-block;background:#c4922a;color:#1a1610;padding:14px 32px;border-radius:50px;font-weight:700;font-size:14px;text-decoration:none">' +
    '💬 Hablar con Valeska</a>' +
    '<p style="color:rgba(255,255,255,0.3);font-size:11px;margin:20px 0 0">Believe · valeskaponce3@gmail.com · +593 980088203</p></div>' +
    '</body></html>';

  sendEmailBrevo(emailDestino, 'Tu Diagnóstico Estratégico de CV — Believe', htmlUsuario);

  // Email a Valeska con datos del lead + score
  const htmlLead = '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">' +
    '<div style="background:#1a1610;padding:20px;border-radius:10px;text-align:center;margin-bottom:16px">' +
    '<h2 style="color:#c4922a;margin:0">🔔 Nuevo Lead — Believe</h2></div>' +
    '<div style="background:#f9f9f9;padding:20px;border-radius:10px;margin-bottom:16px">' +
    '<table style="width:100%;border-collapse:collapse">' +
    '<tr><td style="padding:8px 0;color:#666;width:40%"><strong>Nombre</strong></td><td style="padding:8px 0">' + nombre + '</td></tr>' +
    '<tr style="background:#fff"><td style="padding:8px 0;color:#666"><strong>Email</strong></td><td style="padding:8px 0">' + emailDestino + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666"><strong>WhatsApp</strong></td><td style="padding:8px 0">' + (payload.telefono || '--') + '</td></tr>' +
    '<tr style="background:#fff"><td style="padding:8px 0;color:#666"><strong>Rol actual</strong></td><td style="padding:8px 0">' + (payload.rol_actual || '--') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666"><strong>Meta</strong></td><td style="padding:8px 0">' + (payload.meta_posicion || '--') + '</td></tr>' +
    '<tr style="background:#fff"><td style="padding:8px 0;color:#666"><strong>Salario deseado</strong></td><td style="padding:8px 0">' + (payload.salario_deseado || '--') + '</td></tr>' +
    '<tr><td style="padding:8px 0;color:#666"><strong>Obstáculo</strong></td><td style="padding:8px 0">' + (payload.obstaculo || '--') + '</td></tr>' +
    '</table></div>' +
    '<div style="background:#c4922a;padding:20px;border-radius:10px;text-align:center;margin-bottom:16px">' +
    '<p style="color:#fff;font-size:14px;margin:0 0 6px">Score de Empleabilidad</p>' +
    '<div style="font-size:48px;font-weight:700;color:#fff">' + score + '<span style="font-size:20px">/100</span></div></div>' +
    '<div style="text-align:center;padding:16px">' +
    '<a href="https://wa.me/' + (payload.telefono || '').replace(/\D/g,'') + '" style="display:inline-block;background:#25D366;color:#fff;padding:14px 28px;border-radius:50px;font-weight:700;text-decoration:none;margin-right:10px">💬 WhatsApp</a>' +
    '<a href="mailto:' + emailDestino + '" style="display:inline-block;background:#1a1610;color:#fff;padding:14px 28px;border-radius:50px;font-weight:700;text-decoration:none">✉️ Email</a>' +
    '</div></div>';

  sendEmailBrevo(COACHING_EMAIL, '🔔 Nuevo lead: ' + nombre + ' — Score ' + score + '/100', htmlLead);

  // Guardar en lista de Brevo para seguimiento
  try { saveLeadToBrevo(payload, score); } catch(e) { console.error('saveLeadToBrevo error:', e.message); }
}

// ─── 5. SERVIDOR ─────────────────────────────────────────────────
const server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Believe API OK'); return; }
  if (req.method !== 'POST' || req.url !== '/analyze') { res.writeHead(404); res.end('Not found'); return; }
  let body = '';
  req.on('data', function(chunk) { body += chunk; });
  req.on('end', function() {
    try {
      const payload = JSON.parse(body);
      callClaude(payload, function(err, result) {
        if (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
          try { sendEmails(payload, result); } catch(e) { console.error('sendEmails error:', e.message); }
        }
      });
    } catch(e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, function() { console.log('Believe API running on port ' + PORT); });
