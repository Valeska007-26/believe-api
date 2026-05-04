{
  "name": "believe-api",
  "version": "1.0.0",
  "description": "Believe CV Analyzer API",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "engines": {
    "node": ">=18"
  }
}

services:
  - type: web
    name: believe-api
    env: node
    buildCommand: ""
    startCommand: node server.js
    envVars:
      - key: ANTHROPIC_API_KEY
        sync: false

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MAKE_WEBHOOK = 'https://hook.us2.make.com/4eft8tidygmq8xuyc3n2zxxa5hqe25d4';

function callClaude(payload) {
  return new Promise((resolve, reject) => {
    const prompt = `Actúa como una experta en Selección de Talento y Headhunter de perfiles de alto nivel. He recibido el CV de un candidato que se siente estancado.

Tu misión NO es reescribir el CV, sino realizar un Diagnóstico de Quiebre Profesional que lo prepare para mi mentoría.

Estructura del Informe:
1. Análisis de Impacto Inmediato: ¿Qué proyecta este CV en los primeros 6 segundos? (Sé honesta y directa sobre si proyecta liderazgo o solo operatividad).
2. Matriz de Puntos Ciegos: Identifica 3 debilidades críticas que están bloqueando su ascenso o aumento de sueldo.
3. La Brecha del Líder: Explica qué le falta para llegar a posiciones de Jefatura, Gerencia o Dirección.
4. Preguntas de Poder: Redacta 3 preguntas profundas basadas en su CV que le hagan cuestionar su estrategia actual.
5. El Puente a la Mentoría: Concluye mencionando que estas limitaciones son el foco de la Mentoría BE LIEVE.

Tono: Profesional, desafiante, tipo Mentes Expertas. Que sienta que necesita guía para salir del bucle.

Datos del candidato:
Nombre: ${payload.nombre}
Rol actual: ${payload.rol_actual}
Meta: ${payload.meta_posicion}
Salario deseado: ${payload.salario_deseado}
Obstáculo: ${payload.obstaculo}
CV: ${(payload.cv_texto || '').substring(0, 3000)}

Responde SOLO con JSON válido sin texto extra:
{
  "score": [número entre 25 y 65],
  "quote": "[2-3 oraciones personalizadas, empáticas y directas para ${payload.nombre}]",
  "impacto": "[análisis de impacto inmediato en 2-3 oraciones]",
  "gaps": {
    "actitudes": ["gap 1", "gap 2"],
    "certificaciones": ["cert 1", "cert 2"],
    "conocimientos": ["conocimiento 1", "conocimiento 2"],
    "habilidades": ["habilidad 1", "habilidad 2"]
  },
  "preguntas_poder": ["pregunta 1", "pregunta 2", "pregunta 3"],
  "fortalezas": ["fortaleza 1", "fortaleza 2", "fortaleza 3"],
  "proximos_pasos": ["paso 1", "paso 2", "paso 3"]
}`;

    const body = JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const text = parsed.content?.map(b => b.text || '').join('') || '';
          const clean = text.replace(/```json|```/g, '').trim();
          const result = JSON.parse(clean);
          resolve(result);
        } catch(e) {
          reject(new Error('Parse error: ' + e.message + ' | Raw: ' + data.substring(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendToMake(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url = new URL(MAKE_WEBHOOK);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => { res.resume(); resolve(); });
    req.on('error', () => resolve());
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }
  if (req.method === 'GET') {
    res.writeHead(200, {'Content-Type': 'text/plain'});
    res.end('Believe API Server OK - Running');
    return;
  }
  if (req.method !== 'POST' || req.url !== '/analyze') {
    res.writeHead(404); res.end('Not found'); return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    try {
      const payload = JSON.parse(body);
      // Fire & forget to Make
      sendToMake(payload).catch(() => {});
      // Call Claude and return result
      const result = await callClaude(payload);
      res.writeHead(200, {'Content-Type': 'application/json'});
      res.end(JSON.stringify(result));
    } catch(e) {
      res.writeHead(500, {'Content-Type': 'application/json'});
      res.end(JSON.stringify({ error: e.message }));
    }
  });
});

server.listen(PORT, () => console.log('Believe API running on port ' + PORT));
