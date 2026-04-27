const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const JOGADORES_TIME = [
  'IMB_And-', 'IMB_Gust', 'IMB_VnC', 'IMB_Shell',
  'IMB_Bimba', 'IMB_Gabkill', 'IMB_Bentoo', 'IMB_Dvk-',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Referer': 'https://tracker.gg/',
};

function extrairMatchId(input) {
  if (!input) return null;
  const match = input.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return match ? match[1] : null;
}

// Rota principal: recebe link ou ID da partida
app.get('/partida', async (req, res) => {
  const input = req.query.url || req.query.id || '';
  const matchId = extrairMatchId(input);

  if (!matchId) {
    return res.status(400).json({
      sucesso: false,
      erro: 'URL inválida. Use: https://tracker.gg/r6siege/matches/SEU-MATCH-ID',
    });
  }

  try {
    console.log(`Buscando partida: ${matchId}`);

    // Tenta API interna do tracker.gg
    const apiUrls = [
      `https://api.tracker.gg/api/v2/r6siege/standard/matches/${matchId}`,
      `https://api.tracker.gg/api/v1/r6siege/matches/${matchId}`,
    ];

    let dadosPartida = null;

    for (const apiUrl of apiUrls) {
      try {
        const response = await axios.get(apiUrl, {
          headers: {
            ...HEADERS,
            'Origin': 'https://tracker.gg',
            'Referer': `https://tracker.gg/r6siege/matches/${matchId}`,
          },
          timeout: 12000,
        });
        if (response.data) {
          dadosPartida = response.data;
          console.log(`Dados obtidos via: ${apiUrl}`);
          break;
        }
      } catch (e) {
        console.log(`Falhou ${apiUrl}: ${e.message}`);
      }
    }

    // Se API não funcionou, tenta página HTML
    if (!dadosPartida) {
      const htmlUrl = `https://tracker.gg/r6siege/matches/${matchId}`;
      const htmlResp = await axios.get(htmlUrl, {
        headers: HEADERS,
        timeout: 15000,
      });

      const html = htmlResp.data;
      const $ = cheerio.load(html);

      // Tenta extrair do JSON embutido
      const scripts = $('script').toArray();
      for (const script of scripts) {
        const content = $(script).html() || '';
        if (content.includes('matchId') || content.includes('platformUserHandle')) {
          try {
            // Procura por dados JSON
            const jsonMatch = content.match(/\{[\s\S]*"segments"[\s\S]*\}/);
            if (jsonMatch) {
              dadosPartida = { data: JSON.parse(jsonMatch[0]) };
              break;
            }
          } catch (e) { /* continua */ }
        }
      }

      // Extrai direto do HTML se JSON não encontrado
      if (!dadosPartida) {
        const jogadores = [];
        let mapa = 'Desconhecido';
        let resultado = 'unknown';

        // Extrai mapa
        const mapaEl = $('[class*="map"], [class*="Map"]').first().text().trim();
        if (mapaEl) mapa = mapaEl;

        // Extrai jogadores da tabela
        $('[class*="player"], [class*="Player"], tr').each((i, el) => {
          const texto = $(el).text().replace(/\s+/g, ' ').trim();
          const nomeEl = $(el).find('[class*="name"], [class*="Name"], [class*="username"]').first().text().trim();

          if (!nomeEl) return;

          const nums = texto.match(/\d+/g) || [];
          jogadores.push({
            nome: nomeEl,
            kills: parseInt(nums[0]) || 0,
            assists: parseInt(nums[2]) || 0,
            deaths: parseInt(nums[1]) || 0,
            eDoTime: JOGADORES_TIME.some(j => j.toLowerCase() === nomeEl.toLowerCase()),
          });
        });

        return res.json({
          sucesso: true,
          matchId,
          mapa,
          resultado,
          jogadoresDoTime: jogadores.filter(j => j.eDoTime),
          todosJogadores: jogadores,
          fonte: 'html',
        });
      }
    }

    // Processa os dados da API
    const resultado = processarDados(dadosPartida, matchId);
    res.json({ sucesso: true, ...resultado });

  } catch (error) {
    console.error('Erro:', error.message);
    res.status(500).json({
      sucesso: false,
      erro: `Erro ao buscar partida: ${error.message}`,
      matchId,
    });
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
    // Extrai mapa
    mapa = payload?.metadata?.mapName ||
           payload?.map?.name ||
           payload?.attributes?.mapName ||
           payload?.mapName || 'Desconhecido';

    // Extrai data
    const ts = payload?.metadata?.timestamp || payload?.completedAt || payload?.startedAt;
    if (ts) dataPartida = new Date(ts).toISOString().split('T')[0];

    // Extrai jogadores dos segments
    const segments = payload?.segments || payload?.players || [];
    const playerSegments = Array.isArray(segments)
      ? segments.filter(s => s.type === 'player' || s.platformInfo || s.attributes?.platformUserIdentifier)
      : [];

    playerSegments.forEach(seg => {
      const nome = seg?.platformInfo?.platformUserHandle ||
                   seg?.attributes?.platformUserIdentifier ||
                   seg?.player?.name || '';
      if (!nome) return;

      const stats = seg?.stats || {};
      const kills = parseInt(stats?.kills?.value ?? stats?.kills ?? 0);
      const deaths = parseInt(stats?.deaths?.value ?? stats?.deaths ?? 0);
      const assists = parseInt(stats?.assists?.value ?? stats?.assists ?? 0);
      const kd = parseFloat(stats?.kdRatio?.value ?? stats?.kd ?? 0).toFixed(2);

      const badges = [];
      if ((stats?.aces?.value || 0) > 0 || stats?.ace?.value) badges.push('Ace');
      if ((stats?.clutchWins?.value || 0) > 0 || (stats?.clutches?.value || 0) > 0) badges.push('Clutch');

      const won = seg?.metadata?.won ?? seg?.won ?? seg?.stats?.won?.value;
      if (won !== null && won !== undefined && resultado === 'unknown') {
        resultado = won ? 'win' : 'loss';
      }

      const eDoTime = JOGADORES_TIME.some(j => j.toLowerCase() === nome.toLowerCase());

      jogadores.push({ nome, kills, deaths, assists, kd, badges, eDoTime, won });
    });

    // Placar via teams
    const teams = Array.isArray(payload?.teams) ? payload.teams :
                  (Array.isArray(segments) ? segments.filter(s => s.type === 'team') : []);
    if (teams.length >= 2) {
      const r1 = teams[0]?.stats?.roundsWon?.value || 0;
      const r2 = teams[1]?.stats?.roundsWon?.value || 0;
      placar = `${r1}:${r2}`;
    }

    // Resultado via jogadores do time
    if (resultado === 'unknown') {
      const doTime = jogadores.filter(j => j.eDoTime);
      if (doTime.length > 0 && doTime[0].won !== undefined) {
        resultado = doTime[0].won ? 'win' : 'loss';
      }
    }

  } catch (e) {
    console.error('Erro ao processar:', e.message);
  }

  return {
    matchId,
    mapa,
    data: dataPartida,
    resultado,
    placar,
    jogadoresDoTime: jogadores.filter(j => j.eDoTime),
    todosJogadores: jogadores,
  };
}

// Rota legada: busca partidas por jogador (mantida para compatibilidade)
app.get('/partidas/:username', async (req, res) => {
  res.json({
    sucesso: false,
    erro: 'Use o link da partida: /partida?url=https://tracker.gg/r6siege/matches/ID',
    dica: 'Abra o tracker.gg, clique na partida e copie o link da URL',
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'online',
    versao: '5.0',
    mensagem: 'IMB R6 Tracker — Cole o link da partida!',
    uso: '/partida?url=https://tracker.gg/r6siege/matches/SEU-ID',
    jogadores: JOGADORES_TIME,
  });
});

app.listen(PORT, () => {
  console.log(`Servidor v5 rodando na porta ${PORT}`);
});
