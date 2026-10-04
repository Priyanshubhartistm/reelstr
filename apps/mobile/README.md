# Reelstr Android and iOS shell

The web app ([`apps/web`](../web)) wrapped in [Capacitor](https://capacitorjs.com), so the phone app and the website are one codebase. `android/` and `ios/` are the generated native projects.

**Install the app:** download the APK from the [latest release](https://github.com/Priyanshubhartistm/reelstr/releases/latest).

```sh
cd apps/mobile
bun run sync       # build the web app against the testnet backend, then cap sync
bun run android    # open the project in Android Studio
bun run apk        # debug APK in android/app/build/outputs/apk/debug/
```

Point it at your own backend with `B=https://your-host/reelstr bun run sync`. To build without Android Studio, use the container in [`infra/android`](../../infra/android) (Docker only). iOS: open `ios/App` in Xcode on a Mac.

The app adds safe-area padding for the status bar and notch, a bottom tab bar on narrow screens, and Android back-button handling (`apps/web/src/main.tsx`).
