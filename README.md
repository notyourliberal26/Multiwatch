# Multiwatch

A dark, free-form desktop app for watching many YouTube, Twitch and Kick streams at once. Built for election-night coverage.

- Drag streams in from the library, paste a link, or press Ctrl+V anywhere in the app
- Move and resize each stream freely; windows snap to edges and each other (hold Alt to skip snapping, Shift to keep the shape)
- Per-stream mute, volume and solo (🎧); new streams start muted
- Grid and Spotlight arrangements, plus named saved layouts
- YouTube channel links find the current live stream and keep checking if it isn't live yet
- Works with live streams, regular YouTube videos (start times kept), and Twitch VODs and clips

## Run it

Needs [Node.js](https://nodejs.org/) on Windows.

```bash
npm install
npm start
```

Your streams, layouts and sign-ins are saved in `%APPDATA%\Multiwatch`.

## Rebuild the icon

The icon is drawn in `assets/icon.svg`. After editing it:

```bash
npx electron assets/build-icon.js
```
