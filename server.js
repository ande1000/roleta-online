const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(cors());
app.use(express.json());

// ===== BANCO DE DADOS EM MEMÓRIA =====
// (reinicia quando o servidor reinicia - para produção real, usar MongoDB/PostgreSQL)
const jogadores = {}; // { nomeJogador: { saldo, online } }

// ===== WEBSOCKET - CONEXÕES =====
const conexoesJogadores = new Map(); // ws -> nome do jogador
const conexoesPainel = new Set();    // painéis conectados

wss.on('connection', (ws) => {
    console.log('🔌 Nova conexão WebSocket');

    ws.on('message', (message) => {
        try {
            const dados = JSON.parse(message);

            // ===== JOGADOR SE IDENTIFICA =====
            if (dados.tipo === 'jogador') {
                const nome = (dados.nome || '').trim();

                if (!nome) {
                    ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Nome inválido' }));
                    return;
                }

                // Cria o jogador se não existir (saldo inicial = 0)
                if (!jogadores[nome]) {
                    jogadores[nome] = { saldo: 0, online: true };
                    console.log(`👤 Novo jogador: ${nome} (saldo: R$ 0,00)`);
                } else {
                    jogadores[nome].online = true;
                    console.log(`👤 Jogador reconectado: ${nome} (saldo: R$ ${jogadores[nome].saldo.toFixed(2)})`);
                }

                conexoesJogadores.set(ws, nome);

                // Envia o saldo atual
                ws.send(JSON.stringify({
                    tipo: 'saldo',
                    saldo: jogadores[nome].saldo
                }));

                // Atualiza o painel
                notificarPainel();
            }

            // ===== PAINEL SE CONECTA =====
            if (dados.tipo === 'painel') {
                conexoesPainel.add(ws);
                console.log('🎛️ Painel conectado');

                ws.send(JSON.stringify({
                    tipo: 'lista',
                    jogadores: Object.entries(jogadores).map(([nome, info]) => ({
                        nome,
                        saldo: info.saldo,
                        online: info.online
                    }))
                }));
            }

            // ===== PAINEL ADICIONA SALDO =====
            if (dados.tipo === 'adicionarSaldo') {
                const { nome, valor } = dados;

                if (!jogadores[nome]) {
                    ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Jogador não encontrado' }));
                    return;
                }

                if (typeof valor !== 'number' || valor <= 0) {
                    ws.send(JSON.stringify({ tipo: 'erro', mensagem: 'Valor inválido' }));
                    return;
                }

                jogadores[nome].saldo += valor;
                console.log(`💰 ${nome} +R$ ${valor.toFixed(2)} (saldo: R$ ${jogadores[nome].saldo.toFixed(2)})`);

                // Avisa a roleta do jogador
                for (const [cliente, nomeCliente] of conexoesJogadores.entries()) {
                    if (nomeCliente === nome && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'saldo',
                            saldo: jogadores[nome].saldo
                        }));
                    }
                }

                notificarPainel();

                ws.send(JSON.stringify({
                    tipo: 'sucesso',
                    mensagem: `R$ ${valor.toFixed(2)} adicionado para ${nome}`
                }));
            }

            // ===== PAINEL REMOVE SALDO =====
            if (dados.tipo === 'removerSaldo') {
                const { nome, valor } = dados;

                if (!jogadores[nome]) return;

                jogadores[nome].saldo = Math.max(0, jogadores[nome].saldo - valor);
                console.log(`💸 ${nome} -R$ ${valor.toFixed(2)} (saldo: R$ ${jogadores[nome].saldo.toFixed(2)})`);

                for (const [cliente, nomeCliente] of conexoesJogadores.entries()) {
                    if (nomeCliente === nome && cliente.readyState === WebSocket.OPEN) {
                        cliente.send(JSON.stringify({
                            tipo: 'saldo',
                            saldo: jogadores[nome].saldo
                        }));
                    }
                }

                notificarPainel();
            }

            // ===== JOGADOR ATUALIZA SALDO APÓS O JOGO =====
            if (dados.tipo === 'atualizarSaldoJogo') {
                const nome = conexoesJogadores.get(ws);
                if (!nome || !jogadores[nome]) return;

                jogadores[nome].saldo = dados.novoSaldo;
                notificarPainel();
            }

        } catch (e) {
            console.error('Erro ao processar mensagem:', e);
        }
    });

    ws.on('close', () => {
        // Se era um jogador, marca como offline
        if (conexoesJogadores.has(ws)) {
            const nome = conexoesJogadores.get(ws);
            if (jogadores[nome]) {
                jogadores[nome].online = false;
            }
            conexoesJogadores.delete(ws);
            notificarPainel();
            console.log(`👋 ${nome} desconectou`);
        }

        // Se era um painel, remove
        conexoesPainel.delete(ws);
    });
});

// ===== NOTIFICA TODOS OS PAINÉIS =====
function notificarPainel() {
    const lista = Object.entries(jogadores).map(([nome, info]) => ({
        nome,
        saldo: info.saldo,
        online: info.online
    }));

    const mensagem = JSON.stringify({ tipo: 'lista', jogadores: lista });

    for (const painel of conexoesPainel) {
        if (painel.readyState === WebSocket.OPEN) {
            painel.send(mensagem);
        }
    }
}

// ===== ROTA DE STATUS =====
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        jogadores: Object.keys(jogadores).length,
        mensagem: 'Servidor da roleta rodando 🎰'
    });
});

// ===== INICIA O SERVIDOR =====
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🎰 Servidor rodando na porta ${PORT}`);
    console.log(`📡 WebSocket pronto para conexões`);
});