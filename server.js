// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { computeFeedback, makeId } = require('./utils');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // change in production
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 4000;

/**
 * In-memory rooms:
 * rooms[roomId] = {
 *   id, players: { socketId: {id, name, secret, ready} }, order: [socketId, socketId],
 *   turn: socketId, started: bool, logs: []
 * }
 */
const rooms = {};

function makeRoom() {
  const id = makeId(6);
  rooms[id] = {
    id,
    players: {},
    order: [],
    turn: null,
    started: false,
    logs: []
  };
  return rooms[id];
}

function addLog(room, text) {
  room.logs.push({ time: Date.now(), text });
  // keep last 200
  if (room.logs.length > 200) room.logs.shift();
}

// Express route for health
app.get('/', (req, res) => res.send({ ok: true }));

io.on('connection', (socket) => {
  console.log('socket connected', socket.id);

  // create a new room and join it
  socket.on('createRoom', ({ name } = {}, cb) => {
    const room = makeRoom();
    room.players[socket.id] = { id: socket.id, name: name || 'Player', secret: null, ready: false };
    room.order.push(socket.id);
    socket.join(room.id);
    addLog(room, `${room.players[socket.id].name} created the room.`);
    console.log(`room created ${room.id} by ${socket.id}`);
    if (cb) cb({ ok: true, roomId: room.id });
    io.to(socket.id).emit('roomUpdate', sanitizeRoom(room));
  });

  // join existing room
  socket.on('joinRoom', ({ roomId, name } = {}, cb) => {
    const room = rooms[roomId];
    if (!room) {
      if (cb) cb({ ok: false, error: 'Room not found' });
      return;
    }
    if (Object.keys(room.players).length >= 2) {
      if (cb) cb({ ok: false, error: 'Room full' });
      return;
    }
    room.players[socket.id] = { id: socket.id, name: name || 'Player', secret: null, ready: false };
    room.order.push(socket.id);
    socket.join(room.id);
    addLog(room, `${room.players[socket.id].name} joined the room.`);
    io.to(room.id).emit('roomUpdate', sanitizeRoom(room));
    if (cb) cb({ ok: true, roomId: room.id });
  });

  // Set the player's secret number (string of 4 digits, no validation here or minimal)
  socket.on("setSecret", (data, cb) => {
  // Support both plain string and object payloads
  const secret = typeof data === "string" ? data : data?.secret;
  const room = Object.values(rooms).find((r) => r.players[socket.id]);

  if (!room) {
    if (cb) cb({ ok: false, error: "Room or player not found" });
    return;
  }

  // Basic validation
  if (typeof secret !== "string" || !/^\d{4}$/.test(secret)) {
    if (cb) cb({ ok: false, error: "Secret must be a 4-digit string" });
    return;
  }

  room.players[socket.id].secret = secret;
  room.players[socket.id].ready = true;
  addLog(room, `${room.players[socket.id].name} is ready.`);
  io.to(room.id).emit("roomUpdate", sanitizeRoom(room));

  // If both players are ready, start game
  const pIds = Object.keys(room.players);
  if (
    pIds.length === 2 &&
    room.players[pIds[0]].ready &&
    room.players[pIds[1]].ready &&
    !room.started
  ) {
    const startIndex = Math.floor(Math.random() * 2);
    room.turn = room.order[startIndex];
    room.started = true;

    addLog(room, `Game started. ${room.players[room.turn].name} starts.`);
    io.to(room.id).emit("gameStart", {
      room: sanitizeRoom(room),
      startId: room.turn,
    });
    io.to(room.id).emit("roomUpdate", sanitizeRoom(room));
  }

  if (cb) cb({ ok: true });
});

  // Make a guess
  socket.on('guess', ({ roomId, guess } = {}, cb) => {
    const room = rooms[roomId];
    if (!room || !room.players[socket.id]) {
      if (cb) cb({ ok: false, error: 'Room or player not found' });
      return;
    }
    if (!room.started) {
      if (cb) cb({ ok: false, error: 'Game not started' });
      return;
    }
    if (room.turn !== socket.id) {
      if (cb) cb({ ok: false, error: 'Not your turn' });
      return;
    }
    if (typeof guess !== 'string' || !/^\d{4}$/.test(guess)) {
      if (cb) cb({ ok: false, error: 'Guess must be a 4-digit string' });
      return;
    }

    // find opponent
    const opponentId = Object.keys(room.players).find(id => id !== socket.id);
    if (!opponentId) {
      if (cb) cb({ ok: false, error: 'Opponent not found' });
      return;
    }
    const opponent = room.players[opponentId];
    const feedback = computeFeedback(opponent.secret, guess);
    addLog(room, `${room.players[socket.id].name} guessed ${guess} => CP:${feedback.correctPosition} CN:${feedback.correctNumber}`);

    // broadcast the guess result to both players
    io.to(room.id).emit('guessResult', {
      by: socket.id,
      name: room.players[socket.id].name,
      guess,
      feedback,
      room: sanitizeRoom(room)
    });

    // check win
    if (feedback.correctPosition === 4) {
      room.started = false;
      addLog(room, `${room.players[socket.id].name} WON!`);
      io.to(room.id).emit('gameOver', { winner: socket.id, name: room.players[socket.id].name, room: sanitizeRoom(room) });
      // cleanup room after brief time (or keep for history) — we'll delete immediately
      cleanupRoom(room.id);
      if (cb) cb({ ok: true, win: true });
      return;
    }

    // switch turn
    room.turn = opponentId;
    io.to(room.id).emit('turnChanged', { turn: room.turn });
    io.to(room.id).emit('roomUpdate', sanitizeRoom(room));
    if (cb) cb({ ok: true, feedback });
  });

  socket.on('leaveRoom', ({ roomId } = {}, cb) => {
    const room = rooms[roomId];
    if (!room) {
      if (cb) cb({ ok: false, error: 'Room not found' });
      return;
    }
    if (room.players[socket.id]) {
      addLog(room, `${room.players[socket.id].name} left the room.`);
      delete room.players[socket.id];
      room.order = room.order.filter(id => id !== socket.id);
      socket.leave(room.id);
      io.to(room.id).emit('playerLeft', { leftId: socket.id, room: sanitizeRoom(room) });
      // if only one left, notify and cleanup room
      const remaining = Object.keys(room.players);
      if (remaining.length === 1) {
        io.to(remaining[0]).emit('opponentLeft', { room: sanitizeRoom(room) });
        cleanupRoom(room.id);
      } else if (remaining.length === 0) {
        cleanupRoom(room.id);
      } else {
        io.to(room.id).emit('roomUpdate', sanitizeRoom(room));
      }
    }
    if (cb) cb({ ok: true });
  });

  socket.on('disconnect', () => {
    console.log('socket disconnected', socket.id);
    // find room(s) player was in
    for (const rid of Object.keys(rooms)) {
      const room = rooms[rid];
      if (room.players[socket.id]) {
        addLog(room, `${room.players[socket.id].name} disconnected.`);
        delete room.players[socket.id];
        room.order = room.order.filter(id => id !== socket.id);
        io.to(room.id).emit('playerLeft', { leftId: socket.id, room: sanitizeRoom(room) });
        const remaining = Object.keys(room.players);
        if (remaining.length === 1) {
          io.to(remaining[0]).emit('opponentLeft', { room: sanitizeRoom(room) });
          cleanupRoom(room.id);
        } else if (remaining.length === 0) {
          cleanupRoom(room.id);
        } else {
          io.to(room.id).emit('roomUpdate', sanitizeRoom(room));
        }
      }
    }
  });
});

function sanitizeRoom(room) {
  // Do not send secrets to clients. Only send whether ready or not.
  const players = {};
  for (const [id, p] of Object.entries(room.players)) {
    players[id] = {
      id: p.id,
      name: p.name,
      ready: !!p.ready,
      // do not expose secret
    };
  }
  return {
    id: room.id,
    players,
    turn: room.turn,
    started: room.started,
    logs: room.logs.slice(-50)
  };
}

function cleanupRoom(roomId) {
  const room = rooms[roomId];
  if (!room) return;
  // disconnect sockets from room (they'll still be connected to server)
  for (const pid of Object.keys(room.players)) {
    try {
      const s = io.sockets.sockets.get(pid);
      if (s) s.leave(roomId);
    } catch (e) {}
  }
  delete rooms[roomId];
  console.log('room cleaned', roomId);
}

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
