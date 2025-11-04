import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 10000;

// ===== Simple global game state =====
const players = {};
let playerOrder = [];
let started = false;
let turn = null;

// Helper: send state to everyone
function broadcastUpdate() {
  io.emit("gameUpdate", {
    players: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, { name: p.name, ready: p.ready }])
    ),
    started,
    turn,
  });
}

// ===== SOCKET HANDLERS =====
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinGame", (name, cb) => {
    players[socket.id] = { name, ready: false, secret: "" };
    playerOrder.push(socket.id);
    console.log(`${name} joined. Total players: ${playerOrder.length}`);
    broadcastUpdate();
    if (cb) cb({ ok: true });

    // Auto-start when 2 joined
    if (playerOrder.length > 2) {
      console.log("Resetting game - too many players");
      Object.keys(players).forEach((id) => delete players[id]);
      playerOrder = [socket.id];
      started = false;
      turn = null;
    }
  });

  socket.on("setSecret", (secret, cb) => {
    if (typeof secret !== "string" || !/^\d{4}$/.test(secret)) {
      if (cb) cb({ ok: false, error: "Secret must be 4 digits" });
      return;
    }

    players[socket.id].secret = secret;
    players[socket.id].ready = true;
    console.log(`${players[socket.id].name} set secret: ${secret}`);

    const readyIds = Object.keys(players).filter((id) => players[id].ready);

    if (readyIds.length === 2 && !started) {
      started = true;
      const startIndex = Math.floor(Math.random() * 2);
      turn = playerOrder[startIndex];
      console.log("✅ Both ready! Game starting. Turn:", turn);
      io.emit("gameStart", { startId: turn });
    } else {
      console.log("Waiting for opponent...");
    }

    broadcastUpdate();
    if (cb) cb({ ok: true });
  });

  socket.on("makeGuess", (guess) => {
    if (!started || turn !== socket.id) return;

    const opponentId = playerOrder.find((id) => id !== socket.id);
    const secret = players[opponentId].secret;

    let correctPosition = 0;
    let correctNumber = 0;
    for (let i = 0; i < 4; i++) {
      if (guess[i] === secret[i]) correctPosition++;
      else if (secret.includes(guess[i])) correctNumber++;
    }

    io.to(socket.id).emit("guessResult", { guess, correctPosition, correctNumber });
    io.to(opponentId).emit("opponentGuess", { guess, correctPosition, correctNumber });

    if (correctPosition === 4) {
      io.emit("gameWin", socket.id);
      started = false;
      return;
    }

    turn = opponentId;
    io.to(turn).emit("yourTurn");
    broadcastUpdate();
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    delete players[socket.id];
    playerOrder = playerOrder.filter((id) => id !== socket.id);
    started = false;
    turn = null;
    io.emit("opponentLeft");
    broadcastUpdate();
  });
});

server.listen(PORT, () => console.log(`✅ Server listening on port ${PORT}`));
