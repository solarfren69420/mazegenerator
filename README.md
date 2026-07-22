# Maze Lab Deluxe — Web Edition

A browser-native maze generator, player, solver, and image exporter. No server, build step, framework, or Python installation is required.

## Run locally

Start any static server in this folder:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Publish with GitHub Pages

1. Create a new GitHub repository.
2. Upload every file and folder from this project, keeping `vendor/` intact.
3. Open the repository's **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select the `main` branch and `/ (root)`, then save.

GitHub will show the public URL after deployment. It usually has the form:

`https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`

## Features

- Eight generation algorithms with labeled difficulty
- Deterministic text or numeric seeds
- Adjustable size, complexity, and braiding
- Keyboard and touch player controls
- Movement trail and shortest-solution overlay
- Static, rainbow, reverse-rainbow, and animated palettes
- PNG, JPEG, BMP, still GIF, and animated GIF downloads
- Responsive desktop and phone layout

All generation and rendering happens locally in the visitor's browser.
