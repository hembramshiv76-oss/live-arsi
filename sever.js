// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static
app.use(express.static('public'));

// Simple in-memory queue and rooms
let waiting = []; // sockets waiting to be paired

io.on('connection', socket => {
  console.log('conn:', socket.id);

  socket.on('find-partner', () => {
    // If user is already waiting, ignore
    if (waiting.includes(socket.id)) return;

    if (waiting.length === 0) {
      waiting.push(socket.id);
      socket.emit('status', { msg: 'Waiting for a partner...' });
    } else {
      // pair with first waiter (not self)
      const partnerId = waiting.shift();
      if (partnerId === socket.id) {
        // edge case: shouldn't happen
        waiting.push(socket.id);
        socket.emit('status', { msg: 'Waiting for a partner...' });
        return;
      }
      const room = `room_${partnerId}_${socket.id}`;
      // join both sockets to a room
      socket.join(room);
      io.to(partnerId).socketsJoin(room);
      // notify both
      io.to(room).emit('matched', { room });
      console.log(`Paired ${socket.id} <-> ${partnerId} in ${room}`);
    }
  });

  // Relay signaling messages to peers in the same room (except sender)
  socket.on('signal', ({ room, data }) => {
    socket.to(room).emit('signal', { data });
  });

  // Simple "leave" and "next" behaviour
  socket.on('leave-room', ({ room }) => {
    try { socket.leave(room); } catch(e){}
    socket.to(room).emit('peer-left');
  });

  socket.on('disconnect', reason => {
    // remove from waiting if present
    waiting = waiting.filter(id => id !== socket.id);
    // let others know if they were in a room; socket.io will handle room membership
    console.log('disconnect:', socket.id, reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Live Arsi server running on :${PORT}`));
