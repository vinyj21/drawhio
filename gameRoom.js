const {
  normalizeWord,
  isCloseGuess,
  getRandomWordChoices,
  getMaskedHint
} = require("./words");

class GameRoom {
  constructor(roomId, hostPlayer, options = {}) {
    this.id = roomId;
    this.hostId = hostPlayer.id;
    this.players = new Map(); // socketId -> Player
    this.state = "LOBBY"; // LOBBY, SELECTING_WORD, DRAWING, ROUND_END, GAME_OVER
    
    // Configurações da sala (v1.6)
    this.settings = {
      maxPlayers: options.maxPlayers || 8,
      roundDuration: (options.gameMode === "duelo_rush") ? 25 : (options.roundDuration || 70), // segundos por rodada
      totalRounds: parseInt(options.totalRounds) || 3, // exclusivo do Telefone Sem Fio
      pointsGoal: parseInt(options.pointsGoal) || 120, // meta de pontos para vencer no Clássico/Rápido/Duelo
      category: options.category || "todos",
      gameMode: options.gameMode || "classico"
    };
    this.customWords = options.customWords || [];
    this.isPublic = (options.isPublic !== false);
    this.password = options.password ? String(options.password).trim() : null;

    // Estado da partida
    this.currentRound = 1;
    this.drawerIndex = -1;
    this.turnOrder = []; // lista de socketIds
    this.currentDrawerId = null;
    this.wordChoices = [];
    this.selectedWord = null; // { word, hint, category }
    this.drawHistory = []; // histórico de ações no canvas
    this.roundDrawHistory = []; // cópia persistida para replay/timelapse
    this.guessedPlayers = new Set(); // socketIds que já acertaram na rodada
    this.scores = new Map(); // socketId -> pontuação total
    this.roundScores = new Map(); // socketId -> pontos ganhos na rodada atual
    this.telephoneChain = []; // Galeria de evolução para o Modo Telefone Sem Fio

    // Timers
    this.timer = null;
    this.timeRemaining = 0;
    this.io = null;

    // Bots virtuais
    this.bots = [];
    this.botGuessTimeouts = [];
    this.botDrawInterval = null;

    // Reconexão Resiliente & Moderação de Sala (v1.6)
    this.disconnectedPlayers = new Map(); // sessionToken -> { player, timer, expiresAt }
    this.activeVotekick = null; // { targetId, targetName, initiatorId, votes: Set, requiredVotes, timeRemaining }
    this.votekickTimer = null;

    // Adicionar o host
    this.addPlayer(hostPlayer);
  }

  setIo(io) {
    this.io = io;
  }

  addPlayer(player) {
    if (this.players.size >= this.settings.maxPlayers && !player.isBot) {
      return { success: false, reason: "Sala cheia" };
    }

    const sessionToken = player.sessionToken || player.id;

    // Verificar se é uma reconexão de jogador existente (v1.6)
    if (this.disconnectedPlayers && this.disconnectedPlayers.has(sessionToken)) {
      const cached = this.disconnectedPlayers.get(sessionToken);
      clearTimeout(cached.timer);
      this.disconnectedPlayers.delete(sessionToken);

      const restoredPlayer = cached.player;
      const oldId = restoredPlayer.id;
      restoredPlayer.id = player.id;
      restoredPlayer.sessionToken = sessionToken;

      // Reatribuir identificador nos mapas internos
      if (this.scores.has(oldId)) {
        const sc = this.scores.get(oldId);
        this.scores.delete(oldId);
        this.scores.set(player.id, sc);
      }
      if (this.roundScores.has(oldId)) {
        const rsc = this.roundScores.get(oldId);
        this.roundScores.delete(oldId);
        this.roundScores.set(player.id, rsc);
      }
      if (this.guessedPlayers.has(oldId)) {
        this.guessedPlayers.delete(oldId);
        this.guessedPlayers.add(player.id);
      }
      if (this.turnOrder) {
        const idx = this.turnOrder.indexOf(oldId);
        if (idx !== -1) this.turnOrder[idx] = player.id;
      }
      if (this.currentDrawerId === oldId) {
        this.currentDrawerId = player.id;
      }
      if (this.hostId === oldId) {
        this.hostId = player.id;
        restoredPlayer.isHost = true;
      }

      this.players.set(player.id, restoredPlayer);

      if (this.io) {
        this.io.to(this.id).emit("player_reconnected", {
          id: player.id,
          name: restoredPlayer.name
        });
        this.broadcastMessage("system", `${restoredPlayer.name} reconectou à partida!`);
      }
      this.broadcastRoomState();
      return { success: true, reconnected: true, player: restoredPlayer };
    }

    this.players.set(player.id, {
      id: player.id,
      sessionToken: sessionToken,
      name: player.name || "Jogador",
      avatar: player.avatar || { icon: "icon_nb", gender: "nb" },
      score: 0,
      isHost: player.id === this.hostId,
      isBot: Boolean(player.isBot),
      hasGuessed: false,
      isDrawing: false
    });

    if (!this.scores.has(player.id)) {
      this.scores.set(player.id, 0);
    }

    // Se a partida já estiver em andamento, adicionar novo jogador ao final da fila de turnos
    if (this.state !== "LOBBY" && !this.turnOrder.includes(player.id)) {
      this.turnOrder.push(player.id);
    }

    if (this.io) {
      this.io.to(this.id).emit("player_joined", { 
        id: player.id, 
        name: player.name,
        isBot: Boolean(player.isBot)
      });
    }

    return { success: true };
  }

  removePlayer(playerId, temporary = false) {
    const player = this.players.get(playerId);
    if (!player) return;

    // Desconexão temporária durante partida em andamento (30s de retenção)
    if (temporary && player.sessionToken && !player.isBot && this.state !== "LOBBY") {
      const sessionToken = player.sessionToken;
      this.players.delete(playerId);

      const timer = setTimeout(() => {
        this.permanentRemovePlayer(player, playerId);
      }, 30000);

      this.disconnectedPlayers.set(sessionToken, {
        player,
        timer,
        expiresAt: Date.now() + 30000
      });

      if (this.io) {
        this.io.to(this.id).emit("player_temp_disconnected", {
          id: playerId,
          name: player.name,
          graceSeconds: 30
        });
        this.broadcastMessage("system", `${player.name} perdeu a conexão temporariamente. Aguardando 30s para reconexão...`);
      }
      this.broadcastRoomState();
      return;
    }

    this.permanentRemovePlayer(player, playerId);
  }

  permanentRemovePlayer(player, playerId) {
    if (player && player.sessionToken && this.disconnectedPlayers) {
      this.disconnectedPlayers.delete(player.sessionToken);
    }
    this.players.delete(playerId);
    this.guessedPlayers.delete(playerId);

    // Cancelar votekick se for o alvo
    if (this.activeVotekick && this.activeVotekick.targetId === playerId) {
      this.cancelVotekick("O jogador alvo saiu da sala.");
    }

    // Remover da fila de turnos
    if (this.turnOrder) {
      const tIdx = this.turnOrder.indexOf(playerId);
      if (tIdx !== -1) {
        this.turnOrder.splice(tIdx, 1);
        if (tIdx <= this.drawerIndex && this.drawerIndex > 0) {
          this.drawerIndex--;
        }
      }
    }

    if (this.io) {
      this.io.to(this.id).emit("player_left", { id: playerId, name: player.name });
    }

    // Se o anfitrião saiu, passar a coroa para o próximo jogador real
    if (this.hostId === playerId) {
      const remainingReal = Array.from(this.players.values()).find(p => !p.isBot);
      if (remainingReal) {
        this.hostId = remainingReal.id;
        remainingReal.isHost = true;
      }
    }

    // Se o desenhista atual saiu
    if (this.currentDrawerId === playerId && (this.state === "DRAWING" || this.state === "SELECTING_WORD")) {
      this.broadcastMessage("system", `${player.name} (Desenhista) saiu da partida.`);
      this.endTurn(true);
    } else {
      this.broadcastRoomState();
    }
  }

  // Moderação: Expulsão direta pelo Anfitrião (v1.6)
  handleHostKick(hostSocketId, targetPlayerId) {
    if (hostSocketId !== this.hostId) {
      return { success: false, reason: "Apenas o anfitrião pode expulsar jogadores diretamente." };
    }
    if (targetPlayerId === this.hostId) {
      return { success: false, reason: "O anfitrião não pode expulsar a si mesmo." };
    }
    const target = this.players.get(targetPlayerId);
    if (!target) {
      return { success: false, reason: "Jogador não encontrado." };
    }

    if (this.io) {
      this.io.to(targetPlayerId).emit("player_kicked", {
        reason: "Você foi expulso pelo anfitrião da sala."
      });
      this.broadcastMessage("system", `O anfitrião expulsou ${target.name} da sala.`);
    }

    this.removePlayer(targetPlayerId, false);
    return { success: true };
  }

  // Moderação: Início de Votekick por qualquer jogador (v1.6)
  handleVotekickStart(initiatorId, targetPlayerId) {
    if (this.activeVotekick) {
      return { success: false, reason: "Já existe uma votação de expulsão em andamento." };
    }
    if (initiatorId === targetPlayerId) {
      return { success: false, reason: "Você não pode votar para se auto-expulsar." };
    }
    if (targetPlayerId === this.hostId) {
      return { success: false, reason: "Não é permitido expulsar o anfitrião da sala." };
    }
    const target = this.players.get(targetPlayerId);
    if (!target) {
      return { success: false, reason: "Jogador alvo não encontrado." };
    }

    const realPlayers = Array.from(this.players.values()).filter(p => !p.isBot);
    if (realPlayers.length < 3) {
      return { success: false, reason: "São necessários pelo menos 3 jogadores na sala para votação." };
    }

    // Maioria simples necessária
    const requiredVotes = Math.floor((realPlayers.length - 1) / 2) + 1;

    this.activeVotekick = {
      targetId: targetPlayerId,
      targetName: target.name,
      initiatorId,
      votes: new Set([initiatorId]),
      requiredVotes,
      timeRemaining: 20
    };

    if (this.io) {
      this.io.to(this.id).emit("votekick_update", {
        targetId: targetPlayerId,
        targetName: target.name,
        votes: this.activeVotekick.votes.size,
        requiredVotes: this.activeVotekick.requiredVotes,
        timeRemaining: 20
      });
      this.broadcastMessage("system", `Votação de expulsão iniciada contra ${target.name}! (${this.activeVotekick.votes.size}/${this.activeVotekick.requiredVotes} votos)`);
    }

    if (this.votekickTimer) clearInterval(this.votekickTimer);
    this.votekickTimer = setInterval(() => {
      if (!this.activeVotekick) {
        clearInterval(this.votekickTimer);
        return;
      }
      this.activeVotekick.timeRemaining--;
      if (this.activeVotekick.timeRemaining <= 0) {
        this.cancelVotekick("Votação de expulsão encerrada sem votos suficientes.");
      } else {
        if (this.io) {
          this.io.to(this.id).emit("votekick_timer_tick", {
            timeRemaining: this.activeVotekick.timeRemaining
          });
        }
      }
    }, 1000);

    return { success: true };
  }

  // Moderação: Voto na votação ativa (v1.6)
  handleVotekickVote(voterId, voteYes) {
    if (!this.activeVotekick) return;
    if (voterId === this.activeVotekick.targetId) return; // Alvo não vota

    if (voteYes) {
      this.activeVotekick.votes.add(voterId);
    } else {
      this.activeVotekick.votes.delete(voterId);
    }

    if (this.io) {
      this.io.to(this.id).emit("votekick_update", {
        targetId: this.activeVotekick.targetId,
        targetName: this.activeVotekick.targetName,
        votes: this.activeVotekick.votes.size,
        requiredVotes: this.activeVotekick.requiredVotes,
        timeRemaining: this.activeVotekick.timeRemaining
      });
    }

    if (this.activeVotekick.votes.size >= this.activeVotekick.requiredVotes) {
      const kickedName = this.activeVotekick.targetName;
      const kickedId = this.activeVotekick.targetId;
      clearInterval(this.votekickTimer);
      this.activeVotekick = null;

      if (this.io) {
        this.io.to(kickedId).emit("player_kicked", {
          reason: "Você foi expulso pela maioria dos votos da sala."
        });
        this.io.to(this.id).emit("votekick_ended", {
          success: true,
          targetName: kickedName
        });
        this.broadcastMessage("system", `${kickedName} foi expulso pela votação dos jogadores!`);
      }

      this.removePlayer(kickedId, false);
    }
  }

  cancelVotekick(reason = "") {
    if (this.votekickTimer) {
      clearInterval(this.votekickTimer);
      this.votekickTimer = null;
    }
    if (this.activeVotekick && this.io) {
      this.io.to(this.id).emit("votekick_ended", {
        success: false,
        reason
      });
      if (reason) {
        this.broadcastMessage("system", reason);
      }
    }
    this.activeVotekick = null;
  }

  // Adicionar um bot para teste solo / diversão
  addBot() {
    const botNames = ["Robô Da Vinci", "Pintor Pixel", "Arturito Bot", "Chutador 3000", "Cyber Picasso"];
    const botColors = ["#ec4899", "#8b5cf6", "#10b981", "#f59e0b", "#06b6d4"];
    
    // Escolher nome não utilizado
    const usedNames = Array.from(this.players.values()).map(p => p.name);
    const availableNames = botNames.filter(n => !usedNames.includes(n));
    const name = availableNames[0] || `Bot ${this.players.size + 1}`;
    const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;

    const botAvatars = [
      { icon: "icon_m", gender: "homem" },
      { icon: "icon_f", gender: "mulher" },
      { icon: "icon_nb", gender: "nb" }
    ];

    const botPlayer = {
      id: botId,
      name: name,
      avatar: botAvatars[Math.floor(Math.random() * botAvatars.length)],
      isBot: true
    };

    this.addPlayer(botPlayer);
    this.broadcastMessage("system", `${name} entrou na sala!`);
    this.broadcastRoomState();
    return botPlayer;
  }

  removeBot(botId) {
    const player = this.players.get(botId);
    if (player && player.isBot) {
      this.removePlayer(botId);
      this.broadcastMessage("system", `${player.name} foi removido.`);
      this.broadcastRoomState();
    }
  }

  startGame() {
    if (this.settings.gameMode === "telefone") {
      return this.startTelefoneGame();
    }

    // Validação de jogadores reais (Sem bots, igual ao Gartic original)
    if (this.settings.gameMode === "duelo") {
      if (this.players.size !== 2) {
        return { success: false, reason: "O Modo Duelo requer exatamente 2 jogadores!" };
      }
    } else {
      if (this.players.size < 2) {
        return {
          success: false,
          reason: "Aguardando amigos entrarem! É necessário pelo menos 2 jogadores reais para começar a partida."
        };
      }
    }

    this.state = "SELECTING_WORD";
    this.currentRound = 1;
    this.drawerIndex = -1;
    
    // Ordem sequencial transparente de turnos (ordem de chegada na sala: Host 1º, Convidado 2º, etc.)
    this.turnOrder = Array.from(this.players.keys());

    // Resetar pontuações
    for (const player of this.players.values()) {
      player.score = 0;
      this.scores.set(player.id, 0);
    }

    this.nextTurn();
    return { success: true };
  }

  /* =========================================================
     MODO TELEFONE SEM FIO (GARTIC PHONE - v1.4.1)
     Loop: Frase Secreta -> Desenho -> Descrição -> Álbum
     ========================================================= */
  startTelefoneGame() {
    if (this.players.size < 2) {
      return {
        success: false,
        reason: "O Modo Telefone Sem Fio requer pelo menos 2 jogadores reais para jogar!"
      };
    }

    this.clearTimers();
    this.telefonePlayers = Array.from(this.players.keys());
    // Embaralhar ordem da cadeia
    this.telefonePlayers.sort(() => 0.5 - Math.random());

    this.telefoneBooks = new Map();
    for (const pId of this.telefonePlayers) {
      const p = this.players.get(pId);
      this.telefoneBooks.set(pId, {
        bookOwnerId: pId,
        bookOwnerName: p ? p.name : "Jogador",
        bookOwnerAvatar: p ? p.avatar : null,
        steps: []
      });
    }

    // Resetar status e pontuações
    for (const p of this.players.values()) {
      p.score = 0;
      p.hasGuessed = false;
      p.isDrawing = false;
    }

    this.startTelefonePromptPhase();
    return { success: true };
  }

  startTelefonePromptPhase() {
    this.clearTimers();
    this.state = "TELEFONE_PROMPT";
    this.timeRemaining = 25;
    this.telefoneSubmissions = new Map();

    this.broadcastRoomState();
    if (this.io) {
      this.io.to(this.id).emit("telefone_phase_prompt", { timeRemaining: this.timeRemaining });
    }

    // Bots enviam frase criativa após 1.5s
    for (const p of this.players.values()) {
      if (p.isBot) {
        setTimeout(() => {
          const funnyPrompts = [
            "Um pinguim surfando na lava",
            "Gato astronauta comendo pizza",
            "Cachorro detetive procurando ossos",
            "Dinossauro andando de patins",
            "Robô tomando café na chuva",
            "Macaco pilotando um foguete espacial",
            "Tartaruga ninja comendo sorvete",
            "Pato com cartola e monóculo"
          ];
          const botPrompt = funnyPrompts[Math.floor(Math.random() * funnyPrompts.length)];
          this.handleTelefonePrompt(p.id, botPrompt);
        }, 1500);
      }
    }

    this.timer = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this.finishTelefonePromptPhase();
      } else {
        if (this.io) {
          this.io.to(this.id).emit("telefone_timer_update", { timeRemaining: this.timeRemaining });
        }
      }
    }, 1000);
  }

  handleTelefonePrompt(playerId, promptText) {
    if (this.state !== "TELEFONE_PROMPT") return;
    const cleanText = String(promptText || "").trim().slice(0, 60);
    this.telefoneSubmissions.set(playerId, cleanText || "Uma ideia misteriosa");

    const realPlayers = Array.from(this.players.values()).filter(p => !p.isBot);
    const allRealSubmitted = realPlayers.every(p => this.telefoneSubmissions.has(p.id));
    if (allRealSubmitted) {
      this.finishTelefonePromptPhase();
    }
  }

  finishTelefonePromptPhase() {
    this.clearTimers();
    const fallbackPrompts = [
      "Um tubarão tocando violão",
      "Coruja programadora tomando café",
      "Leão de patinete elétrico",
      "Coelho mágico saindo da cartola",
      "Dragão assando marshmallows",
      "Urso polar tomando banho de sol"
    ];

    for (let i = 0; i < this.telefonePlayers.length; i++) {
      const pId = this.telefonePlayers[i];
      const p = this.players.get(pId);
      const text = this.telefoneSubmissions.get(pId) || fallbackPrompts[i % fallbackPrompts.length];
      const book = this.telefoneBooks.get(pId);
      if (book) {
        book.steps.push({
          stepNumber: 1,
          type: "prompt",
          authorId: pId,
          authorName: p ? p.name : "Jogador",
          authorAvatar: p ? p.avatar : null,
          text: text
        });
      }
    }

    this.startTelefoneDrawPhase();
  }

  startTelefoneDrawPhase() {
    this.clearTimers();
    this.state = "TELEFONE_DRAW";
    this.timeRemaining = this.settings.roundDuration || 60;
    this.telefoneSubmissions = new Map();

    // Limpar o canvas
    if (this.io) {
      this.io.to(this.id).emit("draw_action", { type: "clear" });
      this.io.to(this.id).emit("clear_canvas");
    }

    this.broadcastRoomState();

    const N = this.telefonePlayers.length;
    for (let i = 0; i < N; i++) {
      const drawerId = this.telefonePlayers[i];
      // Desenhista i desenha o livro de (i + 1) % N
      const bookOwnerId = this.telefonePlayers[(i + 1) % N];
      const book = this.telefoneBooks.get(bookOwnerId);
      const promptToDraw = (book && book.steps.length > 0) ? book.steps[0].text : "Desenho Criativo";

      if (this.io) {
        this.io.to(drawerId).emit("telefone_phase_draw", {
          promptToDraw: promptToDraw,
          timeRemaining: this.timeRemaining,
          bookOwnerName: book ? book.bookOwnerName : "Amigo"
        });
      }
    }

    // Bots geram desenho automático após 3s
    for (const p of this.players.values()) {
      if (p.isBot) {
        setTimeout(() => {
          const sampleBotDoodle = [
            { type: "brush", points: [{x: 100, y: 100}, {x: 200, y: 100}, {x: 200, y: 200}, {x: 100, y: 200}, {x: 100, y: 100}], color: "#6366F1", size: 5 },
            { type: "brush", points: [{x: 130, y: 140}, {x: 140, y: 140}], color: "#000000", size: 6 },
            { type: "brush", points: [{x: 170, y: 140}, {x: 180, y: 140}], color: "#000000", size: 6 },
            { type: "brush", points: [{x: 130, y: 170}, {x: 170, y: 170}], color: "#EF4444", size: 4 }
          ];
          this.handleTelefoneDraw(p.id, sampleBotDoodle);
        }, 3000);
      }
    }

    this.timer = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this.finishTelefoneDrawPhase();
      } else {
        if (this.io) {
          this.io.to(this.id).emit("telefone_timer_update", { timeRemaining: this.timeRemaining });
        }
      }
    }, 1000);
  }

  handleTelefoneDraw(playerId, drawHistory) {
    if (this.state !== "TELEFONE_DRAW") return;
    this.telefoneSubmissions.set(playerId, Array.isArray(drawHistory) ? drawHistory : []);

    const realPlayers = Array.from(this.players.values()).filter(p => !p.isBot);
    const allRealSubmitted = realPlayers.every(p => this.telefoneSubmissions.has(p.id));
    if (allRealSubmitted) {
      this.finishTelefoneDrawPhase();
    }
  }

  finishTelefoneDrawPhase() {
    this.clearTimers();
    const N = this.telefonePlayers.length;

    for (let i = 0; i < N; i++) {
      const drawerId = this.telefonePlayers[i];
      const p = this.players.get(drawerId);
      const bookOwnerId = this.telefonePlayers[(i + 1) % N];
      const book = this.telefoneBooks.get(bookOwnerId);
      const drawData = this.telefoneSubmissions.get(drawerId) || [];

      if (book) {
        book.steps.push({
          stepNumber: 2,
          type: "draw",
          authorId: drawerId,
          authorName: p ? p.name : "Jogador",
          authorAvatar: p ? p.avatar : null,
          drawHistory: drawData
        });
      }
    }

    this.startTelefoneDescribePhase();
  }

  startTelefoneDescribePhase() {
    this.clearTimers();
    this.state = "TELEFONE_DESCRIBE";
    this.timeRemaining = 30;
    this.telefoneSubmissions = new Map();

    this.broadcastRoomState();

    const N = this.telefonePlayers.length;
    for (let i = 0; i < N; i++) {
      const guesserId = this.telefonePlayers[i];
      // Descrevedor i recebe o livro de (i + 2) % N
      const bookOwnerId = this.telefonePlayers[(i + 2) % N];
      const book = this.telefoneBooks.get(bookOwnerId);
      const drawStep = book ? book.steps.find(s => s.type === "draw") : null;
      const drawHistory = drawStep ? drawStep.drawHistory : [];
      const drawerName = drawStep ? drawStep.authorName : "Alguém";

      if (this.io) {
        this.io.to(guesserId).emit("telefone_phase_describe", {
          drawHistory: drawHistory,
          drawerName: drawerName,
          timeRemaining: this.timeRemaining,
          bookOwnerName: book ? book.bookOwnerName : "Amigo"
        });
      }
    }

    // Bots geram palpite após 2s
    for (const p of this.players.values()) {
      if (p.isBot) {
        setTimeout(() => {
          const funnyGuesses = [
            "Um gato tentando voar",
            "Acho que é um robô feliz",
            "Monstro fofinho dançando",
            "Um cachorro com chapéu",
            "Pizza espacial gigante",
            "Parece uma obra de arte moderna"
          ];
          const botGuess = funnyGuesses[Math.floor(Math.random() * funnyGuesses.length)];
          this.handleTelefoneDescribe(p.id, botGuess);
        }, 2000);
      }
    }

    this.timer = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this.finishTelefoneDescribePhase();
      } else {
        if (this.io) {
          this.io.to(this.id).emit("telefone_timer_update", { timeRemaining: this.timeRemaining });
        }
      }
    }, 1000);
  }

  handleTelefoneDescribe(playerId, guessText) {
    if (this.state !== "TELEFONE_DESCRIBE") return;
    const cleanGuess = String(guessText || "").trim().slice(0, 60);
    this.telefoneSubmissions.set(playerId, cleanGuess || "Uma grande incógnita");

    const realPlayers = Array.from(this.players.values()).filter(p => !p.isBot);
    const allRealSubmitted = realPlayers.every(p => this.telefoneSubmissions.has(p.id));
    if (allRealSubmitted) {
      this.finishTelefoneDescribePhase();
    }
  }

  finishTelefoneDescribePhase() {
    this.clearTimers();
    const N = this.telefonePlayers.length;
    const fallbackGuesses = [
      "Uma obra de arte contemporânea",
      "Parece um bicho fofo",
      "Não entendi muito bem mas adorei",
      "Um alienígena amigável"
    ];

    for (let i = 0; i < N; i++) {
      const guesserId = this.telefonePlayers[i];
      const p = this.players.get(guesserId);
      const bookOwnerId = this.telefonePlayers[(i + 2) % N];
      const book = this.telefoneBooks.get(bookOwnerId);
      const guessText = this.telefoneSubmissions.get(guesserId) || fallbackGuesses[i % fallbackGuesses.length];

      if (book) {
        book.steps.push({
          stepNumber: 3,
          type: "describe",
          authorId: guesserId,
          authorName: p ? p.name : "Jogador",
          authorAvatar: p ? p.avatar : null,
          text: guessText
        });
      }
    }

    this.startTelefoneAlbumShowcase();
  }

  startTelefoneAlbumShowcase() {
    this.clearTimers();
    this.state = "TELEFONE_ALBUM";
    this.telefoneBooksArray = Array.from(this.telefoneBooks.values());
    this.currentBookIndex = 0;
    this.currentStepIndex = 0;

    // Conceder pontuação a todos os participantes
    for (const p of this.players.values()) {
      p.score = (p.score || 0) + 50;
      this.scores.set(p.id, p.score);
    }

    this.broadcastRoomState();

    if (this.io) {
      this.io.to(this.id).emit("telefone_album_start", {
        books: this.telefoneBooksArray,
        currentBookIndex: 0,
        currentStepIndex: 0,
        hostId: this.hostId
      });
    }
  }

  handleTelefoneNextSlide(playerId) {
    if (this.state !== "TELEFONE_ALBUM") return;
    if (playerId !== this.hostId) return;
    if (!this.telefoneBooksArray || this.telefoneBooksArray.length === 0) return;

    const currentBook = this.telefoneBooksArray[this.currentBookIndex];
    if (this.currentStepIndex + 1 < currentBook.steps.length) {
      this.currentStepIndex++;
    } else {
      if (this.currentBookIndex + 1 < this.telefoneBooksArray.length) {
        this.currentBookIndex++;
        this.currentStepIndex = 0;
      } else {
        this.state = "TELEFONE_RECAP";
        if (this.io) {
          this.io.to(this.id).emit("telefone_album_finished", {
            books: this.telefoneBooksArray || []
          });
        }
        return;
      }
    }

    if (this.io) {
      this.io.to(this.id).emit("telefone_slide_update", {
        currentBookIndex: this.currentBookIndex,
        currentStepIndex: this.currentStepIndex
      });
    }
  }

  handleTelefonePrevSlide(playerId) {
    if (this.state !== "TELEFONE_ALBUM") return;
    if (playerId !== this.hostId) return;

    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
    } else if (this.currentBookIndex > 0) {
      this.currentBookIndex--;
      this.currentStepIndex = this.telefoneBooksArray[this.currentBookIndex].steps.length - 1;
    }

    if (this.io) {
      this.io.to(this.id).emit("telefone_slide_update", {
        currentBookIndex: this.currentBookIndex,
        currentStepIndex: this.currentStepIndex
      });
    }
  }

  handleTelefoneFinishAlbum(playerId) {
    if (this.state !== "TELEFONE_ALBUM" && this.state !== "TELEFONE_RECAP") return;
    if (playerId !== this.hostId) return;

    // Se estiver no slideshow e clicar em finalizar álbum, abrir a galeria final recap
    if (this.state === "TELEFONE_ALBUM") {
      this.state = "TELEFONE_RECAP";
      if (this.io) {
        this.io.to(this.id).emit("telefone_album_finished", {
          books: this.telefoneBooksArray || []
        });
      }
      return;
    }

    // Se já estiver na galeria final e clicar em voltar ao lobby
    this.restartToLobby();
  }

  handleAlbumReaction(playerId, reaction) {
    if (this.state !== "TELEFONE_ALBUM") return;
    const player = this.players.get(playerId);
    if (this.io) {
      this.io.to(this.id).emit("album_reaction_received", {
        reaction: String(reaction).slice(0, 16),
        playerName: player ? player.name : "Alguém"
      });
    }
  }

  nextTurn() {
    this.clearTimers();
    this.drawHistory = [];
    // Limpar imediatamente o canvas para todos os jogadores ao iniciar novo turno
    if (this.io) {
      this.io.to(this.id).emit("draw_action", { type: "clear" });
      this.io.to(this.id).emit("clear_canvas");
    }
    this.guessedPlayers.clear();
    this.roundScores.clear();

    // Filtrar ordem de turnos para manter apenas jogadores presentes
    this.turnOrder = this.turnOrder.filter(id => this.players.has(id));
    if (this.turnOrder.length === 0) {
      this.endGame();
      return;
    }

    // Avançar na fila de forma estritamente circular: 0 -> 1 -> 2 -> 0 -> 1...
    this.drawerIndex = (this.drawerIndex + 1) % this.turnOrder.length;

    // Se for Modo Telefone Sem Fio, controlar por contagem de rodadas completas
    if (this.settings.gameMode === "telefone" && this.drawerIndex === 0) {
      this.currentRound++;
      if (this.currentRound > this.settings.totalRounds) {
        this.endGame();
        return;
      }
    }

    this.currentDrawerId = this.turnOrder[this.drawerIndex];
    const drawer = this.players.get(this.currentDrawerId);

    if (!drawer) {
      this.nextTurn();
      return;
    }

    // Resetar status dos jogadores
    for (const p of this.players.values()) {
      p.isDrawing = (p.id === this.currentDrawerId);
      p.hasGuessed = false;
    }

    this.state = "SELECTING_WORD";
    this.wordChoices = getRandomWordChoices(this.settings.category, this.customWords);
    this.selectedWord = null;

    // Avisar o desenhista para escolher a palavra (tempo limite de 15s)
    this.timeRemaining = 15;
    this.broadcastRoomState();

    if (drawer.isBot) {
      // Bot escolhe automaticamente após 1.5s
      setTimeout(() => {
        const choice = this.wordChoices[Math.floor(Math.random() * this.wordChoices.length)];
        this.chooseWord(drawer.id, choice.word);
      }, 1500);
    } else {
      // Iniciar contagem regressiva para escolha de palavra
      this.timer = setInterval(() => {
        this.timeRemaining--;
        if (this.timeRemaining <= 0) {
          clearInterval(this.timer);
          // Auto-escolhe a primeira opção
          this.chooseWord(drawer.id, this.wordChoices[0].word);
        } else {
          this.io.to(this.id).emit("timer_update", { timeRemaining: this.timeRemaining });
        }
      }, 1000);
    }
  }

  chooseWord(playerId, wordParam) {
    if (this.state !== "SELECTING_WORD" || playerId !== this.currentDrawerId) return;

    this.clearTimers();
    this.drawHistory = [];
    if (this.io) {
      this.io.to(this.id).emit("draw_action", { type: "clear" });
      this.io.to(this.id).emit("clear_canvas");
    }
    const wordStr = (typeof wordParam === "object" && wordParam !== null && wordParam.word)
      ? String(wordParam.word)
      : String(wordParam || "");

    const found = this.wordChoices.find(w => w.word.toLowerCase() === wordStr.toLowerCase()) || this.wordChoices[0];
    this.selectedWord = found;
    this.state = "DRAWING";
    this.timeRemaining = (this.settings.gameMode === "duelo_rush") ? 25 : this.settings.roundDuration;

    if (this.settings.gameMode === "telefone") {
      this.telephoneChain.push({
        step: this.telephoneChain.length + 1,
        round: this.currentRound,
        type: "phrase",
        author: "Palavra Secreta",
        text: this.selectedWord.word,
        category: this.selectedWord.category || this.settings.category
      });
    }

    const drawer = this.players.get(this.currentDrawerId);
    if (!drawer) {
      this.endTurn(true);
      return;
    }
    this.broadcastMessage("system", `${drawer.name} está desenhando agora! Prepare seus palpites!`);

    this.broadcastRoomState();

    // Se o desenhista for bot, simular traços
    if (drawer.isBot) {
      this.startBotDrawing();
    }

    // Agendar palpites dos bots caso haja bots adivinhando
    this.scheduleBotGuesses();

    // Iniciar contagem regressiva do desenho
    this.timer = setInterval(() => {
      this.timeRemaining--;

      // Atualizar dica gradual (máscara de letras)
      const progress = (this.settings.roundDuration - this.timeRemaining) / this.settings.roundDuration;
      const maskedHint = getMaskedHint(this.selectedWord.word, progress);

      this.io.to(this.id).emit("timer_update", {
        timeRemaining: this.timeRemaining,
        maskedHint: maskedHint
      });

      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this.endTurn(false);
      }
    }, 1000);
  }

  // Agendar palpites de bots caso haja bots jogando como adivinhadores
  scheduleBotGuesses() {
    this.botGuessTimeouts.forEach(t => clearTimeout(t));
    this.botGuessTimeouts = [];

    const nonDrawers = Array.from(this.players.values()).filter(p => !p.isDrawing && p.isBot);
    nonDrawers.forEach(bot => {
      // 70% de chance do bot acertar entre 15s e 50s
      if (Math.random() < 0.75) {
        const delay = (12 + Math.random() * (this.settings.roundDuration - 25)) * 1000;
        const t = setTimeout(() => {
          if (this.state === "DRAWING" && !bot.hasGuessed) {
            this.handleGuess(bot.id, this.selectedWord.word);
          }
        }, delay);
        this.botGuessTimeouts.push(t);
      } else {
        // Palpite errado engraçado
        const delay = (8 + Math.random() * 20) * 1000;
        const sillyGuesses = ["um carro?", "parece um pato", "batata", "árvore?", "não faço ideia kkk"];
        const t = setTimeout(() => {
          if (this.state === "DRAWING" && !bot.hasGuessed) {
            const silly = sillyGuesses[Math.floor(Math.random() * sillyGuesses.length)];
            this.handleGuess(bot.id, silly);
          }
        }, delay);
        this.botGuessTimeouts.push(t);
      }
    });
  }

  // Bot desenhista simples para testes solo
  startBotDrawing() {
    if (this.botDrawInterval) clearInterval(this.botDrawInterval);

    // Conjunto de passos simples de desenho (traços geométricos)
    const steps = [
      // Desenhar formato básico
      { type: "stroke", color: "#ffffff", size: 4, points: [{x: 200, y: 150}, {x: 400, y: 150}, {x: 400, y: 350}, {x: 200, y: 350}, {x: 200, y: 150}] },
      { type: "stroke", color: "#f59e0b", size: 5, points: [{x: 200, y: 150}, {x: 300, y: 80}, {x: 400, y: 150}] },
      { type: "stroke", color: "#38bdf8", size: 3, points: [{x: 240, y: 200}, {x: 280, y: 200}, {x: 280, y: 240}, {x: 240, y: 240}, {x: 240, y: 200}] },
      { type: "stroke", color: "#10b981", size: 4, points: [{x: 320, y: 230}, {x: 360, y: 230}, {x: 360, y: 350}, {x: 320, y: 350}] },
      { type: "stroke", color: "#ef4444", size: 6, points: [{x: 500, y: 100}, {x: 540, y: 120}, {x: 520, y: 160}, {x: 480, y: 140}, {x: 500, y: 100}] }
    ];

    let stepIndex = 0;
    this.botDrawInterval = setInterval(() => {
      if (this.state !== "DRAWING" || stepIndex >= steps.length) {
        clearInterval(this.botDrawInterval);
        return;
      }
      const step = steps[stepIndex++];
      this.drawHistory.push(step);
      this.io.to(this.id).emit("draw_action", step);
    }, 3500);
  }

  handleGuess(playerId, rawMessage) {
    const player = this.players.get(playerId);
    if (!player || !rawMessage) return;

    const raw = typeof rawMessage === "object" && rawMessage.text ? rawMessage.text : String(rawMessage || "");
    const text = raw.trim();
    if (!text) return;

    // Se o jogador é o desenhista, ele não pode dar palpites da palavra secreta, mas pode conversar no chat
    if (playerId === this.currentDrawerId) {
      this.broadcastMessage("chat", text, player);
      return;
    }

    // Se o jogador já acertou a palavra nesta rodada
    if (player.hasGuessed) {
      this.broadcastMessage("guessed_chat", text, player);
      return;
    }

    // Se não estivermos em fase de desenho, é chat normal
    if (this.state !== "DRAWING" || !this.selectedWord) {
      this.broadcastMessage("chat", text, player);
      return;
    }

    // Verificar correspondência com a palavra
    const normGuess = normalizeWord(text);
    const normTarget = normalizeWord(this.selectedWord.word);

    if (normGuess === normTarget) {
      // ACERTOU!
      player.hasGuessed = true;
      const isFirstGuesser = (this.guessedPlayers.size === 0);
      this.guessedPlayers.add(playerId);

      // Calcular pontuação baseada na ordem de acerto (Padrão Oficial Gartic)
      // 1º acerto: 10 pontos
      // 2º acerto: 9 pontos
      // 3º acerto: 8 pontos
      // 4º acerto: 7 pontos
      // 5º acerto: 6 pontos
      // 6º em diante: 5 pontos (mínimo garantido)
      const guessOrder = this.guessedPlayers.size - 1; // 0 para o primeiro
      const points = Math.max(5, 10 - guessOrder);
      
      player.score += points;
      this.scores.set(playerId, player.score);
      this.roundScores.set(playerId, points);

      // Bônus para o desenhista (+2 pontos por acerto, padrão Gartic)
      const drawer = this.players.get(this.currentDrawerId);
      if (drawer) {
        drawer.score += 2;
        this.scores.set(drawer.id, drawer.score);
        const currentDrawerRound = this.roundScores.get(drawer.id) || 0;
        this.roundScores.set(drawer.id, currentDrawerRound + 2);
      }

      // Notificar todos sobre o acerto com destaque se for o 1º a acertar
      this.io.to(this.id).emit("player_guessed", {
        playerId: player.id,
        playerName: player.name,
        points: points,
        score: player.score,
        isFirstGuesser: isFirstGuesser,
        drawerId: drawer ? drawer.id : null,
        drawerScore: drawer ? drawer.score : null
      });

      // Transmitir mensagem estilizada de acerto (idêntica ao layout Drawhio)
      this.broadcastMessage("correct-guess", "acertei!", player, { points: points });

      // Dinâmica de encerramento por Modo de Jogo
      if (this.settings.gameMode === "duelo" || this.settings.gameMode === "duelo_rush") {
        // No Duelo / Duelo Rush (1 vs 1), o acerto do adivinhador finaliza o turno de imediato
        if (this.timeRemaining > 2) {
          this.timeRemaining = 2;
          const msg = (this.settings.gameMode === "duelo_rush") 
            ? "Duelo Rush: Acerto relâmpago! Turno encerrado em 2s!" 
            : "Duelo: Palavra acertada! Próximo turno em 2s...";
          this.broadcastMessage("system", msg);
        }
      } else if (this.settings.gameMode === "rapido") {
        // No Modo Rápido, assim que qualquer jogador acerta, o tempo restante cai para 8 segundos
        if (this.timeRemaining > 8) {
          this.timeRemaining = 8;
          this.broadcastMessage("system", "Modo Rápido: Alguém acertou! Cronômetro reduzido para 8s!");
        }
      } else {
        // Modo Clássico / Telefone: acelerar apenas quando todos os adivinhadores tiverem acertado
        const totalGuessers = Array.from(this.players.values()).filter(p => !p.isDrawing).length;
        if (this.guessedPlayers.size >= totalGuessers) {
          if (this.timeRemaining > 2) {
            this.timeRemaining = 2;
            this.broadcastMessage("system", "Todos acertaram! Encerrando rodada...");
          }
        }
      }

      if (this.settings.gameMode === "telefone") {
        this.telephoneChain.push({
          step: this.telephoneChain.length + 1,
          round: this.currentRound,
          type: "guess",
          author: player.name,
          text: text,
          isCorrect: true
        });
      }

      this.broadcastRoomState();
      return;
    }

    // Verificar se o chute está "perto" (Levenshtein)
    if (isCloseGuess(text, this.selectedWord.word)) {
      // Enviar aviso particular "Está perto!" somente para quem chutou
      this.io.to(playerId).emit("close_guess", {
        guess: text,
        message: `"${text}" está muito perto!`
      });
      this.broadcastMessage("chat", text, player);
      return;
    }

    // Chute normal errado
    if (this.settings.gameMode === "telefone" && this.state === "DRAWING") {
      this.telephoneChain.push({
        step: this.telephoneChain.length + 1,
        round: this.currentRound,
        type: "guess",
        author: player.name,
        text: text,
        isCorrect: false
      });
    }

    this.broadcastMessage("chat", text, player);
  }

  handleDrawAction(playerId, action) {
    // Somente o desenhista atual pode desenhar
    if (playerId !== this.currentDrawerId || this.state !== "DRAWING") return;

    if (action.type === "clear") {
      this.drawHistory = [];
    } else if (action.type === "undo") {
      this.drawHistory.pop();
    } else {
      this.drawHistory.push(action);
    }

    // Repassar para todos os outros jogadores da sala
    this.io.to(this.id).emit("draw_action", action);
  }

  endTurn(wasAborted = false) {
    this.clearTimers();
    this.state = "ROUND_END";

    const revealedWord = this.selectedWord ? this.selectedWord.word : "Nenhuma";
    const drawer = this.players.get(this.currentDrawerId);
    this.roundDrawHistory = [...this.drawHistory];

    if (this.settings.gameMode === "telefone") {
      this.telephoneChain.push({
        step: this.telephoneChain.length + 1,
        round: this.currentRound,
        type: "draw",
        author: drawer ? drawer.name : "Desenhista",
        history: [...this.drawHistory],
        word: revealedWord
      });
    }

    this.io.to(this.id).emit("round_ended", {
      revealedWord: revealedWord,
      hint: this.selectedWord ? this.selectedWord.hint : "",
      drawerName: drawer ? drawer.name : "Desenhista",
      guessedCount: this.guessedPlayers.size,
      totalPlayers: this.players.size - 1,
      drawHistory: this.roundDrawHistory, // enviado para reprodução do Timelapse (5s)
      scores: Array.from(this.players.values()).map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        roundPoints: this.roundScores.get(p.id) || 0
      }))
    });

    this.broadcastRoomState();

    // Para modos competitivos (Clássico, Rápido, Duelo): verificar se alguém alcançou a Meta de Pontos!
    if (this.settings.gameMode !== "telefone") {
      const winner = Array.from(this.players.values()).find(p => p.score >= this.settings.pointsGoal);
      if (winner) {
        this.broadcastMessage("system", `🏆 ${winner.name} atingiu a meta de ${this.settings.pointsGoal} pontos e venceu a partida!`);
        this.timeRemaining = 4;
        this.timer = setInterval(() => {
          this.timeRemaining--;
          if (this.timeRemaining <= 0) {
            clearInterval(this.timer);
            this.endGame();
          }
        }, 1000);
        return;
      }
    }

    // 3 segundos de intervalo mostrando os resultados antes do próximo turno
    this.timeRemaining = 3;
    this.timer = setInterval(() => {
      this.timeRemaining--;
      if (this.timeRemaining <= 0) {
        clearInterval(this.timer);
        this.nextTurn();
      }
    }, 1000);
  }

  endGame() {
    this.clearTimers();
    this.state = "GAME_OVER";

    // Ordenar classificação final
    const podium = Array.from(this.players.values())
      .sort((a, b) => b.score - a.score);

    this.io.to(this.id).emit("game_over", {
      podium: podium,
      telephoneChain: this.telephoneChain,
      gameMode: this.settings.gameMode
    });

    this.broadcastRoomState();
  }

  restartToLobby() {
    this.clearTimers();
    this.state = "LOBBY";
    this.currentRound = 1;
    this.drawerIndex = -1;
    this.drawHistory = [];
    this.roundDrawHistory = [];
    this.telephoneChain = [];
    this.telefoneBooks = null;
    this.telefoneBooksArray = null;
    this.telefoneSubmissions = null;
    this.telefonePlayers = [];
    this.guessedPlayers.clear();
    this.roundScores.clear();
    this.selectedWord = null;

    for (const p of this.players.values()) {
      p.score = 0;
      p.hasGuessed = false;
      p.isDrawing = false;
    }

    this.broadcastRoomState();
    this.broadcastMessage("system", "A partida foi reiniciada para o Lobby!");
  }

  clearTimers() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.votekickTimer) {
      clearInterval(this.votekickTimer);
      this.votekickTimer = null;
    }
    if (this.disconnectedPlayers) {
      for (const entry of this.disconnectedPlayers.values()) {
        if (entry.timer) clearTimeout(entry.timer);
      }
      this.disconnectedPlayers.clear();
    }
    if (this.botDrawInterval) {
      clearInterval(this.botDrawInterval);
      this.botDrawInterval = null;
    }
    this.botGuessTimeouts.forEach(t => clearTimeout(t));
    this.botGuessTimeouts = [];
  }

  broadcastRoomState() {
    if (!this.io) return;

    const categoryLabels = {
      todos: "Todos os temas",
      animais: "Animais",
      objetos: "Objetos",
      alimentos: "Alimentos",
      lugares: "Lugares",
      profissoes: "Profissões",
      natureza: "Natureza",
      personalizado: "Personalizado"
    };

    const modeLabels = {
      classico: "Clássico",
      rapido: "Rápido (Timer Dinâmico)",
      duelo: "Duelo 1v1",
      duelo_rush: "Duelo 1v1 Rush (25s)",
      telefone: "Telefone Sem Fio"
    };

    const playersList = Array.from(this.players.values()).map(p => ({
      id: p.id,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      isHost: p.id === this.hostId,
      isBot: p.isBot,
      hasGuessed: this.guessedPlayers.has(p.id),
      isDrawing: p.id === this.currentDrawerId
    }));

    const maskedHint = this.selectedWord ? getMaskedHint(this.selectedWord.word, 0) : "";

    // Enviar dados específicos para cada jogador
    for (const [socketId, player] of this.players.entries()) {
      if (player.isBot) continue;

      const isDrawer = (player.id === this.currentDrawerId);
      this.io.to(socketId).emit("room_state", {
        roomId: this.id,
        state: this.state,
        currentRound: this.currentRound,
        totalRounds: this.settings.totalRounds,
        timeRemaining: this.timeRemaining,
        currentDrawerId: this.currentDrawerId,
        isDrawer: isDrawer,
        players: playersList,
        // Se for o desenhista, vê a palavra e a dica completas; se não, vê a dica mascarada
        secretWord: isDrawer && this.selectedWord ? this.selectedWord.word : null,
        wordHint: this.selectedWord ? this.selectedWord.hint : null,
        maskedHint: isDrawer && this.selectedWord ? this.selectedWord.word : maskedHint,
        wordChoices: isDrawer && this.state === "SELECTING_WORD" ? this.wordChoices : [],
        settings: {
          roundDuration: this.settings.roundDuration,
          totalRounds: this.settings.totalRounds,
          pointsGoal: this.settings.pointsGoal || 120,
          category: this.settings.category,
          gameMode: this.settings.gameMode,
          isPublic: this.isPublic,
          hasPassword: Boolean(this.password),
          customWords: this.customWords || [],
          customWordsCount: this.customWords ? this.customWords.length : 0
        },
        settingsSummary: {
          durationText: `${this.settings.roundDuration}s`,
          roundsText: `${this.settings.totalRounds} rodadas`,
          goalText: `${this.settings.pointsGoal || 120} pts`,
          categoryText: categoryLabels[this.settings.category] || this.settings.category,
          modeText: modeLabels[this.settings.gameMode] || this.settings.gameMode
        }
      });
    }
  }

  broadcastMessage(type, content, sender = null, metadata = {}) {
    if (!this.io) return;
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    this.io.to(this.id).emit("chat_message", {
      type: type, // 'chat', 'system', 'correct-guess', 'success', 'close-guess', 'guessed_chat'
      message: content,
      content: content,
      sender: sender ? {
        id: sender.id,
        name: sender.name,
        avatar: sender.avatar,
        score: sender.score,
        isDrawing: sender.id === this.currentDrawerId
      } : null,
      timestamp: timeStr,
      ...metadata
    });
  }
}

module.exports = GameRoom;
