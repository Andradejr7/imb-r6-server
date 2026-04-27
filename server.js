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
  'Accept': 'application/json, text/html, */*;q=0.9',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://r6.tracker.network/',
  'Origin': 'https://r6.tracker.network',
  'Cache-Control': 'no-cache',
};

function tempoRelativo(dataStr) {
  const diff = Date.now() - new Date(dataStr).getTime();
  const min = Math.floor(diff / 60000);
  const h = Math.floor(min / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ago`;
  if (h > 0) return `${h}h ago`;
  return `${min}m ago`;
}

function diaDaPartida(dataStr) {
  const diff = Date.now() - new Date(dataStr).getTime();
  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  return `${d} dias atrás`;
}

async function buscarPartidasAPI(username) {
  // Tenta API interna do tracker.gg (usada pelo site deles)
  const urls = [
    `https://api.tracker.gg/api/v2/r6siege/standard/profile/psn/${encodeURIComponent(username)}/segments/match?type=pvp_ranked`,
    `https://api.tracker.gg/api/v2/r6siege/standard/profile/xbl/${encodeURIComponent(username)}/segments/match?type=pvp_ranked`,
    `https://api.tracker.gg/api/v2/r6siege/standard/profile/pc/${encodeURIComponent(username)}/segments/match?type=pvp_ranked`,
    // URL alternativa sem filtro de gamemode
    `https://api.tracker.gg/api/v2/r6siege/standard/profile/psn/${encodeURIComponent(username)}/segments/match`,
  ];

  for (const url of urls) {
    try {
      console.log(`Tentando: ${url}`);
      const resp = await fetch(url, { headers: HEADERS });
      console.log(`Status: ${resp.status}`);
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = data?.data?.items || data?.data?.segments || data?.data || [];
      if (Array.isArray(items) && items.length > 0) {
        console.log(`Sucesso! ${items.length} partidas`);
        return items;
      }
    } catch (e) {
      console.log(`Erro em ${url}: ${e.message}`);
    }
  }
  return [];
}

function processarItem(item, username) {
  const meta = item?.metadata || item?.attributes || item || {};
  const stats = item?.stats || {};

  const mapa = meta?.mapName || meta?.map || item?.mapName || 'Desconhecido';
  const ts = meta?.timestamp || meta?.completedAt || item?.completedAt || item?.startedAt;
  const dataObj = ts ? new Date(ts) : new Date();
  const dataStr = dataObj.toISOString().split('T')[0];

  // Filtra só últimos 2 dias
  const diffDias = (Date.now() - dataObj.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDias > 2) return null;

  const won = meta?.won ?? item?.won ?? stats?.won?.value;
  const resultado = won === true || won === 'true' ? 'win' : 'loss';

  const kills = parseInt(stats?.kills?.value ?? stats?.kills ?? 0) || 0;
  const assists = parseInt(stats?.assists?.value ?? stats?.assists ?? 0) || 0;
  const deaths = parseInt(stats?.deaths?.value ?? stats?.deaths ?? 0) || 0;

  const rw = stats?.roundsWon?.value ?? meta?.roundsWon ?? 0;
  const rl = stats?.roundsLost?.value ?? meta?.roundsLost ?? 0;
  const placar = (rw || rl) ? `${rw}:${rl}` : '';

  const badges = [];
  if (parseInt(stats?.aces?.value || 0) > 0) badges.push('Ace');
  if (parseInt(stats?.clutchWins?.value || stats?.clutches?.value || 0) > 0) badges.push('Clutch');

  const chave = meta?.matchId || item?.id || `${username}_${mapa}_${ts}`;

  return {
    chave,
    matchId: chave,
    mapa,
    dia: diaDaPartida(dataStr),
    tempoRelativo: tempoRelativo(dataObj.toISOString()),
    data: dataStr,
    resultado,
    placar,
    jogadores: [{ nome: username, kills, assists, deaths, badges }],
    detectados: [username],
  };
}

app.get('/sessao', async (req, res) => {
  const ref = req.query.ref || req.query.jogadores || JOGADORES_TIME[0];
  const username = ref.split(',')[0].trim();

  try {
    console.log(`\n=== Buscando partidas de: ${username} ===`);
    const items = await buscarPartidasAPI(username);

    if (!items.length) {
      return res.json({ sucesso: true, todasPartidas: [], mensagem: 'Nenhuma partida encontrada' });
    }

    const todasPartidas = items
      .map(p => processarItem(p, username))
      .filter(Boolean)
      .slice(0, 15);

    console.log(`${todasPartidas.length} partidas nos últimos 2 dias`);

    // Tenta cruzar com 1 outro jogador do time para detectar squad
    if (todasPartidas.length > 0) {
      const outro = JOGADORES_TIME.find(j => j !== username);
      if (outro) {
        try {
          await new Promise(r => setTimeout(r, 500));
          const itemsOutro = await buscarPartidasAPI(outro);
          const partidasOutro = itemsOutro.map(p => processarItem(p, outro)).filter(Boolean);
          
          todasPartidas.forEach(p => {
            partidasOutro.forEach(po => {
              const diff = Math.abs(new Date(p.data).getTime() - new Date(po.data).getTime());
              if (p.mapa === po.mapa && diff <= 35 * 60 * 1000) {
                if (!p.detectados.includes(outro)) {
                  p.detectados.push(outro);
                  p.jogadores.push(...po.jogadores);
                }
              }
            });
          });
        } catch(e) {
          console.log(`Não cruzou com ${outro}: ${e.message}`);
        }
      }
    }

    res.json({ sucesso: true, todasPartidas, ref: username });
  } catch (e) {
    console.error('Erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.get('/', (req, res) => {
  res.json({ status: 'online', versao: '8.0', mensagem: 'IMB R6 Tracker Server!', jogadores: JOGADORES_TIME });
});

app.listen(PORT, () => console.log(`Servidor v8 rodando na porta ${PORT}`));
