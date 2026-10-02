import type { CapacitorConfig } from "@capacitor/cli";

// The app is the web build (../web/dist) in a native shell: one codebase, same UI, same tests.
const config: CapacitorConfig = {
  appId: "tech.ansht.reelstr",
  appName: "Reelstr",
  webDir: "../web/dist",
  backgroundColor: "#f4efe3",
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: "#f4efe3" },
    StatusBar: { style: "DARK", backgroundColor: "#f4efe3" },
  },
};

export default config;
