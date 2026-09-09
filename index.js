const fs = require("fs");
const path = require("path");

if (fs.existsSync(path.join(__dirname, "server/server.js"))) {
  require("./server/server.js");
} else if (fs.existsSync(path.join(__dirname, "server.js"))) {
  require("./server.js");
} else if (fs.existsSync(path.join(__dirname, "gartic-online/server/server.js"))) {
  require("./gartic-online/server/server.js");
} else if (fs.existsSync(path.join(__dirname, "drawhio/server/server.js"))) {
  require("./drawhio/server/server.js");
} else {
  console.error("Erro: arquivo server.js não foi encontrado nem na raiz nem na pasta server/!");
  process.exit(1);
}
