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
let turn = null;
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

  // Handle secret set
  socket.on("setSecret", (secret) => {
    if (!players.includes(socket.id)) {
      console.warn("⚠️ setSecret called before joinGame. Ignoring.");
      return;
    }

    secrets[socket.id] = secret;
    socket.emit("gameLog", "✅ Secret number set! Waiting for opponent...");

    // Both secrets set — start the game
    if (Object.keys(secrets).length === 2 && !gameStarted) {
      gameStarted = true;
      // Randomly choose who starts
      turn = players[Math.floor(Math.random() * 2)];

      io.emit("gameLog", "🎯 Both secrets set! Game starting!");
      io.emit("gameStart", { startId: turn });

      io.to(turn).emit("yourTurn");
      io.to(getOpponent(turn)).emit("opponentTurn");
    }
  });

  // Handle guesses
  socket.on("makeGuess", (guess) => {
    if (!gameStarted) {
      socket.emit("gameLog", "⚠️ Game hasn’t started yet!");
      return;
    }

    if (socket.id !== turn) {
      socket.emit("gameLog", "⏳ Wait for your turn!");
      return;
    }

    const opponentId = getOpponent(socket.id);
    const opponentSecret = secrets[opponentId];

    if (!opponentSecret) {
      socket.emit("gameLog", "⚠️ Opponent’s secret not ready yet!");
      return;
    }

    const { correctPosition, correctNumber } = evaluateGuess(
      guess,
      opponentSecret
    );

    socket.emit("guessResult", { guess, correctPosition, correctNumber });
    io.to(opponentId).emit("opponentGuess", {
      guess,
      correctPosition,
      correctNumber,
    });

    io.emit(
      "gameLog",
      `${socket.id.slice(0, 4)} guessed ${guess} → Correct Position: ${correctPosition}, Correct Digit(s): ${correctNumber}`
    );

    // Win check
    if (correctPosition === 4) {
      io.emit("gameWin", socket.id);
      io.emit("gameLog", `🏆 Player ${socket.id.slice(0, 4)} wins!`);
      resetGame();
      return;
    }

    // Switch turns
    turn = opponentId;
    io.to(turn).emit("yourTurn");
    io.to(getOpponent(turn)).emit("opponentTurn");
  });

  // Disconnects
  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);

    players = players.filter((id) => id !== socket.id);
    delete secrets[socket.id];
    gameStarted = false;
    turn = null;

    if (players.length === 1) {
      io.emit("gameLog", "⚠️ Opponent disconnected. Waiting for new player...");
      io.to(players[0]).emit("waitingForOpponent", true);
    } else {
      io.emit("gameLog", "All players left. Game reset.");
    }
  });
});

function getOpponent(id) {
  return players.find((p) => p !== id);
}

function evaluateGuess(guess, secret) {
  let correctPosition = 0;
  let correctNumber = 0;

  const guessArr = guess.split("");
  const secretArr = secret.split("");

  guessArr.forEach((d, i) => {
    if (d === secretArr[i]) {
      correctPosition++;
    } else if (secretArr.includes(d)) {
      correctNumber++;
    }
  });

  return { correctPosition, correctNumber };
}

function resetGame() {
  secrets = {};
  gameStarted = false;
  turn = null;
}

server.listen(PORT, () => {
  console.log(`✅ Server listening on port ${PORT}`);
});
