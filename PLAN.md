# Odd Prompt Party — v1 implementation plan

- One Node process serves the responsive web UI and Socket.IO endpoint. Deploy as one web service on Railway or Render with `npm start`, Node 20+, one instance, and a public URL. No database or external APIs.
- Server memory owns rooms, random player IDs and reconnect tokens, membership, prompt pairs, impostor assignment, answers, votes, score, and all phase changes. Room codes are short and private prompts go only to the corresponding socket.
- Each room plays five rounds. Everyone answers a similar prompt, except one player sees the paired prompt. Answers appear together, players discuss, then vote for the odd prompt holder. Correct voters earn 2 points; the impostor earns 2 points if no one identifies them. Ties on the final scoreboard share the win.
- Lobby has clear rules and requires 2–8 players. Host starts each round; server automatically advances when all submissions or votes arrive. After round 5 show the final scoreboard and let the host reset the same room with Play Again.
- A reconnect token in browser session storage restores a player after a brief disconnect. A room disappears when empty for 30 minutes or after 2 hours of inactivity; a process restart erases all rooms. Players cannot join a round underway. Disconnected players block progress briefly; host can remove one after 20 seconds.
- Validate actions on server, cap payloads and room counts, avoid exposing secret data in public state, and test multiple Socket.IO clients through a complete five-round session.
