const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

const JOGADORES_TIME = [
  'IMB_And-', 'IMB_Gust', 'IMB_VnC', 'IMB_Shell',
  'IMB_Bimba', 'IMB_Gabkill', 'IMB_Bentoo', 'IMB_Dvk-',
];

function extrairMatchId(input) {
  if (!input) return null;
  const match = input.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

app.get('/partida', async (req, res) => {
  const input = req.query.url || req.query.id || '';
  const matchId = extrairMatchId(input);

  if (!matchId) {
    return res.status(400).json({ sucesso: false, erro: 'URL inválida. Use: https://tracker.gg/r6siege/matches/SEU-ID' });
  }

  try {
    console.log(`Buscando partida: ${matchId}`);

    const apiUrl = `https://api.tracker.gg/api/v2/r6siege/standard/matches/${matchId}`;
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Origin': 'https://tracker.gg',
        'Referer': `https://tracker.gg/r6siege/matches/${matchId}`,
      }
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const resultado = processarDados(data, matchId);
    res.json({ sucesso: true, ...resultado });

  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({ sucesso: false, erro: error.message, matchId });
  }
});

function processarDados(data, matchId) {
  const payload = data?.data || data;
  const jogadores = [];
  let mapa = 'Desconhecido';
  let resultado = 'unknown';
  let placar = '';
  let dataPartida = new Date().toISOString().split('T')[0];

  try {
    mapa = payload?.metadata?.mapName || payload?.mapName || 'Desconhecido';
    const ts = payload?.metadata?.timestamp || payload?.completedAt;
    if (ts) dataPartida = new Date(ts).toISOString().split('T')[0];

    const segments = payload?.segments || [];
    const players = segments.filter(s => s.type === 'player' || s.platformInfo);

    players.forEach(seg => {
      const nome = seg?.platformInfo?.platformUserHandle || seg?.attributes?.platformUserIdentifier || '';
      if (!nome) return;

      const stats = seg?.stats || {};
      const kills = parseInt(stats?.kills?.value ?? 0);
      const assists = parseInt(stats?.assists?.value ?? 0);
      const deaths = parseInt(stats?.deaths?.value ?? 0);

      const badges = [];
      if ((stats?.aces?.value || 0) > 0) badges.push('Ace');
      if ((stats?.clutchWins?.value || 0) > 0) badges.push('Clutch');

      const won = seg?.metadata?.won ?? seg?.won;
      if (won !== undefined && resultado === 'unknown') resultado = won ? 'win' : 'loss';

      const eDoTime = JOGADORES_TIME.some(j => j.toLowerCase() === nome.toLowerCase());
      jogadores.push({ nome, kills, assists, deaths, badges, eDoTime, won });
    });

    const teams = segments.filter(s => s.type === 'team');
    if (teams.length >= 2) {
      placar = `${teams[0]?.stats?.roundsWon?.value || 0}:${teams[1]?.stats?.roundsWon?.value || 0}`;
    }

    if (resultado === 'unknown') {
      const doTime = jogadores.filter(j => j.eDoTime);
      if (doTime.length > 0) resultado = doTime[0].won ? 'win' : 'loss';
    }
  } catch (e) {
    console.error('Erro ao processar:', e.message);
  }

  return {
    matchId, mapa, data: dataPartida, resultado, placar,
    jogadoresDoTime: jogadores.filter(j => j.eDoTime),
    todosJogadores: jogadores,
  };
}

app.get('/', (req, res) => {
  res.json({ status: 'online', versao: '6.0', mensagem: 'IMB R6 Tracker Server!', jogadores: JOGADORES_TIME });
});

app.listen(PORT, () => console.log(`Servidor v6 rodando na porta ${PORT}`));
