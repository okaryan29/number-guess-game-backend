const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

let players = [];
let secrets = {};
let turnIndex = 0;

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  // When a player joins
  socket.on("joinGame", () => {
    if (!players.includes(socket.id)) {
      players.push(socket.id);
    }

    console.log("Players:", players);

    if (players.length === 2) {
      io.emit("log", "Both players joined. Set your secret numbers!");
    }
  });

  // Handle setting secret numbers
  socket.on("setSecret", (secret) => {
    if (secret.length !== 4 || isNaN(secret)) {
      socket.emit("log", "❌ Invalid secret number.");
      return;
    }

    secrets[socket.id] = secret;
    console.log(`Secret set by ${socket.id}: ${secret}`);

    if (Object.keys(secrets).length === 2) {
      // Both players ready → start game
      const startId = players[turnIndex];
      io.emit("gameStart", { startId });
      io.to(startId).emit("yourTurn");
      io.to(players.find((id) => id !== startId)).emit("opponentTurn");
    } else {
      socket.emit("log", "Waiting for opponent to set their secret...");
    }
  });

  // Handle guessing logic
  socket.on("makeGuess", (guess) => {
    if (players.length < 2) return;

    const opponentId = players.find((id) => id !== socket.id);
    const opponentSecret = secrets[opponentId];

    if (!opponentSecret) {
      socket.emit("log", "Opponent’s secret not ready yet.");
      return;
    }

    // --- Feedback calculation ---
    let correctPosition = 0;
    let correctDigits = 0;
    const secretUsed = Array(4).fill(false);
    const guessUsed = Array(4).fill(false);

    // Step 1: Correct positions
    for (let i = 0; i < 4; i++) {
      if (guess[i] === opponentSecret[i]) {
        correctPosition++;
        correctDigits++;
        secretUsed[i] = true;
        guessUsed[i] = true;
      }
    }

    // Step 2: Additional matching digits (misplaced)
    for (let i = 0; i < 4; i++) {
      if (!guessUsed[i]) {
        for (let j = 0; j < 4; j++) {
          if (!secretUsed[j] && guess[i] === opponentSecret[j]) {
            correctDigits++;
            secretUsed[j] = true;
            break;
          }
        }
      }
    }

    // Send feedback to both players
    io.to(socket.id).emit("guessResult", {
      guess,
      correctPosition,
      correctNumber: correctDigits,
    });

    io.to(opponentId).emit("opponentGuess", {
      guess,
      correctPosition,
      correctNumber: correctDigits,
    });

    // Check win condition
    if (correctPosition === 4) {
      io.emit("gameWin", socket.id);
      return;
    }

    // Switch turn
    turnIndex = (turnIndex + 1) % 2;
    const nextPlayer = players[turnIndex];
    io.to(nextPlayer).emit("yourTurn");
    io.to(players.find((id) => id !== nextPlayer)).emit("opponentTurn");
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    players = players.filter((id) => id !== socket.id);
    delete secrets[socket.id];
    io.emit("opponentLeft");
  });
});

server.listen(5000, () => console.log("✅ Server running on port 5000"));
