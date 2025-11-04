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

    if (players.length === 1) {
      socket.emit("waitingForOpponent", true);
      socket.emit("gameLog", "Waiting for another player to join...");
    }

    if (players.length === 2) {
      io.emit("bothPlayersReady", true);
      io.emit("gameLog", "Both players connected! Set your secret numbers.");
    }
  });

  // Player sets secret
  socket.on("setSecret", (secret) => {
    if (!players.includes(socket.id)) {
      console.warn("⚠️ setSecret called before joinGame. Ignoring.");
      return;
    }

    secrets[socket.id] = secret;
    socket.emit("gameLog", "✅ Secret number set! Waiting for opponent...");

    // If both secrets are ready
    if (Object.keys(secrets).length === 2 && !gameStarted) {
      gameStarted = true;
      const randomStart = players[Math.floor(Math.random() * 2)];
      io.emit("gameStart", { startId: randomStart });
      io.emit("gameLog", "🎯 Both secrets set! Game start!");
    }
  });

  // Handle guesses
  socket.on("makeGuess", (guess) => {
    if (!gameStarted || !players.includes(socket.id)) return;

    const opponentId = players.find((id) => id !== socket.id);
    const opponentSecret = secrets[opponentId];
    if (!opponentSecret) return;

    const secretArr = opponentSecret.split("");
    const guessArr = guess.split("");

    // Step 1: count correct positions
    let correctPosition = 0;
    let secretRemaining = [];
    let guessRemaining = [];

    for (let i = 0; i < 4; i++) {
      if (guessArr[i] === secretArr[i]) {
        correctPosition++;
      } else {
        secretRemaining.push(secretArr[i]);
        guessRemaining.push(guessArr[i]);
      }
    }

    // Step 2: count correct digits (right digit, wrong place)
    let correctNumber = 0;
    guessRemaining.forEach((digit) => {
      const index = secretRemaining.indexOf(digit);
      if (index !== -1) {
        correctNumber++;
        secretRemaining.splice(index, 1);
      }
    });

    // Send feedback to both players
    io.to(socket.id).emit("guessResult", { guess, correctPosition, correctNumber });
    io.to(opponentId).emit("opponentGuess", { guess, correctPosition, correctNumber });

    // Check win condition
    if (correctPosition === 4) {
      io.emit("gameWin", socket.id);
      io.emit("gameLog", `🎉 Player ${socket.id} guessed correctly and won!`);
      gameStarted = false;
      secrets = {};
      players = [];
    } else {
      // Switch turns
      io.to(opponentId).emit("yourTurn");
      io.to(socket.id).emit("opponentTurn");
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
