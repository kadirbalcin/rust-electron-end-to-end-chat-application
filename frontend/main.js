const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");
const net = require("net");

let clientIdPath = path.join(app.getPath("userData"), "client_id.json");
let clientId = null;
let socket = null;

// Rastgele 9–12 haneli ID üret
function generateClientId() {
  const length = Math.floor(Math.random() * 4) + 9; // 9–12 arası
  let id = "";
  for (let i = 0; i < length; i++) {
    id += Math.floor(Math.random() * 10).toString();
  }
  return id;
}

// ID yükle / oluştur
function loadClientId() {
  if (fs.existsSync(clientIdPath)) {
    clientId = JSON.parse(fs.readFileSync(clientIdPath, "utf8")).clientId;
  } else {
    clientId = generateClientId();
    fs.writeFileSync(clientIdPath, JSON.stringify({ clientId }));
  }
}

// Rust backend’e bağlan
function connectToServer() {
  socket = new net.Socket();

  socket.connect(9000, "127.0.0.1", () => {
    console.log("Connected to Rust backend");
    socket.write(`CONNECT ${clientId}\n`);
  });

  socket.on("data", (data) => {
    mainWindow.webContents.send("server-msg", data.toString());
  });
}

let mainWindow;
function createWindow() {
  loadClientId();

  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  });

  mainWindow.loadFile("index.html");

  mainWindow.webContents.on("did-finish-load", () => {
    mainWindow.webContents.send("client-id", clientId);
  });
}

app.whenReady().then(() => {
  createWindow();
  connectToServer();
});

// IPC ile UI’den mesaj gönderme
ipcMain.on("send-request", (_, targetId) => {
  socket.write(`REQUEST ${targetId}\n`);
});

ipcMain.on("accept-request", (_, sourceId) => {
  socket.write(`ACCEPT ${sourceId}\n`);
});

ipcMain.on("send-msg", (_, targetId, text) => {
  socket.write(`MSG ${targetId}:${text}\n`);
});

ipcMain.on("disconnect", (_, targetId) => {
  if (socket) socket.write(`DISCONNECT ${targetId}\n`);
});