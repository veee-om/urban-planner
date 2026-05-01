# Urban Planner by Veee

Real-time multiplayer urban planning game built with Node.js, Express, Socket.IO, and vanilla HTML/CSS/JS.

Players create or join a room, wait in a shared ready room, then place houses, schools, hospitals, and industries on a live Leaflet map of India. Scores are calculated from distance-based relationships between markers.

## Features

- Real-time multiplayer rooms
- Separate lobby, waiting room, and gameplay screens
- Leaflet map with OpenStreetMap tiles
- Colored map markers for each building type
- Hospital coverage zones and industry pollution zones
- Distance-based scoring logic
- In-memory game state for simple deployment
- Responsive UI for desktop and mobile

## Tech Stack

- Node.js
- Express
- Socket.IO
- Vanilla HTML, CSS, and JavaScript
- Leaflet
- OpenStreetMap tiles

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm start
```

3. Open the game:

```text
http://localhost:3000
```

## How To Test Multiplayer

1. Open the app in two browser tabs or two different browsers.
2. In the first tab, enter a player name and create a room.
3. Copy the room code.
4. In the second tab, enter a different player name and join the room.
5. Start the round from the host account.
6. Select building types from the sidebar and click on the map to place them.
7. Wait for the timer to finish or use all placements.
8. Check the results screen for scores and the winning layout summary.

## Scoring Rules

- House near school: `+15`
- House near hospital: `+20`
- House near industry: `-30`
- Industries too close together: cluster penalty

The game uses geographic distance between placed map markers instead of grid-cell distance.

## Render Deployment

This project is ready for a simple Render web service deployment.

### Recommended Render Settings

- Runtime: `Node`
- Build Command:

```bash
npm install
```

- Start Command:

```bash
npm start
```

### Notes

- No paid APIs are used.
- OpenStreetMap tiles are loaded directly in the client through Leaflet.
- Port binding is handled with `process.env.PORT`.
- All rooms and game rounds are stored in memory, so restarting the service clears active sessions.

## Project Structure

```text
server.js
public/
  index.html
  main.js
  style.css
package.json
README.md
```
