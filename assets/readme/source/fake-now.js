// Preloaded with `node -r` by build.js: pins Date.now() so a render is reproducible
// (the launch-root shimmer, reset countdowns, and line-4 rotation all read the clock).
const t = Number(process.env.FAKE_NOW_MS);
if (t) Date.now = () => t;
