import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 10000;

// Game state
let players = [];
let secrets = {};
let gameStarted = false;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // Player joins
  socket.on("joinGame", () => {
    if (players.length >= 2) {
      socket.emit("errorMsg", "Game full. Try again later.");
      return;
    }

    players.push(socket.id);
    console.log("Players:", players);

    socket.emit("joinedGame", { playerId: socket.id });
    io.emit("gameLog", `Player joined (${players.length}/2)`);

    // If only one player — make them wait
    if (players.length === 1) {
      socket.emit("waitingForOpponent", true);
      socket.emit("gameLog", "Waiting for another player to join...");
    }

    // If two players — start the match
    if (players.length === 2) {
      io.emit("bothPlayersReady", true);
      io.emit("gameLog", "Both players connected! Set your secret numbers.");
    }
  });

  // Handle secret set
  socket.on("setSecret", (secret) => {
    if (!players.includes(socket.id)) {
      console.warn("⚠️ setSecret called before joinGame. Ignoring.");
      return;
    }

    secrets[socket.id] = secret;
    socket.emit("gameLog", "✅ Secret number set! Waiting for opponent...");

    // If both secrets set, start game
    if (Object.keys(secrets).length === 2 && !gameStarted) {
      gameStarted = true;
      io.emit("bothSecretsSet", true);
      io.emit("gameLog", "🎯 Both secrets set! Game start!");
    }
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    players = players.filter((id) => id !== socket.id);
    delete secrets[socket.id];
    gameStarted = false;

    if (players.length === 1) {
      io.emit("gameLog", "⚠️ Opponent disconnected. Waiting for new player...");
      io.to(players[0]).emit("waitingForOpponent", true);
    } else {
      io.emit("gameLog", "All players left. Game reset.");
    }
  });
});

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
