const { withEntitlementsPlist } = require('expo/config-plugins');

// app.json holds the config; this only adds what shouldn't be committed. The Apple Team ID
// stays out of the repo, as it did in the Xcode project's git-ignored Local.xcconfig: set
// APPLE_TEAM_ID in your shell (or .env.local) for a local build. EAS Build signs with the
// team from its own credentials, so it needs nothing here.
//
// expo-notifications adds the push entitlement whenever it's installed, but class alerts are
// local and never need push — and a free Apple team can't sign an app that has it.
const withoutPush = (config) =>
  withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });

module.exports = ({ config }) => withoutPush({
  ...config,
  ios: {
    ...config.ios,
    ...(process.env.APPLE_TEAM_ID ? { appleTeamId: process.env.APPLE_TEAM_ID } : {}),
  },
  // GitHub Pages serves the web build from a sub-path (/DCU-Timetables/app), set by the Pages
  // workflow. Unset locally, so `expo start --web` stays at the root.
  experiments: {
    ...config.experiments,
    ...(process.env.EXPO_BASE_URL ? { baseUrl: process.env.EXPO_BASE_URL } : {}),
  },
});
