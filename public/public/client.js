// client.js
const socket = io();
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const btnStart = document.getElementById('btnStart');
const btnNext = document.getElementById('btnNext');
const btnStop = document.getElementById('btnStop');
const status = document.getElementById('status');
const chatForm = document.getElementById('chatForm');
const chatInput = document.getElementById('chatInput');
const chatWindow = document.getElementById('chatWindow');

let localStream = null;
let pc = null;
let room = null;
let isCaller = false;

const pcConfig = {
  iceServers: JSON.parse(localStorage.getItem('TURN_SERVERS') || '[]').length ? JSON.parse(localStorage.getItem('TURN_SERVERS')) : [{ urls: 'stun:stun.l.google.com:19302' }]
};

async function startLocal() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({video:{width:640,height:480}, audio:true});
    localVideo.srcObject = localStream;
  } catch (e) {
    alert('Camera/mic access required. ' + e.message);
    console.error(e);
  }
}

function appendChat(message, from='me') {
  const el = document.createElement('div');
  el.textContent = (from === 'me' ? 'You: ' : 'Stranger: ') + message;
  el.style.margin = '6px 0';
  chatWindow.appendChild(el);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

chatForm.addEventListener('submit', e => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !room) return;
  socket.emit('signal', { room, data: { type: 'chat', text } });
  appendChat(text, 'me');
  chatInput.value = '';
});

btnStart.addEventListener('click', async () => {
  btnStart.disabled = true;
  btnNext.disabled = false;
  btnStop.disabled = false;
  status.textContent = 'Starting camera...';
  if (!localStream) await startLocal();
  status.textContent = 'Finding a partner...';
  socket.emit('find-partner');
});

btnNext.addEventListener('click', () => {
  if (!room) {
    socket.emit('find-partner');
    return;
  }
  // tell peer we're leaving, then search again
  socket.emit('leave-room', { room });
  cleanupPeer();
  socket.emit('find-partner');
});

btnStop.addEventListener('click', () => {
  if (room) {
    socket.emit('leave-room', { room });
    cleanupPeer();
  }
  btnStart.disabled = false;
  btnNext.disabled = true;
  btnStop.disabled = true;
  status.textContent = 'Stopped. Press Start to find a partner.';
});

socket.on('status', ({ msg }) => {
  status.textContent = msg;
});

socket.on('matched', async ({ room: r }) => {
  room = r;
  status.textContent = 'Matched — connecting...';
  await createPeerConnection();
  // caller is the socket that created the room name second? we don't rely on that, use simple offer/answer handshake:
  // when matched, first we wait for each side to decide to create an offer if they haven't seen one within a small delay.
  // to simplify: let the client who joined later create the offer. We'll set isCaller flag based on time.
  // Set a short timeout to let both join.
  setTimeout(() => {
    // Create offer if no remote description yet
    if (!pc.signalingState || pc.signalingState === 'stable') {
      makeOffer();
    }
  }, 250);
});

socket.on('signal', async ({ data }) => {
  if (!pc) await createPeerConnection();
  if (!data) return;
  if (data.type === 'offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('signal', { room, data: pc.localDescription });
  } else if (data.type === 'answer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.type === 'ice') {
    try { await pc.addIceCandidate(data.candidate); } catch (e) { console.warn('ice add err', e); }
  } else if (data.type === 'chat') {
    appendChat(data.text, 'them');
  }
});

socket.on('peer-left', () => {
  status.textContent = 'Partner left. Finding a new partner...';
  cleanupPeer();
  socket.emit('find-partner');
});

async function createPeerConnection() {
  if (pc) return;
  pc = new RTCPeerConnection(pcConfig);

  // add local tracks
  if (localStream) {
    for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  } else {
    // attempt to get camera
    await startLocal();
    if (localStream) for (const t of localStream.getTracks()) pc.addTrack(t, localStream);
  }

  pc.ontrack = e => {
    // replace remote video
    remoteVideo.srcObject = e.streams[0];
  };

  pc.onicecandidate = e => {
    if (e.candidate) {
      socket.emit('signal', { room, data: { type: 'ice', candidate: e.candidate } });
    }
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      status.textContent = 'Connected';
      btnNext.disabled = false;
    } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
      status.textContent = 'Disconnected';
    }
  };
}

async function makeOffer() {
  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { room, data: pc.localDescription });
  } catch (e) {
    console.error('offer err', e);
  }
}

function cleanupPeer() {
  if (pc) {
    try { pc.close(); } catch(e){}
    pc = null;
  }
  room = null;
  remoteVideo.srcObject = null;
  status.textContent = 'Looking for partner...';
}
