const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

const PORT = 5000;

// Store rooms: { roomId: { players: [socket], numbers: {}, ready: 0, turn: 0 } }
const rooms = {};

// Helper: Bulls & Cows with repeated digits
function calculateResult(secret, guess) {
  let bulls = 0; // correct position
  let cows = 0;  // correct digit, wrong position

  const secretCount = {};
  for (let digit of secret) {
    secretCount[digit] = (secretCount[digit] || 0) + 1;
  }

  // Count bulls
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) {
      bulls++;
      secretCount[guess[i]]--;
    }
  }

  // Count cows
  for (let i = 0; i < 4; i++) {
    if (guess[i] !== secret[i] && secretCount[guess[i]] > 0) {
      cows++;
      secretCount[guess[i]]--;
    }
  }

  return {
    correctPosition: bulls,
    correctDigit: bulls + cows  // total correct digits
  };
}

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  socket.on("joinGame", () => {
    let roomId = null;

    // Find or create room
    for (let id in rooms) {
      if (rooms[id].players.length === 1) {
        roomId = id;
        break;
      }
    }

    if (!roomId) {
      roomId = "room-" + Date.now();
      rooms[roomId] = { players: [], numbers: {}, ready: 0, turn: 0 };
    }

    socket.join(roomId);
    rooms[roomId].players.push(socket);

    socket.emit("waiting", "Waiting for opponent...");
    socket.roomId = roomId;

    if (rooms[roomId].players.length === 2) {
      const [p1, p2] = rooms[roomId].players;
      io.to(roomId).emit("gameStart", { roomId, players: [p1.id, p2.id] });
    }
  });

  socket.on("setNumber", ({ roomId, number }) => {
    if (!rooms[roomId] || !number || number.length !== 4) return;

    rooms[roomId].numbers[socket.id] = number;
    rooms[roomId].ready++;

    if (rooms[roomId].ready === 2) {
      io.to(roomId).emit("bothReady", "Both ready! First player starts.");
      const first = rooms[roomId].players[0];
      io.to(roomId).emit("nextTurn", first.id);
    }
  });

  socket.on("makeGuess", ({ roomId, guess }) => {
    const room = rooms[roomId];
    if (!room || room.turn >= room.players.length) return;

    const currentPlayer = room.players[room.turn];
    if (currentPlayer.id !== socket.id) return;

    const opponent = room.players.find(p => p.id !== socket.id);
    const secret = room.numbers[opponent.id];
    const result = calculateResult(secret, guess);

    // Send result to both
    io.to(roomId).emit("guessResult", {
      player: socket.id,
      guess,
      result
    });

    // Check win
    if (result.correctPosition === 4) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
      delete rooms[roomId];
      return;
    }

    // Next turn
    room.turn = (room.turn + 1) % 2;
    const nextPlayer = room.players[room.turn];
    io.to(roomId).emit("nextTurn", nextPlayer.id);
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    if (rooms[roomId]) {
      io.to(roomId).emit("opponentLeft");
      delete rooms[roomId];
    }
    console.log("Player left:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
