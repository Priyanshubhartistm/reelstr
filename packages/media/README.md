# @reelstr/media

The ffmpeg pipeline. Normalizes a scene to 1080x1920 at 30 fps with a fixed loudness, renders hash-stable HLS episodes (optionally AES-128 encrypted), extracts poster frames, and generates draft captions with local speech-to-text.

**Main exports:** `normalizeScene`, `posterFrame`, `renderEpisode`, `captionScenes`, `probe`, `checkNormalized`.

**Test:** `bun test packages/media`.
