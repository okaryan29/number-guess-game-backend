import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const PORT = process.env.PORT || 10000;

// ===== GAME STATE =====
const rooms = {}; // { roomId: { id, players, order, turn, started } }

// Helper: get player’s room
const findRoomByPlayer = (socketId) => {
  return Object.values(rooms).find((room) => room.players[socketId]);
};

// Helper: clean data before sending to clients
const sanitizeRoom = (room) => {
  return {
    id: room.id,
    started: room.started,
    turn: room.turn,
    order: room.order,
    logs: room.logs,
    players: Object.fromEntries(
      Object.entries(room.players).map(([id, p]) => [
        id,
        { name: p.name, ready: p.ready },
      ])
    ),
  };
};

// Add message to room log
const addLog = (room, msg) => {
  if (!room.logs) room.logs = [];
  room.logs.push(msg);
};

// ===== SOCKET LOGIC =====
io.on("connection", (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Player joins a room
  socket.on("joinGame", (name, cb) => {
    let room =
      Object.values(rooms).find(
        (r) => Object.keys(r.players).length < 2 && !r.started
      ) || null;

    if (!room) {
      // Create new room
      const roomId = Math.random().toString(36).substring(2, 8);
      room = {
        id: roomId,
        players: {},
        order: [],
        turn: null,
        started: false,
        logs: [],
      };
      rooms[roomId] = room;
    }

    // Add player to room
    room.players[socket.id] = { name, ready: false, secret: "" };
    room.order.push(socket.id);
    socket.join(room.id);

    addLog(room, `${name} joined room ${room.id}`);
    io.to(room.id).emit("roomUpdate", sanitizeRoom(room));
    if (cb) cb({ roomId: room.id });
  });

  // Player sets secret number
  socket.on("setSecret", (data, cb) => {
    const secret = typeof data === "string" ? data : data?.secret;
    const room = findRoomByPlayer(socket.id);

    if (!room) {
      if (cb) cb({ ok: false, error: "Room not found" });
      return;
    }

    if (typeof secret !== "string" || !/^\d{4}$/.test(secret)) {
      if (cb) cb({ ok: false, error: "Secret must be a 4-digit string" });
      return;
    }

    room.players[socket.id].secret = secret;
    room.players[socket.id].ready = true;
    addLog(room, `${room.players[socket.id].name} has set their secret.`);

    // Broadcast readiness
    io.to(room.id).emit("roomUpdate", sanitizeRoom(room));

    // Check if both ready
    const pIds = Object.keys(room.players);
    const bothReady =
      pIds.length === 2 && pIds.every((pid) => room.players[pid].ready);

    if (bothReady && !room.started) {
      room.started = true;
      const startIndex = Math.floor(Math.random() * 2);
      room.turn = room.order[startIndex];

      addLog(
        room,
        `Both players ready! ${room.players[room.turn].name} starts the game.`
      );

      io.to(room.id).emit("gameStart", {
        room: sanitizeRoom(room),
        startId: room.turn,
      });
    } else {
      addLog(room, `${room.players[socket.id].name} is ready. Waiting...`);
    }

    io.to(room.id).emit("roomUpdate", sanitizeRoom(room));
    if (cb) cb({ ok: true });
  });

  // Handle guesses
  socket.on("makeGuess", (guess) => {
    const room = findRoomByPlayer(socket.id);
    if (!room || !room.started || room.turn !== socket.id) return;

    const opponentId = room.order.find((id) => id !== socket.id);
    const opponent = room.players[opponentId];
    const secret = opponent.secret;

    let correctPosition = 0;
    let correctNumber = 0;

    for (let i = 0; i < 4; i++) {
      if (guess[i] === secret[i]) correctPosition++;
      else if (secret.includes(guess[i])) correctNumber++;
    }

    io.to(socket.id).emit("guessResult", {
      guess,
      correctPosition,
      correctNumber,
    });

    io.to(opponentId).emit("opponentGuess", {
      guess,
      correctPosition,
      correctNumber,
    });

    addLog(
      room,
      `${room.players[socket.id].name} guessed ${guess}: ${correctPosition} correct position, ${correctNumber} correct digits.`
    );

    if (correctPosition === 4) {
      io.to(room.id).emit("gameWin", socket.id);
      addLog(room, `${room.players[socket.id].name} wins!`);
      room.started = false;
      return;
    }

    // Switch turn
    room.turn = opponentId;
    io.to(room.turn).emit("yourTurn");
    io.to(room.order.find((id) => id !== room.turn)).emit("opponentTurn");

    io.to(room.id).emit("roomUpdate", sanitizeRoom(room));
  });

  // Player leaves
  socket.on("disconnect", () => {
    const room = findRoomByPlayer(socket.id);
    if (room) {
      addLog(room, `${room.players[socket.id].name} left the game.`);
      const opponentId = room.order.find((id) => id !== socket.id);
      delete room.players[socket.id];

      if (opponentId) io.to(opponentId).emit("opponentLeft");

      if (Object.keys(room.players).length === 0) delete rooms[room.id];
    }
    console.log(`User disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () =>
  console.log(`✅ Server listening on port ${PORT}`)
);
