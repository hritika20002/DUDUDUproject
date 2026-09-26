import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';

const PORT = 34187;
const url = `http://127.0.0.1:${PORT}`;

const server = spawn(
  process.execPath,
  ['server.js'],
  {
    cwd: new URL('.', import.meta.url).pathname,
    env: {
      ...process.env,
      PORT: String(PORT)
    }
  }
);

async function ready() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${url}/health`);
      if (r.ok) return;
    } catch {}

    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error('Server did not start');
}

const connect = () =>
  new Promise(resolve => {
    const s = io(url, {
      transports: ['websocket']
    });

    s.on('connect', () => resolve(s));
  });

const ask = (s, event, data = {}) =>
  new Promise(resolve =>
    s.emit(event, data, resolve)
  );

const next = (s, event) =>
  new Promise(resolve =>
    s.once(event, resolve)
  );

const waitPhase = (s, phase, round) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off('state', check);

      reject(
        new Error(
          `Timed out waiting for ${phase} ${round}`
        )
      );
    }, 3000);

    function check(st) {
      if (
        st.phase === phase &&
        st.round === round
      ) {
        clearTimeout(timer);
        s.off('state', check);
        resolve(st);
      }
    }

    s.on('state', check);
  });

test(
  'three devices complete five rounds and replay with private prompts',
  async () => {
    await ready();

    const a = await connect();
    const b = await connect();
    const c = await connect();

    try {
      const ai = next(a, 'identity');

      const created = await ask(
        a,
        'create',
        { name: 'Alex' }
      );

      assert(created.ok);

      const A = await ai;

      const bi = next(b, 'identity');

      assert(
        (
          await ask(
            b,
            'join',
            {
              code: A.code,
              name: 'Blair'
            }
          )
        ).ok
      );

      const B = await bi;

      const ci = next(c, 'identity');

      assert(
        (
          await ask(
            c,
            'join',
            {
              code: A.code,
              name: 'Casey'
            }
          )
        ).ok
      );

      const C = await ci;

      // Non-host cannot start
      assert.equal(
        (await ask(c, 'start')).ok,
        false
      );

      for (
        let round = 1;
        round <= 5;
        round++
      ) {
        const pa = next(a, 'prompt');
        const pb = next(b, 'prompt');
        const pc = next(c, 'prompt');

        assert(
          (await ask(a, 'start')).ok
        );

        const ps =
          await Promise.all([
            pa,
            pb,
            pc
          ]);

        // Exactly two prompt versions
        assert.equal(
          new Set(
            ps.map(x => x.text)
          ).size,
          2
        );

        // Cannot vote before answer phase ends
        assert.equal(
          (
            await ask(
              a,
              'vote',
              { id: B.id }
            )
          ).ok,
          false
        );

        // Everyone answers
        for (
          const [s, text] of [
            [a, 'A'],
            [b, 'B'],
            [c, 'C']
          ]
        ) {
          assert(
            (
              await ask(
                s,
                'answer',
                { text }
              )
            ).ok
          );
        }

        // Duplicate answer blocked
        assert.equal(
          (
            await ask(
              a,
              'answer',
              {
                text: 'duplicate'
              }
            )
          ).ok,
          false
        );

        // Submit votes
        assert(
          (
            await ask(
              a,
              'vote',
              { id: B.id }
            )
          ).ok
        );

        assert(
          (
            await ask(
              b,
              'vote',
              { id: C.id }
            )
          ).ok
        );

        const result =
          waitPhase(
            a,
            round === 5
              ? 'final'
              : 'score',
            round
          );

        assert(
          (
            await ask(
              c,
              'vote',
              { id: A.id }
            )
          ).ok
        );

        const st =
          await result;

        assert.equal(
          st.round,
          round
        );

        assert.equal(
          st.phase,
          round === 5
            ? 'final'
            : 'score'
        );

        assert(
          st.reveal.impostor
        );

        assert.equal(
          st.answers.length,
          3
        );

        // Every score must remain a valid non-negative integer
        for (
          const player of st.players
        ) {
          assert(
            Number.isInteger(
              player.score
            )
          );

          assert(
            player.score >= 0
          );
        }
      }

      // Only host can replay
      assert.equal(
        (await ask(b, 'replay')).ok,
        false
      );

      const replayState =
        next(a, 'state');

      assert(
        (await ask(a, 'replay')).ok
      );

      const st =
        await replayState;

      assert.equal(
        st.phase,
        'lobby'
      );

      assert(
        st.players.every(
          p => p.score === 0
        )
      );

      // Reconnect test
      b.disconnect();

      const resumed =
        await connect();

      const id =
        next(
          resumed,
          'identity'
        );

      assert(
        (
          await ask(
            resumed,
            'resume',
            B
          )
        ).ok
      );

      assert.equal(
        (await id).id,
        B.id
      );

      resumed.disconnect();
    } finally {
      a.disconnect();
      b.disconnect();
      c.disconnect();
    }
  }
);

test.after(() => {
  server.kill();
});