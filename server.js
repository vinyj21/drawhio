const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const GameRoom = require("./gameRoom");

const fs = require("fs");

const app = express();

// Middleware de CORS para permitir requisições de qualquer hospedagem HTML estática
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }
  next();
});

// Endpoint de saúde / healthcheck (para o frontend testar conexão ou serviços de nuvem)
app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    app: "Drawhio",
    version: "1.6.0",
    roomsCount: rooms ? rooms.size : 0,
    timestamp: Date.now()
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;

function findAsset(filename) {
  const candidates = [
    path.join(__dirname, filename),
    path.join(__dirname, "..", filename),
    path.join(__dirname, "public", filename),
    path.join(__dirname, "../public", filename),
    path.join(__dirname, "public/img", filename),
    path.join(__dirname, "../public/img", filename)
  ];
  return candidates.find(p => fs.existsSync(p)) || path.join(__dirname, filename);
}

// Rota dinâmica para logo.png (lê diretamente da raiz se atualizado, sem cache)
app.get(["/logo.png", "/img/logo.png"], (req, res) => {
  const target = findAsset("logo.png");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(target);
});

// Rotas dinâmicas para os novos ícones de perfil e imagem de fundo
app.get(["/icon_m.png", "/img/icon_m.png", "/icon_f.png", "/img/icon_f.png", "/icon_nb.png", "/img/icon_nb.png", "/bg.png", "/img/bg.png", "/css/bg.png"], (req, res) => {
  const filename = path.basename(req.path);
  const target = findAsset(filename);
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.sendFile(target);
});

// Servir arquivos estáticos do frontend (suporta tanto rodando da raiz quanto da subpasta server)
const publicDir = fs.existsSync(path.join(__dirname, "public"))
  ? path.join(__dirname, "public")
  : (fs.existsSync(path.join(__dirname, "../public")) ? path.join(__dirname, "../public") : __dirname);
app.use(express.static(publicDir));

// Gerenciamento de Salas em memória
const rooms = new Map(); // roomId -> GameRoom
const socketToRoom = new Map(); // socketId -> roomId

// Gerador de códigos curtos de sala (ex: ART82X)
function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Obter lista de salas públicas abertas
function getPublicRoomsList() {
  const list = [];
  for (const [code, r] of rooms.entries()) {
    if (r.isPublic && r.players.size > 0) {
      const host = r.players.get(r.hostId);
      list.push({
        roomCode: code,
        hostName: host ? host.name : "Anfitrião",
        playerCount: r.players.size,
        maxPlayers: r.settings.maxPlayers || 8,
        category: r.settings.category,
        gameMode: r.settings.gameMode,
        state: r.state,
        hasPassword: Boolean(r.password),
        isPublic: true
      });
    }
  }
  return list;
}

function broadcastPublicRooms() {
  io.emit("public_rooms_updated", getPublicRoomsList());
}

io.on("connection", (socket) => {
  console.log(`[Socket Conectado] ${socket.id}`);

  // Enviar lista de salas públicas logo na conexão
  socket.emit("public_rooms_updated", getPublicRoomsList());

  socket.on("get_public_rooms", (callback) => {
    if (typeof callback === "function") {
      callback(getPublicRoomsList());
    }
  });

  // 1. Criar uma nova sala
  socket.on("create_room", (data, callback) => {
    try {
      const roomCode = (data.roomCode && data.roomCode.trim()) 
        ? data.roomCode.trim().toUpperCase() 
        : generateRoomCode();

      if (rooms.has(roomCode)) {
        if (typeof callback === "function") callback({ success: false, reason: "Código de sala já em uso." });
        return;
      }

      const hostPlayer = {
        id: socket.id,
        sessionToken: data.sessionToken || socket.id,
        name: data.playerName ? data.playerName.trim().slice(0, 16) : "Anfitrião",
        avatar: data.avatar || { icon: "icon_nb", gender: "nb" }
      };

      const room = new GameRoom(roomCode, hostPlayer, {
        roundDuration: parseInt(data.roundDuration) || 70,
        totalRounds: parseInt(data.totalRounds) || 3,
        pointsGoal: parseInt(data.pointsGoal) || 120,
        category: data.category || "todos",
        gameMode: data.gameMode || "classico",
        isPublic: (data.isPublic !== false),
        password: data.password ? String(data.password).trim() : null,
        customWords: Array.isArray(data.customWords) ? data.customWords : []
      });
      room.setIo(io);

      rooms.set(roomCode, room);
      socketToRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      console.log(`[Sala Criada] ${roomCode} por ${hostPlayer.name} (Pública: ${room.isPublic}, Senha: ${Boolean(room.password)})`);
      if (typeof callback === "function") callback({ success: true, roomCode });
      room.broadcastRoomState();
      broadcastPublicRooms();
    } catch (err) {
      console.error("Erro ao criar sala:", err);
      if (typeof callback === "function") callback({ success: false, reason: "Erro interno no servidor." });
    }
  });

  // 2. Entrar em uma sala existente
  socket.on("join_room", (data, callback) => {
    try {
      const roomCode = data.roomCode ? data.roomCode.trim().toUpperCase() : "";
      const room = rooms.get(roomCode);

      if (!room) {
        if (typeof callback === "function") callback({ success: false, reason: "Sala não encontrada." });
        return;
      }

      // Validação de senha caso a sala seja protegida
      if (room.password) {
        const providedPassword = data.password ? String(data.password).trim() : "";
        if (providedPassword !== room.password) {
          if (typeof callback === "function") {
            callback({
              success: false,
              reason: "Senha incorreta para esta sala.",
              requiresPassword: true,
              roomCode: roomCode
            });
          }
          return;
        }
      }

      const player = {
        id: socket.id,
        sessionToken: data.sessionToken || socket.id,
        name: data.playerName ? data.playerName.trim().slice(0, 16) : `Jogador ${room.players.size + 1}`,
        avatar: data.avatar || { icon: "icon_nb", gender: "nb" }
      };

      const result = room.addPlayer(player);
      if (!result.success) {
        if (typeof callback === "function") callback(result);
        return;
      }

      socketToRoom.set(socket.id, roomCode);
      socket.join(roomCode);

      if (result.reconnected) {
        console.log(`[Jogador Reconectou] ${player.name} voltou à sala ${roomCode}`);
        if (typeof callback === "function") callback({ success: true, roomCode, reconnected: true });
      } else {
        console.log(`[Jogador Entrou] ${player.name} entrou na sala ${roomCode}`);
        room.broadcastMessage("system", `${player.name} entrou na sala`, player);
        if (typeof callback === "function") callback({ success: true, roomCode });
      }

      room.broadcastRoomState();
      broadcastPublicRooms();

      // Se já houver desenho em andamento, enviar histórico para o novo jogador
      if (room.drawHistory.length > 0) {
        socket.emit("sync_canvas_history", room.drawHistory);
      }
    } catch (err) {
      console.error("Erro ao entrar na sala:", err);
      if (typeof callback === "function") callback({ success: false, reason: "Erro interno." });
    }
  });

  // 3. Iniciar partida
  socket.on("start_game", () => {
    const roomCode = socketToRoom.get(socket.id);
    console.log(`[start_game] Recebido de socket ${socket.id} para sala '${roomCode}'`);
    const room = rooms.get(roomCode);
    if (!room) {
      console.warn(`[start_game] Falha: Sala '${roomCode}' não encontrada para socket ${socket.id}`);
      socket.emit("lobby_error", "Sala não encontrada ou já expirada.");
      return;
    }
    if (room.hostId !== socket.id) {
      console.warn(`[start_game] Falha: Socket ${socket.id} não é host da sala ${roomCode} (Host atual é ${room.hostId})`);
      socket.emit("lobby_error", "Apenas o anfitrião da sala pode iniciar a partida.");
      return;
    }

    const res = room.startGame();
    if (res && !res.success) {
      console.warn(`[start_game] room.startGame() retornou falso: ${res.reason}`);
      socket.emit("lobby_error", res.reason);
      return;
    }
    console.log(`[start_game] Partida iniciada com sucesso na sala ${roomCode}! Modo: ${room.settings.gameMode}, Jogadores: ${room.players.size}`);
    broadcastPublicRooms();
  });

  // 4. Escolher palavra (desenhista)
  socket.on("choose_word", (word) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    room.chooseWord(socket.id, word);
  });

  // 5. Ações no Canvas (desenho, borracha, balde, undo, clear)
  socket.on("draw_action", (action) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    room.handleDrawAction(socket.id, action);
  });

  // 6. Mensagens de Chat e Palpites
  socket.on("send_chat", (text) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    room.handleGuess(socket.id, text);
  });

  // 7. Adicionar / Remover Bot
  socket.on("add_bot", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.addBot();
  });

  socket.on("remove_bot", (botId) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.removeBot(botId);
  });

  // 8. Reações Flutuantes no Canvas
  socket.on("send_reaction", (emoji) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room) return;

    const player = room.players.get(socket.id);
    const playerName = player ? player.name : "Jogador";
    io.to(roomCode).emit("floating_reaction", {
      emoji: String(emoji).slice(0, 4),
      playerId: socket.id,
      playerName: playerName
    });
  });

  // 9. Posição do cursor do desenhista
  socket.on("drawer_cursor", (pos) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.currentDrawerId !== socket.id) return;

    socket.to(roomCode).emit("remote_cursor", {
      x: pos.x,
      y: pos.y
    });
  });

  // 10. Atualização de configurações pelo anfitrião
  socket.on("update_settings", (newSettings) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id || room.state !== "LOBBY") return;

    if (newSettings.roundDuration) room.settings.roundDuration = parseInt(newSettings.roundDuration) || 70;
    if (newSettings.totalRounds) room.settings.totalRounds = parseInt(newSettings.totalRounds) || 3;
    if (newSettings.pointsGoal) room.settings.pointsGoal = parseInt(newSettings.pointsGoal) || 120;
    if (newSettings.category) room.settings.category = newSettings.category;
    if (newSettings.gameMode) room.settings.gameMode = newSettings.gameMode;
    if (Array.isArray(newSettings.customWords)) {
      room.customWords = newSettings.customWords;
    }

    room.broadcastRoomState();
  });

  // 11. Reiniciar partida para o lobby
  socket.on("restart_game", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (!room || room.hostId !== socket.id) return;

    room.restartToLobby();
  });

  // 12. Solicitar sincronização do canvas
  socket.on("request_canvas_sync", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && room.drawHistory) {
      socket.emit("sync_canvas_history", room.drawHistory);
    }
  });

  // 13. Modo Telefone Sem Fio (Gartic Phone - v1.4.1)
  socket.on("telefone_submit_prompt", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefonePrompt === "function") {
      room.handleTelefonePrompt(socket.id, data ? data.prompt : "");
    }
  });

  socket.on("telefone_submit_draw", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefoneDraw === "function") {
      room.handleTelefoneDraw(socket.id, data ? data.drawHistory : []);
    }
  });

  socket.on("telefone_submit_describe", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefoneDescribe === "function") {
      room.handleTelefoneDescribe(socket.id, data ? data.guess : "");
    }
  });

  socket.on("telefone_next_slide", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefoneNextSlide === "function") {
      room.handleTelefoneNextSlide(socket.id);
    }
  });

  socket.on("telefone_prev_slide", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefonePrevSlide === "function") {
      room.handleTelefonePrevSlide(socket.id);
    }
  });

  socket.on("telefone_finish_album", () => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleTelefoneFinishAlbum === "function") {
      room.handleTelefoneFinishAlbum(socket.id);
    }
  });

  socket.on("album_reaction", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleAlbumReaction === "function") {
      room.handleAlbumReaction(socket.id, data ? data.reaction : "");
    }
  });

  // 14. Moderação de Sala & Votekick (v1.6)
  socket.on("host_kick_player", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleHostKick === "function") {
      room.handleHostKick(socket.id, data ? data.targetId : null);
    }
  });

  socket.on("votekick_start", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleVotekickStart === "function") {
      room.handleVotekickStart(socket.id, data ? data.targetId : null);
    }
  });

  socket.on("votekick_vote", (data) => {
    const roomCode = socketToRoom.get(socket.id);
    const room = rooms.get(roomCode);
    if (room && typeof room.handleVotekickVote === "function") {
      room.handleVotekickVote(socket.id, Boolean(data && data.voteYes));
    }
  });

  // 10. Desconexão
  socket.on("disconnect", () => {
    console.log(`[Socket Desconectado] ${socket.id}`);
    const roomCode = socketToRoom.get(socket.id);
    if (!roomCode) return;

    const room = rooms.get(roomCode);
    if (room) {
      // Se a partida estiver em andamento, desconectar temporariamente (30s de retenção)
      room.removePlayer(socket.id, true);

      // Se a sala estiver sem jogadores reais e sem jogadores desconectados temporários, deletar
      const realPlayers = Array.from(room.players.values()).filter(p => !p.isBot);
      const tempDisconnected = room.disconnectedPlayers ? room.disconnectedPlayers.size : 0;
      if (realPlayers.length === 0 && tempDisconnected === 0) {
        console.log(`[Sala Encerrada] ${roomCode} deletada (sem jogadores)`);
        room.clearTimers();
        rooms.delete(roomCode);
      }
      broadcastPublicRooms();
    }
    socketToRoom.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`🎨 Gartic Online Server rodando em http://localhost:${PORT}`);
  console.log(`=========================================`);
});
