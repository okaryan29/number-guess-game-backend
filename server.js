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
    methods: ["GET", "POST"],
  },
});

const rooms = {}; // roomId -> { players: [socket1, socket2], secretsSet: 0 }

function calculateFeedback(secret, guess) {
  let correctPosition = 0;
  let correctDigits = 0;

  const secretArr = secret.split("");
  const guessArr = guess.split("");

  const secretUsed = Array(secretArr.length).fill(false);
  const guessUsed = Array(guessArr.length).fill(false);

  // Step 1: count digits in correct position
  for (let i = 0; i < secretArr.length; i++) {
    if (guessArr[i] === secretArr[i]) {
      correctPosition++;
      secretUsed[i] = true;
      guessUsed[i] = true;
    }
  }

  // Step 2: count correct digits in wrong positions
  for (let i = 0; i < guessArr.length; i++) {
    if (guessUsed[i]) continue;

    for (let j = 0; j < secretArr.length; j++) {
      if (!secretUsed[j] && guessArr[i] === secretArr[j]) {
        correctDigits++;
        secretUsed[j] = true;
        break;
      }
    }
  }

  const totalCorrectDigits = correctDigits + correctPosition;
  return { correctDigits: totalCorrectDigits, correctPosition };
}

io.on("connection", (socket) => {
  console.log("✅ New client connected:", socket.id);

  socket.on("joinGame", () => {
    let room = Object.keys(rooms).find((r) => rooms[r].players.length < 2);

    if (!room) {
      room = `room-${Math.random().toString(36).substring(2, 8)}`;
      rooms[room] = { players: [], secretsSet: 0 };
    }

    socket.join(room);
    rooms[room].players.push(socket);
    socket.roomId = room;

    if (rooms[room].players.length === 2) {
      io.to(room).emit("log", "🎯 Both players connected! Set your secret numbers!");
    } else {
      socket.emit("log", "⏳ Waiting for an opponent to join...");
    }
  });

  socket.on("setSecret", (secret) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    socket.secret = secret;
    room.secretsSet++;

    if (room.secretsSet === 2) {
      const startId = room.players[Math.floor(Math.random() * 2)].id;
      io.to(room).emit("gameStart", { startId });
      io.to(room).emit("log", "🎯 Both secrets set! Game start!");
    } else {
      socket.emit("log", "✅ Secret number set! Waiting for opponent...");
    }
  });

  socket.on("makeGuess", (guess) => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const opponentSocket = room.players.find((p) => p.id !== socket.id);
    if (!opponentSocket || !opponentSocket.secret) return;

    const { correctDigits, correctPosition } = calculateFeedback(opponentSocket.secret, guess);

    io.to(socket.id).emit("guessResult", { guess, correctDigits, correctPosition });
    io.to(opponentSocket.id).emit("opponentGuess", { guess, correctDigits, correctPosition });

    if (correctPosition === 4) {
      io.to(room).emit("gameWin", socket.id);
    } else {
      io.to(opponentSocket.id).emit("yourTurn");
      io.to(socket.id).emit("opponentTurn");
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Client disconnected:", socket.id);
    const room = rooms[socket.roomId];
    if (room) {
      room.players.forEach((p) => {
        if (p.id !== socket.id) io.to(p.id).emit("opponentLeft");
      });
      delete rooms[socket.roomId];
    }
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
