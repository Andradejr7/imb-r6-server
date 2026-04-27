const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const JOGADORES_TIME = [
  'IMB_And-', 'IMB_Gust', 'IMB_VnC', 'IMB_Shell',
  'IMB_Bimba', 'IMB_Gabkill', 'IMB_Bentoo', 'IMB_Dvk-',
];

// Headers que imitam o browser acessando o tracker.gg
const HEADERS_API = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Origin': 'https://tracker.gg',
  'Referer': 'https://tracker.gg/',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-site',
  'Connection': 'keep-alive',
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// Extrai o Match ID de qualquer formato de URL ou string
function extrairMatchId(input) {
  if (!input) return null;
  // Formato: https://tracker.gg/r6siege/matches/8c8c7819-3e87-483b-9da6-f8fadd09c78a
  // Ou só o UUID direto
  const match = input.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

// Rota principal: recebe URL ou Match ID e retorna dados formatados
app.get('/partida', async (req, res) => {
  const input = req.query.url || req.query.id || '';
  const matchId = extrairMatchId(input);

  if (!matchId) {
    return res.status(400).json({
      sucesso: false,
      erro: 'URL ou Match ID inválido. Use o formato: https://tracker.gg/r6siege/matches/SEU-MATCH-ID',
    });
  }

  try {
    console.log(`Buscando partida: ${matchId}`);

    // Tenta a API interna do tracker.gg
    const apiUrl = `https://api.tracker.gg/api/v1/r6siege/matches/${matchId}`;
    const response = await axios.get(apiUrl, {
      headers: HEADERS_API,
      timeout: 15000,
    });

    const data = response.data?.data || response.data;

    if (!data) {
      return res.status(404).json({ sucesso: false, erro: 'Partida não encontrada.' });
    }

    // Processa os dados retornados pela API
    const resultado = processarDadosPartida(data, matchId);
    res.json({ sucesso: true, ...resultado });

  } catch (error) {
    console.error('Erro API tracker.gg:', error.message);

    // Tenta endpoint alternativo
    try {
      const altUrl = `https://api.tracker.gg/api/v2/r6siege/standard/matches/${matchId}`;
      const altResponse = await axios.get(altUrl, {
        headers: HEADERS_API,
        timeout: 15000,
      });

      const data = altResponse.data?.data || altResponse.data;
      if (data) {
        const resultado = processarDadosPartida(data, matchId);
        return res.json({ sucesso: true, fonte: 'v2', ...resultado });
      }
    } catch (e2) {
      console.error('Erro API v2:', e2.message);
    }

    const status = error.response?.status;
    if (status === 403 || status === 401) {
      return res.status(403).json({
        sucesso: false,
        erro: 'tracker.gg bloqueou o acesso. Tente novamente em alguns minutos.',
        status,
      });
    }

    res.status(500).json({
      sucesso: false,
      erro: `Erro ao buscar partida: ${error.message}`,
      matchId,
    });
  }
});

function processarDadosPartida(data, matchId) {
  const jogadores = [];
  let mapa = 'Desconhecido';
  let resultado = 'unknown';
  let placar = '';
  let data_partida = new Date().toISOString().split('T')[0];

  try {
    // Extrai mapa
    mapa = data.metadata?.mapName ||
           data.map?.name ||
           data.attributes?.mapName ||
           data.mapName ||
           'Desconhecido';

    // Extrai data
    if (data.metadata?.timestamp || data.completedAt || data.startedAt) {
      const ts = data.metadata?.timestamp || data.completedAt || data.startedAt;
      data_partida = new Date(ts).toISOString().split('T')[0];
    }

    // Extrai placar
    const teams = data.teams || data.segments?.filter(s => s.type === 'team') || [];
    if (teams.length >= 2) {
      placar = `${teams[0]?.stats?.roundsWon?.value || 0}:${teams[1]?.stats?.roundsWon?.value || 0}`;
    }

    // Extrai jogadores
    const segments = data.segments || data.players || [];
    const playerSegments = segments.filter(s =>
      s.type === 'player' || s.attributes?.platformUserIdentifier || s.platformInfo
    );

    playerSegments.forEach(seg => {
      const nome = seg.platformInfo?.platformUserHandle ||
                   seg.attributes?.platformUserIdentifier ||
                   seg.player?.name ||
                   seg.name ||
                   '';

      if (!nome) return;

      const stats = seg.stats || {};

      const kills = parseInt(stats.kills?.value ?? stats.kills ?? 0);
      const deaths = parseInt(stats.deaths?.value ?? stats.deaths ?? 0);
      const assists = parseInt(stats.assists?.value ?? stats.assists ?? 0);
      const plants = parseInt(stats.plants?.value ?? stats.plants ?? 0);
      const hs = stats.headshots?.value ?? stats.headshots ?? 0;
      const kd = stats.kdRatio?.value ?? stats.kd ?? 0;

      // Detecta se é do time IMB
      const eDoTime = JOGADORES_TIME.some(j =>
        j.toLowerCase() === nome.toLowerCase()
      );

      // Detecta badges
      const badges = [];
      if (stats.ace?.value || stats.aces?.value > 0) badges.push('Ace');
      if (stats.clutches?.value > 0 || stats.clutchWins?.value > 0) badges.push('Clutch');

      // Detecta resultado do jogador
      const won = seg.metadata?.won ??
                  seg.won ??
                  seg.stats?.won?.value ??
                  false;

      if (won !== null && won !== undefined && resultado === 'unknown') {
        resultado = won ? 'win' : 'loss';
      }

      jogadores.push({
        nome,
        kills,
        deaths,
        assists,
        plants,
        kd: parseFloat(kd).toFixed(2),
        headshots: hs,
        badges,
        eDoTime,
        won,
      });
    });

    // Se não achou resultado ainda, tenta via won dos jogadores do time
    if (resultado === 'unknown' && jogadores.length > 0) {
      const doTime = jogadores.filter(j => j.eDoTime);
      if (doTime.length > 0) {
        resultado = doTime[0].won ? 'win' : 'loss';
      }
    }

  } catch (e) {
    console.error('Erro ao processar dados:', e.message);
  }

  // Filtra só jogadores do time IMB para a tabela principal
  const jogadoresDoTime = jogadores.filter(j => j.eDoTime);
  const todosJogadores = jogadores;

  return {
    matchId,
    mapa,
    data: data_partida,
    resultado,
    placar,
    jogadoresDoTime,
    todosJogadores,
    totalJogadores: jogadores.length,
  };
}

// Rota: busca partidas recentes de um jogador (para listar e selecionar)
app.get('/partidas/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const url = `https://api.tracker.gg/api/v1/r6siege/standard/profile/psn/${encodeURIComponent(username)}/sessions`;
    const response = await axios.get(url, { headers: HEADERS_API, timeout: 12000 });

    const sessions = response.data?.data?.items || response.data?.sessions || [];
    const partidas = sessions
      .filter(s => s.metadata?.playlist === 'ranked' || s.playlist === 'Ranked')
      .slice(0, 20)
      .map(s => ({
        matchId: s.attributes?.id || s.id,
        mapa: s.metadata?.mapName || s.mapName || 'Desconhecido',
        data: s.metadata?.timestamp || s.completedAt,
        resultado: s.metadata?.won ? 'win' : 'loss',
        placar: `${s.stats?.roundsWon?.value || 0}:${s.stats?.roundsLost?.value || 0}`,
        link: `https://tracker.gg/r6siege/matches/${s.attributes?.id || s.id}`,
      }));

    res.json({ sucesso: true, username, partidas });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// Lista jogadores do time
app.get('/time', (req, res) => res.json({ jogadores: JOGADORES_TIME }));

// Health check
app.get('/', (req, res) => res.json({
  status: 'online',
  versao: '4.0',
  mensagem: 'IMB R6 Tracker — Cole o link da partida!',
  uso: 'GET /partida?url=https://tracker.gg/r6siege/matches/SEU-ID',
  jogadores: JOGADORES_TIME,
}));

app.listen(PORT, () => {
  console.log(`Servidor v4 rodando na porta ${PORT}`);
});
