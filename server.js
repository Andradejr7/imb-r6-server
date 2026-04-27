const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.options('*', cors());
app.use(express.json());

const JOGADORES_TIME = [
  'IMB_And-', 'IMB_Gust', 'IMB_VnC', 'IMB_Shell',
  'IMB_Bimba', 'IMB_Gabkill', 'IMB_Bentoo', 'IMB_Dvk-',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/html, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
  'Referer': 'https://r6.tracker.network/',
  'Origin': 'https://r6.tracker.network',
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Busca partidas ranked de um jogador via API do tracker.gg
async function buscarPartidasJogador(username) {
  const plataformas = ['psn', 'xbl', 'pc'];
  
  for (const plat of plataformas) {
    try {
      const url = `https://api.tracker.gg/api/v2/r6siege/standard/profile/${plat}/${encodeURIComponent(username)}/segments/match?type=pvp_ranked&next=0`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data?.data?.items?.length > 0) {
        return { plataforma: plat, partidas: data.data.items };
      }
    } catch(e) {
      continue;
    }
  }

  // Fallback: tenta URL de matches direto
  for (const plat of plataformas) {
    try {
      const url = `https://api.tracker.gg/api/v2/r6siege/standard/profile/${plat}/${encodeURIComponent(username)}/matches?gamemode=pvp_ranked`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = data?.data?.matches || data?.data?.items || data?.data || [];
      if (Array.isArray(items) && items.length > 0) {
        return { plataforma: plat, partidas: items };
      }
    } catch(e) {
      continue;
    }
  }

  return { plataforma: null, partidas: [] };
}

function processarPartida(item, username) {
  // Extrai dados do match
  const meta = item?.metadata || item?.attributes || {};
  const stats = item?.stats || {};
  const segments = item?.segments || [];

  // Mapa
  const mapa = meta?.mapName || meta?.map || item?.mapName || 'Desconhecido';

  // Data e tempo relativo
  const ts = meta?.timestamp || meta?.completedAt || item?.completedAt || item?.startedAt;
  const dataPartida = ts ? new Date(ts) : new Date();
  const dataStr = dataPartida.toISOString().split('T')[0];
  const diffMs = Date.now() - dataPartida.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMin / 60);
  const diffD = Math.floor(diffH / 24);

  let tempoRelativo = '';
  if (diffD > 0) tempoRelativo = `${diffD}d ago`;
  else if (diffH > 0) tempoRelativo = `${diffH}h ago`;
  else tempoRelativo = `${diffMin}m ago`;

  const dia = diffD === 0 ? 'Hoje' : diffD === 1 ? 'Ontem' : `${diffD} dias atrás`;

  // Resultado
  let resultado = 'unknown';
  const won = meta?.won ?? item?.won ?? stats?.won?.value;
  if (won === true || won === 'true') resultado = 'win';
  else if (won === false || won === 'false') resultado = 'loss';

  // Placar
  let placar = '';
  const rw = stats?.roundsWon?.value ?? meta?.roundsWon;
  const rl = stats?.roundsLost?.value ?? meta?.roundsLost;
  if (rw !== undefined && rl !== undefined) placar = `${rw}:${rl}`;

  // Kills/Assists do jogador de referência
  const kills = parseInt(stats?.kills?.value ?? stats?.kills ?? 0);
  const assists = parseInt(stats?.assists?.value ?? stats?.assists ?? 0);
  const deaths = parseInt(stats?.deaths?.value ?? stats?.deaths ?? 0);

  const badges = [];
  if ((stats?.aces?.value || 0) > 0) badges.push('Ace');
  if ((stats?.clutchWins?.value || 0) > 0) badges.push('Clutch');

  const chave = meta?.matchId || item?.matchId || item?.id || `${username}_${mapa}_${ts}`;

  return {
    chave,
    matchId: chave,
    mapa,
    dia,
    tempoRelativo,
    data: dataStr,
    resultado,
    placar,
    jogadores: [{ nome: username, kills, assists, deaths, badges }],
    detectados: [username],
  };
}

// GET /sessao?ref=IMB_And- — busca partidas do jogador de referência
app.get('/sessao', async (req, res) => {
  const ref = req.query.ref || req.query.jogadores || JOGADORES_TIME[0];
  const username = ref.split(',')[0].trim();

  try {
    console.log(`Buscando partidas de: ${username}`);
    const { partidas, plataforma } = await buscarPartidasJogador(username);

    if (!partidas.length) {
      return res.json({ sucesso: true, todasPartidas: [], mensagem: 'Nenhuma partida encontrada nos últimos 2 dias' });
    }

    console.log(`${partidas.length} partidas encontradas na plataforma ${plataforma}`);

    // Filtra últimos 2 dias e modalidade ranked
    const agora = Date.now();
    const doisDias = 2 * 24 * 60 * 60 * 1000;

    const todasPartidas = partidas
      .map(p => processarPartida(p, username))
      .filter(p => {
        const ts = new Date(p.data).getTime();
        return (agora - ts) <= doisDias;
      })
      .slice(0, 15);

    // Tenta cruzar com 1-2 outros jogadores do time
    const outros = JOGADORES_TIME.filter(j => j !== username).slice(0, 2);
    for (const outro of outros) {
      try {
        await delay(600);
        const { partidas: pOutro } = await buscarPartidasJogador(outro);
        pOutro.forEach(po => {
          const pProcessado = processarPartida(po, outro);
          todasPartidas.forEach(p => {
            const diff = Math.abs(new Date(p.data).getTime() - new Date(pProcessado.data).getTime());
            if (p.mapa === pProcessado.mapa && diff <= 30 * 60 * 1000) {
              if (!p.detectados.includes(outro)) {
                p.detectados.push(outro);
                p.jogadores.push(...pProcessado.jogadores);
              }
            }
          });
        });
      } catch(e) {
        console.log(`Não conseguiu cruzar com ${outro}: ${e.message}`);
      }
    }

    res.json({ sucesso: true, todasPartidas, plataforma, ref: username });

  } catch (e) {
    console.error('Erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// GET /partidas/:username — alias para sessao
app.get('/partidas/:username', async (req, res) => {
  req.query.ref = req.params.username;
  const { partidas, plataforma } = await buscarPartidasJogador(req.params.username);
  const agora = Date.now();
  const doisDias = 2 * 24 * 60 * 60 * 1000;
  const resultado = partidas
    .map(p => processarPartida(p, req.params.username))
    .filter(p => (agora - new Date(p.data).getTime()) <= doisDias)
    .slice(0, 15);
  res.json({ sucesso: true, partidas: resultado, plataforma });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'online', versao: '7.0', mensagem: 'IMB R6 Tracker Server!', jogadores: JOGADORES_TIME });
});

app.listen(PORT, () => console.log(`Servidor v7 rodando na porta ${PORT}`));
