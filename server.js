const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.options('*', cors());
app.use(express.json());

// Banco de dados PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Cria tabela se não existir
async function iniciarBanco() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS partidas (
        id SERIAL PRIMARY KEY,
        data DATE NOT NULL,
        mapa VARCHAR(100),
        resultado VARCHAR(10),
        placar VARCHAR(20),
        pontuacoes JSONB NOT NULL,
        ts BIGINT NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Banco de dados pronto!');
  } catch(e) {
    console.error('Erro ao criar tabela:', e.message);
  }
}

// GET /partidas — busca todas as partidas
app.get('/partidas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partidas ORDER BY ts DESC');
    const partidas = result.rows.map(r => ({
      id: r.id,
      data: r.data,
      mapa: r.mapa,
      resultado: r.resultado,
      placar: r.placar,
      pontuacoes: r.pontuacoes,
      ts: parseInt(r.ts),
    }));
    res.json({ sucesso: true, partidas });
  } catch(e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// POST /partidas — salva uma partida
app.post('/partidas', async (req, res) => {
  const { data, mapa, resultado, placar, pontuacoes, ts } = req.body;
  if (!data || !pontuacoes) {
    return res.status(400).json({ sucesso: false, erro: 'Dados incompletos' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO partidas (data, mapa, resultado, placar, pontuacoes, ts) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [data, mapa || '', resultado || '', placar || '', JSON.stringify(pontuacoes), ts || Date.now()]
    );
    res.json({ sucesso: true, id: result.rows[0].id });
  } catch(e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// DELETE /partidas/:id — apaga uma partida
app.delete('/partidas/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM partidas WHERE id = $1', [req.params.id]);
    res.json({ sucesso: true });
  } catch(e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// DELETE /partidas — apaga tudo
app.delete('/partidas', async (req, res) => {
  try {
    await pool.query('DELETE FROM partidas');
    res.json({ sucesso: true });
  } catch(e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'online', versao: '10.0', mensagem: 'IMB R6 Tracker — Banco de dados ativo!' });
});

iniciarBanco();
app.listen(PORT, () => console.log(`Servidor v10 rodando na porta ${PORT}`));
