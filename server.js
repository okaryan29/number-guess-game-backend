import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import { checkGuess } from "./utils.js";

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

let waitingPlayer = null;
const games = {}; // { roomId: { players: [], numbers: {}, turn: 0 } }

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("joinGame", (data) => {
    if (waitingPlayer) {
      const roomId = `room_${socket.id}_${waitingPlayer.id}`;
      games[roomId] = {
        players: [waitingPlayer.id, socket.id],
        numbers: {},
        turn: 0, // 0 -> player1's turn, 1 -> player2's
      };

      socket.join(roomId);
      waitingPlayer.join(roomId);

      io.to(roomId).emit("gameStart", {
        roomId,
        players: games[roomId].players,
      });

      waitingPlayer = null;
    } else {
      waitingPlayer = socket;
      socket.emit("waiting", "Waiting for another player...");
    }
  });

  socket.on("setNumber", ({ roomId, number }) => {
    const game = games[roomId];
    if (!game) return;

    game.numbers[socket.id] = number;

    if (Object.keys(game.numbers).length === 2) {
      io.to(roomId).emit("bothReady", "Both players have set their numbers!");
    }
  });

  socket.on("makeGuess", ({ roomId, guess }) => {
    const game = games[roomId];
    if (!game) return;

    const opponentId = game.players.find((id) => id !== socket.id);
    const opponentNumber = game.numbers[opponentId];
    if (!opponentNumber) return;

    const result = checkGuess(opponentNumber, guess);
    io.to(roomId).emit("guessResult", {
      player: socket.id,
      guess,
      result,
    });

    if (result.correctPosition === 4) {
      io.to(roomId).emit("gameOver", { winner: socket.id });
      delete games[roomId];
    } else {
      game.turn = game.turn === 0 ? 1 : 0;
      io.to(roomId).emit("nextTurn", game.players[game.turn]);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
    if (waitingPlayer?.id === socket.id) waitingPlayer = null;

    for (const roomId in games) {
      if (games[roomId].players.includes(socket.id)) {
        io.to(roomId).emit("opponentLeft");
        delete games[roomId];
      }
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
