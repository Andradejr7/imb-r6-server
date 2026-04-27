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
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': 'https://r6.tracker.network/',
  'Origin': 'https://r6.tracker.network',
  'X-Warden-Challenge-Passed': 'true',
  'Sec-Ch-Ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
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

function diaDaPartida(dataObj) {
  const d = Math.floor((Date.now() - dataObj.getTime()) / (1000 * 60 * 60 * 24));
  if (d === 0) return 'Hoje';
  if (d === 1) return 'Ontem';
  return `${d} dias atrás`;
}

async function buscarPartidas(username) {
  // URL exata que o tracker.gg usa internamente
  const url = `https://api.tracker.gg/api/v2/r6siege/standard/matches/psn/${encodeURIComponent(username)}?gamemode=pvp_ranked`;
  
  console.log(`Buscando: ${url}`);
  const resp = await fetch(url, { headers: HEADERS });
  console.log(`Status: ${resp.status}`);
  
  if (!resp.ok) {
    // Tenta sem filtro de gamemode
    const url2 = `https://api.tracker.gg/api/v2/r6siege/standard/matches/psn/${encodeURIComponent(username)}`;
    console.log(`Tentando sem filtro: ${url2}`);
    const resp2 = await fetch(url2, { headers: HEADERS });
    console.log(`Status 2: ${resp2.status}`);
    if (!resp2.ok) throw new Error(`HTTP ${resp2.status}`);
    return resp2.json();
  }
  return resp.json();
}

function processarPartidas(data, username) {
  const matches = data?.data?.matches || data?.data?.items || data?.data || [];
  
  if (!Array.isArray(matches)) {
    console.log('Formato inesperado:', JSON.stringify(data).slice(0, 200));
    return [];
  }

  console.log(`${matches.length} partidas no total`);
  const agora = Date.now();
  const doisDias = 2 * 24 * 60 * 60 * 1000;

  return matches
    .map(match => {
      const meta = match?.metadata || match?.attributes || {};
      const segments = match?.segments || [];
      
      // Encontra stats do jogador dentro dos segments
      const playerSeg = segments.find(s => 
        s?.platformInfo?.platformUserHandle?.toLowerCase() === username.toLowerCase() ||
        s?.attributes?.platformUserIdentifier?.toLowerCase() === username.toLowerCase()
      ) || segments[0];

      const stats = playerSeg?.stats || match?.stats || {};
      const mapa = meta?.mapName || match?.mapName || meta?.map || 'Desconhecido';
      const ts = meta?.completedAt || meta?.timestamp || match?.completedAt;
      const dataObj = ts ? new Date(ts) : new Date();

      if ((agora - dataObj.getTime()) > doisDias) return null;

      const won = meta?.won ?? match?.won ?? playerSeg?.metadata?.won ?? stats?.won?.value;
      const kills = parseInt(stats?.kills?.value ?? stats?.kills ?? 0) || 0;
      const assists = parseInt(stats?.assists?.value ?? stats?.assists ?? 0) || 0;
      const deaths = parseInt(stats?.deaths?.value ?? stats?.deaths ?? 0) || 0;

      const rw = stats?.roundsWon?.value ?? meta?.roundsWon ?? 0;
      const rl = stats?.roundsLost?.value ?? meta?.roundsLost ?? 0;
      const placar = (rw || rl) ? `${rw}:${rl}` : '';

      const badges = [];
      if (parseInt(stats?.aces?.value || 0) > 0) badges.push('Ace');
      if (parseInt(stats?.clutchWins?.value || stats?.clutches?.value || 0) > 0) badges.push('Clutch');

      const chave = meta?.matchId || match?.id || match?.matchId || `${username}_${mapa}_${ts}`;
      const dataStr = dataObj.toISOString().split('T')[0];

      return {
        chave,
        matchId: chave,
        mapa,
        dia: diaDaPartida(dataObj),
        tempoRelativo: tempoRelativo(dataObj.toISOString()),
        data: dataStr,
        resultado: won === true || won === 'true' ? 'win' : 'loss',
        placar,
        jogadores: [{ nome: username, kills, assists, deaths, badges }],
        detectados: [username],
      };
    })
    .filter(Boolean)
    .slice(0, 15);
}

app.get('/sessao', async (req, res) => {
  const ref = req.query.ref || JOGADORES_TIME[0];
  const username = ref.split(',')[0].trim();

  try {
    console.log(`\n=== Sessão para: ${username} ===`);
    const data = await buscarPartidas(username);
    const todasPartidas = processarPartidas(data, username);
    console.log(`${todasPartidas.length} partidas nos últimos 2 dias`);

    // Cruza com outro jogador do time
    if (todasPartidas.length > 0) {
      for (const outro of JOGADORES_TIME.filter(j => j !== username).slice(0, 2)) {
        try {
          await new Promise(r => setTimeout(r, 600));
          const dataOutro = await buscarPartidas(outro);
          const partidasOutro = processarPartidas(dataOutro, outro);
          todasPartidas.forEach(p => {
            partidasOutro.forEach(po => {
              const diff = Math.abs(new Date(p.data).getTime() - new Date(po.data).getTime());
              if (p.mapa === po.mapa && diff <= 40 * 60 * 1000 && !p.detectados.includes(outro)) {
                p.detectados.push(outro);
                p.jogadores.push(...po.jogadores);
              }
            });
          });
        } catch(e) {
          console.log(`Não cruzou ${outro}: ${e.message}`);
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
  res.json({ status: 'online', versao: '9.0', jogadores: JOGADORES_TIME });
});

app.listen(PORT, () => console.log(`Servidor v9 rodando na porta ${PORT}`));
