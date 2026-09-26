import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt } from 'node:crypto';
import { Server } from 'socket.io';
import { prompts } from './prompts.js';

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_, res) => {
  res.json({ ok: true });
});

const http = createServer(app);
const io = new Server(http, {
  maxHttpBufferSize: 10_000
});

const rooms = new Map();

const token = () => randomBytes(24).toString('base64url');

const code = () =>
  randomBytes(4)
    .toString('hex')
    .slice(0, 6)
    .toUpperCase();

const clean = (s, max) =>
  typeof s === 'string'
    ? s.trim().slice(0, max)
    : '';

const players = r => [...r.players.values()];
const active = r => players(r).filter(p => p.connected);
const current = r => players(r).filter(p => p.inRound);

const touch = r => {
  r.updated = Date.now();
};

const error = (ack, message) => {
  if (typeof ack === 'function') {
    ack({
      ok: false,
      error: message
    });
  }
};

const ok = (ack, data = {}) => {
  if (typeof ack === 'function') {
    ack({
      ok: true,
      ...data
    });
  }
};

function publicState(r) {
  return {
    code: r.code,
    host: r.host,
    phase: r.phase,
    round: r.round,
    maxRounds: 5,

    players: players(r).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      connected: p.connected,
      inRound: p.inRound,
      submitted: !!p.answer,
      voted: !!p.vote
    })),

    answers: ['vote', 'score', 'final'].includes(r.phase)
      ? current(r).map(p => ({
          id: p.id,
          name: p.name,
          answer: p.answer
        }))
      : [],

    reveal: ['score', 'final'].includes(r.phase)
      ? r.reveal
      : null
  };
}

function emit(r) {
  touch(r);
  io.to(r.code).emit('state', publicState(r));
}

function assign(r, p, socket) {
  p.socketId = socket.id;
  p.connected = true;

  socket.data = {
    code: r.code,
    id: p.id
  };

  socket.join(r.code);

  socket.emit('identity', {
    code: r.code,
    id: p.id,
    token: p.token
  });

  if (r.phase === 'answer' && p.inRound) {
    socket.emit('prompt', {
      text: r.pair[p.id === r.impostor ? 1 : 0]
    });
  }

  emit(r);
}

function newPlayer(r, name, socket) {
  const p = {
    id: token().slice(0, 12),
    token: token(),
    name,
    score: 0,
    connected: true,
    inRound: false,
    answer: '',
    vote: null,
    socketId: socket.id,
    disconnectedAt: null
  };

  r.players.set(p.id, p);
  assign(r, p, socket);

  return p;
}

function startRound(r) {
  const roster = active(r);

  if (roster.length < 2) {
    return false;
  }

  r.round++;
  r.phase = 'answer';
  r.reveal = null;

  const unused = prompts
    .map((_, i) => i)
    .filter(i => !r.used.includes(i));

  const pick = unused[randomInt(unused.length)];

  r.used.push(pick);
  r.pair = prompts[pick];

  r.impostor =
    roster[randomInt(roster.length)].id;

  for (const p of players(r)) {
    p.inRound = p.connected;
    p.answer = '';
    p.vote = null;

    if (p.inRound) {
      io.to(p.socketId).emit('prompt', {
        text:
          r.pair[
            p.id === r.impostor ? 1 : 0
          ]
      });
    }
  }

  emit(r);

  return true;
}

function finishVoting(r) {
  const voters = current(r).filter(
    p => p.vote
  );

  const caught = voters.some(
    p => p.vote === r.impostor
  );

  // Correct voters earn +1 point
  for (const p of voters) {
    if (p.vote === r.impostor) {
      p.score += 1;
    }
  }

  // Impostor earns +2 only if nobody catches them
  if (!caught) {
    const impostor =
      r.players.get(r.impostor);

    if (impostor) {
      impostor.score += 2;
    }
  }

  r.reveal = {
    impostor: r.impostor,
    commonPrompt: r.pair[0],
    oddPrompt: r.pair[1],
    votes: voters.map(p => ({
      from: p.id,
      to: p.vote
    }))
  };

  r.phase =
    r.round === 5
      ? 'final'
      : 'score';

  emit(r);
}

function progress(r) {
  const roster = current(r);

  if (
    r.phase === 'answer' &&
    roster.every(p => p.answer)
  ) {
    r.phase = 'vote';
    emit(r);
  } else if (
    r.phase === 'vote' &&
    roster.every(p => p.vote)
  ) {
    finishVoting(r);
  }
}

function lookup(socket, ack) {
  const r =
    rooms.get(socket.data.code);

  const p =
    r?.players.get(socket.data.id);

  if (
    !r ||
    !p ||
    p.socketId !== socket.id
  ) {
    error(
      ack,
      'Join a room first.'
    );

    return null;
  }

  return [r, p];
}

io.on('connection', socket => {
  socket.on(
    'create',
    (input, ack) => {
      const name =
        clean(input?.name, 22);

      if (!name) {
        return error(
          ack,
          'Enter a name.'
        );
      }

      if (rooms.size >= 1000) {
        return error(
          ack,
          'Server is full.'
        );
      }

      let c;

      do {
        c = code();
      } while (rooms.has(c));

      const r = {
        code: c,
        players: new Map(),
        host: null,
        phase: 'lobby',
        round: 0,
        used: [],
        updated: Date.now(),
        reveal: null
      };

      rooms.set(c, r);

      const p =
        newPlayer(
          r,
          name,
          socket
        );

      r.host = p.id;

      emit(r);

      ok(ack, {
        code: c
      });
    }
  );

  socket.on(
    'join',
    (input, ack) => {
      const c =
        clean(
          input?.code,
          6
        ).toUpperCase();

      const name =
        clean(
          input?.name,
          22
        );

      const r =
        rooms.get(c);

      if (!r) {
        return error(
          ack,
          'Room not found.'
        );
      }

      if (
        r.phase !== 'lobby'
      ) {
        return error(
          ack,
          'This game is already underway.'
        );
      }

      if (!name) {
        return error(
          ack,
          'Enter a name.'
        );
      }

      if (
        players(r).length >= 8
      ) {
        return error(
          ack,
          'Room is full.'
        );
      }

      if (
        players(r).some(
          p =>
            p.name.toLowerCase() ===
            name.toLowerCase()
        )
      ) {
        return error(
          ack,
          'Choose a different name.'
        );
      }

      newPlayer(
        r,
        name,
        socket
      );

      ok(ack, {
        code: c
      });
    }
  );

  socket.on(
    'resume',
    (input, ack) => {
      const r =
        rooms.get(
          clean(
            input?.code,
            6
          ).toUpperCase()
        );

      const p =
        r &&
        players(r).find(
          p =>
            p.id === input?.id &&
            p.token === input?.token
        );

      if (!p) {
        return error(
          ack,
          'That room has expired.'
        );
      }

      if (
        p.socketId &&
        p.socketId !== socket.id
      ) {
        const old =
          io.sockets.sockets.get(
            p.socketId
          );

        if (old) {
          old.data = {};
          old.disconnect(true);
        }
      }

      assign(
        r,
        p,
        socket
      );

      ok(ack);
    }
  );

  socket.on(
    'start',
    (_, ack) => {
      const v =
        lookup(
          socket,
          ack
        );

      if (!v) {
        return;
      }

      const [r, p] = v;

      if (
        r.host !== p.id ||
        !['lobby', 'score'].includes(
          r.phase
        )
      ) {
        return error(
          ack,
          'Only the host can start a round.'
        );
      }

      if (!startRound(r)) {
        return error(
          ack,
          'At least two connected players are needed.'
        );
      }

      ok(ack);
    }
  );

  socket.on(
    'answer',
    (input, ack) => {
      const v =
        lookup(
          socket,
          ack
        );

      if (!v) {
        return;
      }

      const [r, p] = v;

      const answer =
        clean(
          input?.text,
          140
        );

      if (
        r.phase !== 'answer' ||
        !p.inRound ||
        p.answer ||
        !answer
      ) {
        return error(
          ack,
          'Answer unavailable.'
        );
      }

      p.answer = answer;

      emit(r);
      progress(r);

      ok(ack);
    }
  );

  socket.on(
    'vote',
    (input, ack) => {
      const v =
        lookup(
          socket,
          ack
        );

      if (!v) {
        return;
      }

      const [r, p] = v;

      if (
        r.phase !== 'vote' ||
        !p.inRound ||
        p.vote ||
        input?.id === p.id ||
        !current(r).some(
          x =>
            x.id ===
            input?.id
        )
      ) {
        return error(
          ack,
          'Vote unavailable.'
        );
      }

      p.vote = input.id;

      emit(r);
      progress(r);

      ok(ack);
    }
  );

  socket.on(
    'replay',
    (_, ack) => {
      const v =
        lookup(
          socket,
          ack
        );

      if (!v) {
        return;
      }

      const [r, p] = v;

      if (
        r.host !== p.id ||
        r.phase !== 'final'
      ) {
        return error(
          ack,
          'Only the host can replay after round five.'
        );
      }

      r.phase = 'lobby';
      r.round = 0;
      r.used = [];
      r.reveal = null;

      for (
        const player of players(r)
      ) {
        player.score = 0;
        player.inRound = false;
        player.answer = '';
        player.vote = null;
      }

      emit(r);

      ok(ack);
    }
  );

  socket.on(
    'remove',
    (input, ack) => {
      const v =
        lookup(
          socket,
          ack
        );

      if (!v) {
        return;
      }

      const [r, p] = v;

      const target =
        r.players.get(
          input?.id
        );

      if (
        r.host !== p.id ||
        !target ||
        target.connected ||
        !target.disconnectedAt ||
        Date.now() -
          target.disconnectedAt <
          20_000
      ) {
        return error(
          ack,
          'Player cannot be removed yet.'
        );
      }

      r.players.delete(
        target.id
      );

      if (
        target.inRound &&
        (
          r.phase === 'answer' ||
          r.phase === 'vote'
        )
      ) {
        r.phase = 'lobby';

        r.round =
          Math.max(
            0,
            r.round - 1
          );

        r.reveal = null;

        for (
          const player of players(r)
        ) {
          player.inRound = false;
          player.answer = '';
          player.vote = null;
        }
      }

      emit(r);

      ok(ack);
    }
  );

  socket.on(
    'disconnect',
    () => {
      const r =
        rooms.get(
          socket.data.code
        );

      const p =
        r?.players.get(
          socket.data.id
        );

      if (
        !p ||
        p.socketId !== socket.id
      ) {
        return;
      }

      p.connected = false;
      p.disconnectedAt = Date.now();
      p.socketId = null;

      if (r.host === p.id) {
        r.host =
          players(r).find(
            x => x.connected
          )?.id ?? p.id;
      }

      emit(r);
    }
  );
});

setInterval(() => {
  const now = Date.now();

  for (
    const [c, r] of rooms
  ) {
    const staleForTwoHours =
      now - r.updated >
      2 * 60 * 60_000;

    const emptyForThirtyMinutes =
      !active(r).length &&
      now - r.updated >
        30 * 60_000;

    if (
      staleForTwoHours ||
      emptyForThirtyMinutes
    ) {
      rooms.delete(c);
    }
  }
}, 60_000).unref();

const port =
  Number(
    process.env.PORT
  ) || 3000;

http.listen(
  port,
  '0.0.0.0',
  () => {
    console.log(
      `Listening on ${port}`
    );
  }
);