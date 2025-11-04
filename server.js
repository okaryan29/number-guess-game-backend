import express from "express";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = 5000;

// Game state
const games = {}; // roomId -> { players: [id1, id2], numbers: {id: "1234"}, turn }

io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on("joinGame", () => {
    // Find a room with one player waiting
    let roomId = Object.keys(games).find(
      (id) => games[id].players.length === 1
    );

    if (!roomId) {
      // Create new room
      roomId = `room-${Math.floor(Math.random() * 10000)}`;
      games[roomId] = { players: [socket.id], numbers: {}, turn: null };
      socket.join(roomId);
      socket.emit("waiting", "Waiting for opponent...");
    } else {
      // Join existing room
      games[roomId].players.push(socket.id);
      socket.join(roomId);
      io.to(roomId).emit("gameStart", {
        roomId,
        players: games[roomId].players,
      });
      io.to(roomId).emit("waiting", "Both players connected!");
    }
  });

  socket.on("setNumber", ({ roomId, number }) => {
    const game = games[roomId];
    if (!game) return;

    game.numbers[socket.id] = number;
    socket.emit("numberSet", "Your number is set!");

    // Check if both players set numbers
    if (Object.keys(game.numbers).length === 2) {
      // Randomly pick starting player
      const [p1, p2] = game.players;
      game.turn = Math.random() < 0.5 ? p1 : p2;
      io.to(roomId).emit("bothReady", "Both numbers are set. Start guessing!");
      io.to(roomId).emit("nextTurn", game.turn);
    }
  });

  socket.on("makeGuess", ({ roomId, guess }) => {
    const game = games[roomId];
    if (!game) return;
    if (socket.id !== game.turn) return; // Not this player's turn

    const opponentId = game.players.find((id) => id !== socket.id);
    const secret = game.numbers[opponentId];
    const result = getGuessResult(secret, guess);

    io.to(socket.id).emit("guessResult", {
      player: socket.id,
      guess,
      result,
    });
    io.to(opponentId).emit("guessResult", {
      player: socket.id,
      guess,
      result,
    });

    // Check for win
    if (result.correctPosition === 4) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
    } else {
      // Switch turn
      game.turn = opponentId;
      io.to(roomId).emit("nextTurn", game.turn);
    }
  });

  socket.on("disconnect", () => {
    console.log(`User disconnected: ${socket.id}`);
    // Remove player from any rooms
    for (const roomId in games) {
      const game = games[roomId];
      if (game.players.includes(socket.id)) {
        socket.to(roomId).emit("opponentLeft");
        delete games[roomId];
      }
    }
  });
});

// Utility function
function getGuessResult(secret, guess) {
  let correctPosition = 0;
  let correctDigit = 0;

  const secretArr = secret.split("");
  const guessArr = guess.split("");

  const unmatchedSecret = [];
  const unmatchedGuess = [];

  for (let i = 0; i < 4; i++) {
    if (guessArr[i] === secretArr[i]) {
      correctPosition++;
    } else {
      unmatchedSecret.push(secretArr[i]);
      unmatchedGuess.push(guessArr[i]);
    }
  }

  unmatchedGuess.forEach((digit) => {
    const index = unmatchedSecret.indexOf(digit);
    if (index !== -1) {
      correctDigit++;
      unmatchedSecret.splice(index, 1);
    }
  });

  return { correctPosition, correctDigit };
}

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
