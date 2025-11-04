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

// --- Game State ---
let players = [];
let secrets = {};
let currentTurn = null;
let gameStarted = false;

// Helper: send logs
const log = (msg) => io.emit("gameLog", msg);

// --- Socket.io setup ---
io.on("connection", (socket) => {
  console.log("✅ User connected:", socket.id);

  // Player joins
  socket.on("joinGame", () => {
    if (players.length >= 2) {
      socket.emit("errorMsg", "Game full. Try again later.");
      return;
    }

    players.push(socket.id);
    socket.emit("joinedGame", { playerId: socket.id });
    log(`Player joined (${players.length}/2)`);

    if (players.length === 1) {
      socket.emit("waitingForOpponent", true);
      socket.emit("gameLog", "Waiting for another player to join...");
    }

    // When both players joined
    if (players.length === 2) {
      io.emit("bothPlayersReady", true);
      log("Both players connected! Set your secret numbers.");
    }
  });

  // Handle secret number
  socket.on("setSecret", (secret) => {
    if (!players.includes(socket.id)) return;
    secrets[socket.id] = secret;
    socket.emit("gameLog", "✅ Secret number set! Waiting for opponent...");

    if (Object.keys(secrets).length === 2 && !gameStarted) {
      gameStarted = true;
      currentTurn = players[Math.floor(Math.random() * 2)];

      io.emit("bothSecretsSet", true);
      io.emit("gameStart", { startId: currentTurn });
      log("🎯 Both secrets set! Game start!");
    }
  });

  // Handle guesses
  socket.on("makeGuess", (guess) => {
    if (!gameStarted || socket.id !== currentTurn) {
      socket.emit("gameLog", "⏳ Not your turn!");
      return;
    }

    const opponentId = players.find((p) => p !== socket.id);
    const opponentSecret = secrets[opponentId];
    if (!opponentSecret) return;

    const { correctDigits, correctPosition } = checkGuess(
      guess,
      opponentSecret
    );

    // Send results to both
    socket.emit("guessResult", { guess, correctDigits, correctPosition });
    io.to(opponentId).emit("opponentGuess", {
      guess,
      correctDigits,
      correctPosition,
    });

    // Check for win
    if (correctPosition === 4) {
      io.emit("gameWin", socket.id);
      log("🏆 Game over! We have a winner!");
      resetGame();
      return;
    }

    // Switch turn
    currentTurn = opponentId;
    io.to(currentTurn).emit("yourTurn");
    io.to(socket.id).emit("opponentTurn");
  });

  // Disconnect
  socket.on("disconnect", () => {
    console.log("❌ User disconnected:", socket.id);
    players = players.filter((id) => id !== socket.id);
    delete secrets[socket.id];
    gameStarted = false;
    currentTurn = null;

    if (players.length === 1) {
      io.to(players[0]).emit("waitingForOpponent", true);
      log("⚠️ Opponent disconnected. Waiting for new player...");
    } else {
      log("All players left. Game reset.");
    }
  });
});

// --- Helper Functions ---
function checkGuess(guess, secret) {
  let correctPosition = 0;
  let correctDigits = 0;

  const secretArr = secret.split("");
  const guessArr = guess.split("");

  // Step 1: count correct positions
  for (let i = 0; i < 4; i++) {
    if (guessArr[i] === secretArr[i]) {
      correctPosition++;
    }
  }

  // Step 2: count all correct digits (regardless of position)
  const secretCount = {};
  const guessCount = {};

  for (const d of secretArr) secretCount[d] = (secretCount[d] || 0) + 1;
  for (const d of guessArr) guessCount[d] = (guessCount[d] || 0) + 1;

  for (const d in guessCount) {
    if (secretCount[d]) {
      correctDigits += Math.min(secretCount[d], guessCount[d]);
    }
  }

  return { correctDigits, correctPosition };
}

function resetGame() {
  players = [];
  secrets = {};
  currentTurn = null;
  gameStarted = false;
}

// --- Start Server ---
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
