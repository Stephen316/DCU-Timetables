// The home-screen widgets, still written in SwiftUI. `@bacons/apple-targets` links this folder
// into the Xcode project at prebuild, so everything in it is part of the extension target.
//
// The bundle id and App Group are the ones the Swift app shipped with, so App Store Connect
// sees the same extension and the widgets keep reading from the same shared container.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'DCUTimetableWidgets',
  displayName: 'DCU Timetable',
  // Appended to the app's: com.stephenh.dcutimetable.widgets
  bundleIdentifier: '.widgets',
  deploymentTarget: '17.0',
  frameworks: ['SwiftUI', 'WidgetKit'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
});
