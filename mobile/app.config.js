// app.json holds the config; this only adds what shouldn't be committed. The Apple Team ID
// stays out of the repo, as it did in the Xcode project's git-ignored Local.xcconfig: set
// APPLE_TEAM_ID in your shell (or .env.local) for a local build. EAS Build signs with the
// team from its own credentials, so it needs nothing here.
module.exports = ({ config }) => ({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
  },
});
