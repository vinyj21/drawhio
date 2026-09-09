// Catálogo rico de palavras em português para o jogo estilo Gartic.io

const WORDS_DATABASE = {
  animais: [
    { word: "Cachorro", hint: "O melhor amigo do homem" },
    { word: "Gato", hint: "Felino doméstico que adora dormir" },
    { word: "Elefante", hint: "Tem uma tromba grande" },
    { word: "Girafa", hint: "Pescoço muito comprido" },
    { word: "Leão", hint: "O rei da floresta/savana" },
    { word: "Tubarão", hint: "Predador dos oceanos com barbatana" },
    { word: "Macaco", hint: "Adora comer banana e subir em árvores" },
    { word: "Pinguim", hint: "Ave que não voa e vive no gelo" },
    { word: "Tartaruga", hint: "Tem casco duro e anda devagar" },
    { word: "Camaleão", hint: "Muda de cor para se camuflar" },
    { word: "Dinossauro", hint: "Réptil pré-histórico extinto" },
    { word: "Aranha", hint: "Tem oito patas e tece teias" },
    { word: "Coruja", hint: "Símbolo da sabedoria, gira a cabeça" },
    { word: "Golfinho", hint: "Mamífero aquático muito inteligente" },
    { word: "Sapo", hint: "Pula na lagoa e come moscas" },
    { word: "Urso", hint: "Gosta de mel e hiberna no inverno" },
    { word: "Zebra", hint: "Tem listras pretas e brancas" },
    { word: "Canguru", hint: "Pula alto e tem uma bolsa na barriga" },
    { word: "Polvo", hint: "Criatura do mar com 8 tentáculos" },
    { word: "Borboleta", hint: "Passa por metamorfose e tem asas coloridas" }
  ],
  objetos: [
    { word: "Celular", hint: "Aparelho portátil para chamadas e apps" },
    { word: "Computador", hint: "Máquina com tela, teclado e mouse" },
    { word: "Bicicleta", hint: "Veículo de duas rodas movido a pedal" },
    { word: "Relógio", hint: "Mede o tempo e tem ponteiros" },
    { word: "Guarda-chuva", hint: "Abre para proteger da chuva" },
    { word: "Tesoura", hint: "Objeto de corte com duas lâminas" },
    { word: "Espelho", hint: "Reflete a sua imagem" },
    { word: "Cadeira", hint: "Móvel feito para sentar" },
    { word: "Lanterna", hint: "Emite luz quando está escuro" },
    { word: "Violão", hint: "Instrumento musical com 6 cordas de madeira" },
    { word: "Televisão", hint: "Aparelho para assistir novelas e filmes" },
    { word: "Óculos", hint: "Ajuda a enxergar melhor ou protege do sol" },
    { word: "Mochila", hint: "Bolsa carregada nas costas" },
    { word: "Chave", hint: "Usada para trancar e abrir portas" },
    { word: "Escova de Dentes", hint: "Usada para higiene bucal após as refeições" },
    { word: "Skate", hint: "Prancha com quatro rodinhas para manobras" },
    { word: "Foguete", hint: "Veículo espacial veloz que vai para a lua" },
    { word: "Capacete", hint: "Proteção para a cabeça" }
  ],
  alimentos: [
    { word: "Pizza", hint: "Massa redonda com queijo, molho e orégano" },
    { word: "Hambúrguer", hint: "Pão com carne, queijo, alface e molho" },
    { word: "Sorvete", hint: "Sobremesa gelada servida na casquinha ou pote" },
    { word: "Melancia", hint: "Fruta grande, verde por fora e vermelha por dentro" },
    { word: "Chocolate", hint: "Doce feito a partir do cacau" },
    { word: "Pipoca", hint: "Milho estourado muito comum no cinema" },
    { word: "Bolo", hint: "Doce assado tradicional em aniversários com velas" },
    { word: "Abacaxi", hint: "Fruta tropical com coroa na ponta" },
    { word: "Batata Frita", hint: "Acompanhamento crocante e dourado" },
    { word: "Sushi", hint: "Comida japonesa tradicional com arroz e peixe" },
    { word: "Queijo", hint: "Derivado do leite que os ratos adoram" },
    { word: "Café", hint: "Bebida quente matinal escura e estimulante" },
    { word: "Banana", hint: "Fruta amarela e comprida rica em potássio" },
    { word: "Pão de Queijo", hint: "Clássico quitute mineiro assado e fofinho" }
  ],
  lugares: [
    { word: "Praia", hint: "Lugar com areia, mar e coqueiros" },
    { word: "Castelo", hint: "Construção medieval onde moravam reis e rainhas" },
    { word: "Hospital", hint: "Onde médicos e enfermeiros cuidam dos doentes" },
    { word: "Floresta", hint: "Grande extensão de terra coberta por árvores" },
    { word: "Vulcão", hint: "Montanha que entra em erupção e expele lava" },
    { word: "Cinema", hint: "Lugar com tela gigante e poltronas para ver filmes" },
    { word: "Parque de Diversões", hint: "Tem montanha-russa, roda-gigante e carrossel" },
    { word: "Aeroporto", hint: "Lugar onde aviões decolam e pousam" },
    { word: "Ilha", hint: "Porção de terra cercada por água por todos os lados" },
    { word: "Pirâmide", hint: "Monumento triangular construído no antigo Egito" }
  ],
  profissoes: [
    { word: "Médico", hint: "Profissional da saúde que usa estetoscópio" },
    { word: "Bombeiro", hint: "Apaga incêndios e resgata pessoas e animais" },
    { word: "Astronauta", hint: "Viaja pelo espaço vestindo roupa pressurizada" },
    { word: "Cozinheiro", hint: "Prepara pratos deliciosos e usa chapéu toque" },
    { word: "Pintor", hint: "Trabalha com tintas, pincéis ou rolos em telas/paredes" },
    { word: "Piloto", hint: "Comanda aeronaves no céu" },
    { word: "Detetive", hint: "Investiga mistérios com lupa e sobretudo" },
    { word: "Mágico", hint: "Tira coelho da cartola e faz truques incríveis" }
  ],
  natureza: [
    { word: "Sol", hint: "Estrela central do nosso sistema solar" },
    { word: "Lua", hint: "Satélite natural da Terra que brilha à noite" },
    { word: "Arco-íris", hint: "Faixa de sete cores que aparece com sol e chuva" },
    { word: "Relâmpago", hint: "Clarão elétrico no céu durante tempestades" },
    { word: "Fogo", hint: "Produz calor, luz e chamas vermelhas/amarelas" },
    { word: "Coração", hint: "Órgão vital que bombeia sangue e simboliza amor" },
    { word: "Estrela", hint: "Ponto brilhante no céu noturno" }
  ]
};

// Normalizar strings para comparação (sem acento, minúsculas, sem espaços extras)
function normalizeWord(str) {
  if (!str) return "";
  return str
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

// Distância de Levenshtein para detecção de "Está perto!"
function getLevenshteinDistance(a, b) {
  const normA = normalizeWord(a);
  const normB = normalizeWord(b);

  if (normA === normB) return 0;
  if (!normA.length) return normB.length;
  if (!normB.length) return normA.length;

  const matrix = [];
  for (let i = 0; i <= normB.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= normA.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= normB.length; i++) {
    for (let j = 1; j <= normA.length; j++) {
      if (normB.charAt(i - 1) === normA.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substituição
          matrix[i][j - 1] + 1,     // inserção
          matrix[i - 1][j] + 1      // deleção
        );
      }
    }
  }

  return matrix[normB.length][normA.length];
}

// Verifica se um chute está "muito perto"
function isCloseGuess(guess, targetWord) {
  const normGuess = normalizeWord(guess);
  const normTarget = normalizeWord(targetWord);
  if (normGuess === normTarget) return false; // é acerto exato
  
  const dist = getLevenshteinDistance(normGuess, normTarget);
  // Se a palavra tiver 4 ou mais letras e a distância for 1, ou se for muito longa (>=8) e dist <= 2
  if (normTarget.length >= 4 && dist === 1) return true;
  if (normTarget.length >= 8 && dist <= 2) return true;
  return false;
}

// Obter 3 palavras aleatórias para o desenhista escolher
function getRandomWordChoices(category = "todos", customWords = []) {
  let pool = [];

  // Suporte a Palavras Personalizadas (v1.3)
  if (category === "personalizado" && Array.isArray(customWords) && customWords.length > 0) {
    pool = customWords.map(w => {
      if (typeof w === "object" && w.word) {
        return { word: w.word.trim(), hint: w.hint || "Palavra personalizada da sala", category: "personalizado" };
      }
      const str = String(w).trim();
      return { word: str, hint: "Palavra personalizada da sala", category: "personalizado" };
    }).filter(w => w.word.length > 0);
  } else if (category !== "todos" && WORDS_DATABASE[category]) {
    pool = WORDS_DATABASE[category].map(item => ({ ...item, category }));
  } else {
    for (const [cat, words] of Object.entries(WORDS_DATABASE)) {
      words.forEach(w => pool.push({ ...w, category: cat }));
    }
  }

  // Fallback caso a lista customizada esteja vazia
  if (pool.length === 0) {
    for (const [cat, words] of Object.entries(WORDS_DATABASE)) {
      words.forEach(w => pool.push({ ...w, category: cat }));
    }
  }

  // Embaralhar e pegar 3 distintas
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, Math.min(3, shuffled.length));
}

// Gera máscara de dicas (ex: "C A _ _ O _ _ O")
function getMaskedHint(word, progressRatio = 0) {
  // progressRatio varia de 0 (início) a 1 (fim da rodada)
  const letters = word.split("");
  const totalLetters = letters.filter(c => c !== " " && c !== "-").length;
  
  // Quantas letras revelar baseado no progresso (máximo 45% das letras reveladas)
  const revealTarget = Math.floor(totalLetters * Math.min(progressRatio * 0.5, 0.45));
  
  // Escolher índices fixos de letras baseado em hash para consistência durante a mesma rodada
  let revealedCount = 0;
  const chars = [];
  
  // Seeding simples baseado nas letras para revelar consistentemente
  for (let i = 0; i < letters.length; i++) {
    const char = letters[i];
    if (char === " " || char === "-") {
      chars.push(char);
      continue;
    }
    // Determinar se revela este caractere
    // Por exemplo, revelar primeira letra se progressRatio > 0.4
    if ((i === 0 && progressRatio >= 0.35 && revealTarget >= 1) ||
        (i === Math.floor(letters.length / 2) && progressRatio >= 0.65 && revealTarget >= 2) ||
        (i === letters.length - 1 && progressRatio >= 0.85 && revealTarget >= 3)) {
      chars.push(char.toUpperCase());
      revealedCount++;
    } else {
      chars.push("_");
    }
  }

  return chars.join(" ");
}

module.exports = {
  WORDS_DATABASE,
  normalizeWord,
  getLevenshteinDistance,
  isCloseGuess,
  getRandomWordChoices,
  getMaskedHint
};
