# Odd Prompt Party

A five-round live multiplayer game for 2–8 players. One Node process serves the interface and Socket.IO game server. No database, login, or AI API.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in separate browser sessions. For separate devices on the same network, use your computer's LAN IP and allow inbound port 3000.

## Public deployment

Create a Node web service from this directory on Railway or Render. Set the start command to `npm start` and use Node 20+. The host provides `PORT`; the app binds to `0.0.0.0`. Use **one instance** because rooms live in process memory. Copy the resulting HTTPS URL and invite another device. A sleeping free instance or restart loses rooms; use an always-on instance during a game.

The host opens a room and shares the invite link. Everyone answers their private prompt, compares answers, votes, and scores. The host advances rounds. After round five, the host can reset the room using Play Again.
