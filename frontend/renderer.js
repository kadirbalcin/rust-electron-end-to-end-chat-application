const net = require("net");

// ----------- SABİT CLIENT ID -------------
let clientId = localStorage.getItem("clientId");
if (!clientId) {
  clientId = Math.floor(100_000_000 + Math.random() * 900_000_000).toString();
  localStorage.setItem("clientId", clientId);
}
document.getElementById("cid").textContent = clientId;

// ----------- AES-GCM E2E KEY -------------
let sessionKey = null;

async function onAccept(from) {
  // 1. Yeni AES-GCM key oluştur
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );

  // 2. Key’i export edip base64 yap
  const raw = await crypto.subtle.exportKey("raw", key);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(raw)));

  // 3. SessionKey’i kendi tarafına kaydet
  sessionKey = key;

  // 4. Key’i server üzerinden A’ya gönder
  client.write(`SESSIONKEY:${from}:${b64}`);
  addMessage(`Connected securely with ${b64}`);
}

// Encrypt
async function encrypt(text) {
  const enc = new TextEncoder();
  const iv = window.crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    enc.encode(text)
  );

  return JSON.stringify({
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted)),
  });
}

// Decrypt
async function decrypt(jsonStr) {
  const obj = JSON.parse(jsonStr);
  const iv = new Uint8Array(obj.iv);
  const data = new Uint8Array(obj.data); // burada zaten tag cipher text içinde

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    data
  );

  return new TextDecoder().decode(decrypted);
}

// ----------- TCP CONNECTION -------------
const client = new net.Socket();
client.connect(9000, "127.0.0.1", () => {
  client.write(clientId);
});

let currentTarget = null;

// ----------- UI -----------

const targetInput = document.getElementById("targetId");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");

connectBtn.onclick = () => {
  currentTarget = targetInput.value.trim();
  if (!currentTarget) return;

  client.write(`CONNECT:${currentTarget}`);

  targetInput.disabled = true;
  connectBtn.disabled = true;
};

disconnectBtn.onclick = () => {
  if (currentTarget) {
    client.write(`DISCONNECT:${currentTarget}`);
  }

  addMessage("Connection closed.");

  targetInput.disabled = false;
  connectBtn.disabled = false;
  msgInput.disabled = true;
  sendBtn.disabled = true;
  disconnectBtn.disabled = true;

  currentTarget = null;
};

// Send message
sendBtn.onclick = async () => {
  const text = msgInput.value.trim();
  if (!text || !currentTarget) return;

  const encrypted = await encrypt(text);

  client.write(`MSG:${currentTarget}:${encrypted}`);

  addMessage(`You: ${text}`);
  msgInput.value = "";
};

// ----------- Incoming TCP messages -----------

client.on("data", async (data) => {
  const msg = data.toString().trim();
  console.log("RAW:", msg);

  if (msg.startsWith("SESSIONKEY:")) {
    const parts = msg.split(":");
    const from = parts[1];
    const b64 = parts.slice(2).join(":"); // ':' içerebilir

    // Base64 → ArrayBuffer
    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

    // Import key
    sessionKey = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"]
    );

    // Artık ortak key var, mesajlaşma aç
    msgInput.disabled = false;
    sendBtn.disabled = false;
    disconnectBtn.disabled = false;

    addMessage(`Connected securely with ${b64}`);
  }

  // INCOMING:<id>
  if (msg.startsWith("INCOMING:")) {
    const from = msg.replace("INCOMING:", "");
    document.getElementById("incoming").style.display = "block";
    document.getElementById("incomingId").textContent = from;

    document.getElementById("acceptBtn").onclick = () => {
      client.write(`ACCEPT:${from}`);
      currentTarget = from;

      targetInput.disabled = true;
      connectBtn.disabled = true;
      msgInput.disabled = false;
      sendBtn.disabled = false;
      disconnectBtn.disabled = true;

      onAccept(from);

      addMessage(`Connected with ${currentTarget}`);
      document.getElementById("incoming").style.display = "none";
    };
  }

  // ACCEPTED:<id>
  else if (msg.startsWith("ACCEPTED:")) {
    currentTarget = msg.replace("ACCEPTED:", "");

    msgInput.disabled = false;
    sendBtn.disabled = false;
    disconnectBtn.disabled = false;

    addMessage(`Connected with ${currentTarget}`);
  }

  // DISCONNECTED:<id>
  else if (msg.startsWith("DISCONNECTED:")) {
    addMessage("Connection closed.");

    targetInput.disabled = false;
    connectBtn.disabled = false;

    msgInput.disabled = true;
    sendBtn.disabled = true;
    disconnectBtn.disabled = true;

    currentTarget = null;
  }

  // MSG:<from>:<encrypted>
  else if (msg.startsWith("MSG:")) {
    console.log("msg received");
    const parts = msg.split(":");
    const from = parts[1];
    console.log("pars", parts);
    console.log("from", from);
    const encrypted = msg.substring(msg.indexOf("{"));

    console.log("encrypted", encrypted);

    const text = await decrypt(encrypted);

    addMessage(`${from}: ${text}`);
  } else if (msg.startsWith("BUSY:")) {
    const busyId = msg.replace("BUSY:", "");
    addMessage(`Client ${busyId} is busy. Try again later.`);
    targetInput.disabled = false;
    connectBtn.disabled = false;
    currentTarget = null;
    targetInput.value = "";
  }
});

function addMessage(m) {
  const div = document.getElementById("messages");
  div.innerHTML += m + "<br>";
  div.scrollTop = div.scrollHeight;
}
