import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const players = {}; // socket.id → { id, roomId, secret }
const roomState = {}; // roomId → { turn }

io.on("connection", (socket) => {
  console.log("🟢 New player connected:", socket.id);

  // Auto-assign room
  let roomId = Object.keys(roomState).find(
    (r) => io.sockets.adapter.rooms.get(r)?.size === 1
  );
  if (!roomId) roomId = socket.id;

  socket.join(roomId);
  players[socket.id] = { id: socket.id, roomId };
  io.to(socket.id).emit("log", `Joined room ${roomId}`);

  const playersInRoom = Array.from(io.sockets.adapter.rooms.get(roomId) || []);
  if (playersInRoom.length === 2) {
    io.to(roomId).emit("log", "Two players connected! Set your secrets.");
  }

  socket.on("setSecret", (secret) => {
    const player = players[socket.id];
    if (!player) return socket.emit("log", "⚠️ You must join a room first.");

    player.secret = secret;
    socket.emit("log", "✅ Secret number set!");

    const roomPlayers = Object.values(players).filter(
      (p) => p.roomId === player.roomId
    );

    if (roomPlayers.length === 2 && roomPlayers.every((p) => p.secret)) {
      const [p1, p2] = roomPlayers;
      roomState[player.roomId] = { turn: p1.id };
      io.to(player.roomId).emit("gameStart", { startId: p1.id });
      io.to(player.roomId).emit("log", "🎮 Both players ready! Game started!");
    } else {
      socket.emit("log", "Waiting for your opponent to set their secret...");
    }
  });

  socket.on("makeGuess", (guess) => {
    const player = players[socket.id];
    if (!player) return;

    const roomId = player.roomId;
    const state = roomState[roomId];
    if (!state) return;

    if (state.turn !== socket.id) {
      return socket.emit("log", "⏳ Not your turn! Wait for opponent.");
    }

    const roomPlayers = Object.values(players).filter((p) => p.roomId === roomId);
    const opponent = roomPlayers.find((p) => p.id !== socket.id);
    if (!opponent || !opponent.secret) {
      return socket.emit("log", "⚠️ Opponent’s secret not ready!");
    }

    let correctPosition = 0;
    let correctNumber = 0;
    const oppSecret = opponent.secret.split("");
    const guessDigits = guess.split("");

    guessDigits.forEach((d, i) => {
      if (d === oppSecret[i]) correctPosition++;
      else if (oppSecret.includes(d)) correctNumber++;
    });

    socket.emit("guessResult", { guess, correctPosition, correctNumber });
    opponent && io.to(opponent.id).emit("opponentGuess", { guess, correctPosition, correctNumber });

    if (correctPosition === 4) {
      io.to(roomId).emit("gameWin", socket.id);
      io.to(roomId).emit("log", `🏆 Player ${socket.id} guessed correctly and wins!`);
      return;
    }

    state.turn = opponent.id;
    io.to(state.turn).emit("yourTurn");
    io.to(roomId).emit("log", `🔁 Turn switched! It's now ${opponent.id}'s turn.`);
  });

  socket.on("disconnect", () => {
    const player = players[socket.id];
    if (player?.roomId) io.to(player.roomId).emit("opponentLeft");
    delete players[socket.id];
  });
});

server.listen(3001, () => console.log("✅ Server running on port 3001"));
