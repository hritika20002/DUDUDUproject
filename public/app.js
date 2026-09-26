const socket = io();

const app = document.querySelector('#app');
const status = document.querySelector('#status');

let state = null;
let identity = null;
let prompt = null;

const STORAGE_KEY = 'lowkey-sus-session';

const safe = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    c =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[c])
  );

const call = (event, data = {}) =>
  socket.emit(event, data, result => {
    if (!result?.ok) {
      status.textContent =
        result?.error || 'Something went wrong. Try again.';
    } else {
      status.textContent = '';
    }
  });

const me = () =>
  state?.players.find(p => p.id === identity?.id);

const host = () =>
  state?.host === identity?.id;

const sorted = () =>
  [...state.players].sort(
    (a, b) =>
      b.score - a.score ||
      a.name.localeCompare(b.name)
  );

const phaseLabel = phase => {
  const labels = {
    lobby: 'Lobby',
    answer: 'Drop Your Answer',
    vote: 'Who’s Sus?',
    score: 'Round Reveal',
    final: 'Final Reveal'
  };

  return labels[phase] || phase;
};

const scoreboard = () => `
  <div class="card scoreboard-card">
    <div class="section-heading">
      <div>
        <span class="eyebrow">CURRENT RANKING</span>
        <h2>Leaderboard</h2>
      </div>
      <span class="mini-icon">🏆</span>
    </div>

    <div class="score-list">
      ${sorted()
        .map(
          (p, i) => `
            <div class="score ${i === 0 ? 'first-place' : ''}">
              <div class="score-player">
                <span class="rank">${i + 1}</span>
                <span>
                  ${safe(p.name)}
                  ${p.id === state.host ? ' 👑' : ''}
                  ${!p.connected ? ' ○' : ''}
                </span>
              </div>

              <strong>${p.score} ${p.score === 1 ? 'pt' : 'pts'}</strong>
            </div>
          `
        )
        .join('')}
    </div>
  </div>
`;

const roster = () => `
  <div class="players">
    ${state.players
      .map(
        p => `
          <div class="player">
            <div class="player-left">
              <div class="avatar">
                ${safe(p.name.charAt(0).toUpperCase())}
              </div>

              <div>
                <b>
                  ${safe(p.name)}
                  ${p.id === state.host ? ' 👑' : ''}
                </b>

                <small>
                  <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
                  ${p.connected ? 'Online' : 'Disconnected'}

                  ${
                    p.inRound
                      ? state.phase === 'answer'
                        ? p.submitted
                          ? ' · Answer locked'
                          : ' · Thinking...'
                        : state.phase === 'vote'
                          ? p.voted
                            ? ' · Vote locked'
                            : ' · Deciding...'
                          : ''
                      : ''
                  }
                </small>
              </div>
            </div>

            ${
              host() && !p.connected
                ? `
                  <button
                    class="secondary remove small"
                    data-id="${safe(p.id)}"
                  >
                    Remove
                  </button>
                `
                : ''
            }
          </div>
        `
      )
      .join('')}
  </div>
`;

function renderLanding() {
  app.innerHTML = `
    <section class="landing-hero">
      <div class="logo-mark">?</div>

      <span class="eyebrow">MULTIPLAYER SOCIAL DEDUCTION</span>

      <h1>LOWKEY <span>SUS</span></h1>

      <p class="tagline">
        Everyone got the same question.
        <strong>Almost.</strong>
      </p>

      <p class="hero-description">
        Blend in. Read the room. Catch the one person
        answering a slightly different question.
      </p>
    </section>

    <div class="card join-card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">READY?</span>
          <h2>Enter the game</h2>
        </div>
      </div>

      <label>Your name</label>
      <input
        id="name"
        maxlength="22"
        placeholder="What should we call you?"
        autocomplete="nickname"
      >

      <button id="create" class="primary big-button">
        Create a Room
      </button>

      <div class="divider">
        <span>OR JOIN THE CHAOS</span>
      </div>

      <label>Room code</label>
      <input
        id="code"
        maxlength="6"
        placeholder="ABC123"
        autocapitalize="characters"
        class="room-input"
      >

      <button id="join" class="secondary big-button">
        Join Room
      </button>
    </div>

    <div class="card how-card">
      <span class="eyebrow">HOW IT WORKS</span>
      <h2>Simple rules. Questionable answers.</h2>

      <div class="rule-grid">
        <div class="rule-item">
          <span class="rule-number">01</span>
          <div>
            <b>Get your question</b>
            <p>Everyone gets one. One player secretly gets a slightly different version.</p>
          </div>
        </div>

        <div class="rule-item">
          <span class="rule-number">02</span>
          <div>
            <b>Answer without exposing yourself</b>
            <p>Keep it short. Keep it believable.</p>
          </div>
        </div>

        <div class="rule-item">
          <span class="rule-number">03</span>
          <div>
            <b>Read the room</b>
            <p>Compare everyone's answers and decide who feels off.</p>
          </div>
        </div>

        <div class="rule-item">
          <span class="rule-number">04</span>
          <div>
            <b>Vote</b>
            <p>Correct guess = +1 point. Survive as the odd player = +2.</p>
          </div>
        </div>
      </div>

      <div class="game-meta">
        <span>👥 2–8 players</span>
        <span>🔥 Best with 3+</span>
        <span>🎯 5 rounds</span>
      </div>
    </div>
  `;

  document.querySelector('#create').onclick = () =>
    call('create', {
      name: document.querySelector('#name').value
    });

  document.querySelector('#join').onclick = () =>
    call('join', {
      name: document.querySelector('#name').value,
      code: document.querySelector('#code').value
    });
}

function render() {
  if (!state || !identity) {
    renderLanding();
    return;
  }

  let body = `
    <div class="top-game-bar">
      <div class="mini-brand">
        <span class="mini-logo">?</span>
        <strong>LOWKEY SUS</strong>
      </div>

      <span class="phase-pill">
        ${
          state.phase === 'lobby'
            ? 'Lobby'
            : `Round ${state.round}/5 · ${phaseLabel(state.phase)}`
        }
      </span>
    </div>

    <div class="card room-card hero">
      <span class="eyebrow">ROOM CODE</span>

      <div class="code">${safe(state.code)}</div>

      <p class="muted">
        Share this with your friends.
      </p>

      <button class="secondary" id="copy">
        🔗 Copy Invite Link
      </button>
    </div>
  `;

  if (state.phase === 'lobby') {
    body += `
      <div class="card game-stage">
        <div class="section-heading">
          <div>
            <span class="eyebrow">BEFORE YOU START</span>
            <h2>Can you blend in?</h2>
          </div>

          <span class="mini-icon">👀</span>
        </div>

        <div class="compact-rules">
          <div>
            <strong>1.</strong>
            Everyone gets a private question.
          </div>

          <div>
            <strong>2.</strong>
            One player secretly gets a slightly different one.
          </div>

          <div>
            <strong>3.</strong>
            Answer without revealing your question.
          </div>

          <div>
            <strong>4.</strong>
            Read the answers and vote for whoever feels sus.
          </div>

          <div>
            <strong>5.</strong>
            Correct guess = +1. Odd player survives = +2.
          </div>
        </div>

        <div class="game-meta">
          <span>2–8 players</span>
          <span>Best with 3+</span>
          <span>5 rounds</span>
        </div>

        ${
          host()
            ? `
              <button id="start" class="primary big-button pulse">
                Start Game
              </button>
            `
            : `
              <div class="waiting-box">
                <span class="loader"></span>
                Waiting for the host to start...
              </div>
            `
        }
      </div>
    `;
  }

  if (state.phase === 'answer') {
    body += `
      <div class="card game-stage question-card">
        <span class="eyebrow">
          ROUND ${state.round} · YOUR SECRET QUESTION
        </span>

        <div class="prompt">
          ${safe(prompt?.text || 'Loading your question...')}
        </div>

        ${
          me()?.submitted
            ? `
              <div class="locked-state">
                <div class="success-icon">✓</div>
                <h3>Answer locked.</h3>
                <p>Now act normal.</p>
                <p class="muted">
                  Waiting for everyone else...
                </p>
              </div>
            `
            : `
              <form id="answerForm">
                <label for="answer">
                  Your answer
                </label>

                <textarea
                  id="answer"
                  maxlength="140"
                  required
                  placeholder="Say enough to blend in..."
                ></textarea>

                <button class="primary big-button">
                  Lock My Answer
                </button>
              </form>
            `
        }
      </div>
    `;
  }

  if (
    ['vote', 'score', 'final'].includes(state.phase)
  ) {
    body += `
      <div class="card answers-card">
        <span class="eyebrow">THE RECEIPTS</span>
        <h2>Everyone's answers</h2>

        <div class="answers-grid">
          ${state.answers
            .map(
              a => `
                <div class="answer">
                  <span class="answer-name">
                    ${safe(a.name)}
                  </span>

                  <p>"${safe(a.answer)}"</p>
                </div>
              `
            )
            .join('')}
        </div>
      </div>
    `;
  }

  if (state.phase === 'vote') {
    body += `
      <div class="card voting-card">
        <span class="eyebrow">TIME TO JUDGE</span>
        <h2>Who’s lowkey sus?</h2>

        <p class="muted">
          Pick the player you think got the odd question.
        </p>

        ${
          me()?.voted
            ? `
              <div class="locked-state">
                <div class="success-icon">✓</div>
                <h3>Vote locked.</h3>
                <p>
                  Waiting for everyone else to choose...
                </p>
              </div>
            `
            : `
              <div class="vote-grid">
                ${state.players
                  .filter(
                    p =>
                      p.inRound &&
                      p.id !== identity.id
                  )
                  .map(
                    p => `
                      <button
                        class="vote"
                        data-vote="${safe(p.id)}"
                      >
                        <span class="vote-avatar">
                          ${safe(p.name.charAt(0).toUpperCase())}
                        </span>

                        <span>${safe(p.name)}</span>

                        <span class="vote-arrow">→</span>
                      </button>
                    `
                  )
                  .join('')}
              </div>
            `
        }
      </div>
    `;
  }

  if (
    ['score', 'final'].includes(state.phase)
  ) {
    const imp =
      state.players.find(
        p => p.id === state.reveal?.impostor
      );

    const winners =
      sorted().filter(
        p => p.score === sorted()[0].score
      );

    body += `
      <div class="card reveal-card">
        <span class="eyebrow">
          ${
            state.phase === 'final'
              ? 'FINAL RESULTS'
              : `ROUND ${state.round} REVEAL`
          }
        </span>

        <h2>
          ${
            state.phase === 'final'
              ? 'Game over.'
              : 'Caught in 4K.'
          }
        </h2>

        <div class="impostor-reveal">
          <span>The odd player was</span>

          <strong>
            ${safe(imp?.name)}
          </strong>
        </div>

        <div class="prompt-comparison">
          <div>
            <span>EVERYONE ELSE GOT</span>
            <p>
              ${safe(state.reveal?.commonPrompt)}
            </p>
          </div>

          <div class="odd-prompt">
            <span>THE ODD PROMPT</span>
            <p>
              ${safe(state.reveal?.oddPrompt)}
            </p>
          </div>
        </div>

        <div class="vote-recap">
          <span class="eyebrow">WHO VOTED FOR WHO</span>

          ${state.reveal?.votes
            .map(v => {
              const from =
                state.players.find(
                  p => p.id === v.from
                )?.name;

              const to =
                state.players.find(
                  p => p.id === v.to
                )?.name;

              return `
                <div class="vote-row">
                  <span>${safe(from)}</span>
                  <span>→</span>
                  <span>${safe(to)}</span>
                </div>
              `;
            })
            .join('')}
        </div>

        ${
          state.phase === 'final'
            ? `
              <div class="winner-box">
                <span class="trophy">🏆</span>
                <span class="eyebrow">
                  ${winners.length > 1 ? 'WINNERS' : 'WINNER'}
                </span>

                <h3>
                  ${winners
                    .map(p => safe(p.name))
                    .join(', ')}
                </h3>
              </div>

              ${
                host()
                  ? `
                    <button id="replay" class="primary big-button">
                      Run It Back 🔥
                    </button>
                  `
                  : `
                    <div class="waiting-box">
                      Waiting for the host to run it back...
                    </div>
                  `
              }
            `
            : host()
              ? `
                <button id="start" class="primary big-button">
                  Next Round →
                </button>
              `
              : `
                <div class="waiting-box">
                  Waiting for the host to start the next round...
                </div>
              `
        }
      </div>
    `;
  }

  body += `
    <div class="card">
      <div class="section-heading">
        <div>
          <span class="eyebrow">THE CREW</span>
          <h2>Players</h2>
        </div>

        <span class="player-count">
          ${state.players.length}/8
        </span>
      </div>

      ${roster()}
    </div>

    ${scoreboard()}
  `;

  app.innerHTML = body;

  document.querySelector('#copy').onclick =
    async () => {
      await navigator.clipboard.writeText(
        `${location.origin}/?room=${state.code}`
      );

      status.textContent =
        'Invite link copied 🔗';
    };

  document
    .querySelector('#start')
    ?.addEventListener(
      'click',
      () => call('start')
    );

  document
    .querySelector('#replay')
    ?.addEventListener(
      'click',
      () => {
        prompt = null;
        call('replay');
      }
    );

  document
    .querySelector('#answerForm')
    ?.addEventListener(
      'submit',
      e => {
        e.preventDefault();

        call('answer', {
          text:
            document.querySelector('#answer').value
        });
      }
    );

  document
    .querySelectorAll('[data-vote]')
    .forEach(
      b =>
        (b.onclick = () =>
          call('vote', {
            id: b.dataset.vote
          }))
    );

  document
    .querySelectorAll('.remove')
    .forEach(
      b =>
        (b.onclick = () =>
          call('remove', {
            id: b.dataset.id
          }))
    );
}

socket.on('connect', () => {
  status.textContent = '';

  const saved =
    JSON.parse(
      sessionStorage.getItem(STORAGE_KEY) ||
        'null'
    );

  if (saved) {
    socket.emit(
      'resume',
      saved,
      r => {
        if (!r?.ok) {
          identity = null;
          state = null;

          sessionStorage.removeItem(
            STORAGE_KEY
          );

          render();
        }
      }
    );
  }
});

socket.on('disconnect', () => {
  status.textContent =
    'Connection lost. Reconnecting...';
});

socket.on('identity', i => {
  identity = i;

  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(i)
  );

  render();
});

socket.on('prompt', p => {
  prompt = p;
  render();
});

socket.on('state', s => {
  if (
    s.round !== state?.round ||
    s.phase === 'lobby'
  ) {
    prompt =
      s.phase === 'answer'
        ? prompt
        : null;
  }

  state = s;

  render();
});

render();