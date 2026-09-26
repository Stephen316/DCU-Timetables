// The widgets are Swift, compiled into the app binary, but @bacons/apple-targets only puts
// their expo-target.config.js in the fingerprint. Without the rest of the folder, a change
// to a widget would count as JavaScript-only and go out as an over-the-air update, which
// can't carry Swift — so phones would never get it.
/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  extraSources: [{ type: 'dir', filePath: 'targets', reasons: ['widgetTarget'] }],
};
