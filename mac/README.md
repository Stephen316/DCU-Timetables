# DCU Timetable for Mac

A native Mac window around the student app's web build: Dock icon, menu bar, a resizable
window that remembers its place, and class alerts as Mac notifications. There is no second
copy of the app. The window loads the web build that GitHub Pages publishes from `mobile/`,
so every push to `mobile/` reaches the Mac without rebuilding this.

Inside the Mac app the Timetable tab is the weekly calendar only (no day list), with
‹ › and Today in the header, ← → and two-finger swipes to change week, and the Deadlines tab
beside it. The web build knows it's here through the `dcuMac` message handler.

## Build and run

```bash
brew install xcodegen                      # once
cd mac && xcodegen generate                # after adding or removing a file
xcodebuild -project DCUTimetableMac.xcodeproj -scheme DCUTimetableMac -configuration Release -destination 'generic/platform=macOS' -derivedDataPath build/dd build
open "build/dd/Build/Products/Release/DCU Timetable.app"
```

Or open `DCUTimetableMac.xcodeproj` in Xcode and press Run. To keep it, drag the `.app` into
`/Applications`. It's signed to run on this Mac only; another Mac needs `DEVELOPMENT_TEAM`
set and the app notarised.

## Releasing

Push a `mac-v*` tag and `.github/workflows/mac.yml` builds a universal app (Apple silicon
and Intel), zips it and publishes it as a GitHub Release. The site's "Download for Mac" link
(`releases/latest/download/DCU-Timetable-mac.zip`) then serves it. Release only when `mac/`
changes: the timetable inside is the live web build and updates itself.

```bash
git tag mac-v1.0 && git push origin mac-v1.0
```

The app is signed ad hoc, not with a Developer ID, so macOS asks each person to allow it once
(System Settings → Privacy & Security → Open Anyway). Removing that step needs the paid Apple
Developer Program, a Developer ID certificate and a notarisation step in the workflow.

## Pointing it at a dev server

```bash
open "build/dd/Build/Products/Debug/DCU Timetable.app" --args -AppURL http://localhost:8082/
```

`-AppURL` works with any build. To make it stick, so the Dock icon and Xcode's Run open the
dev server too, write it into the app's sandbox container (a plain `defaults write
com.stephenh.dcutimetable.mac` lands outside it, where the app never looks):

```bash
defaults write ~/Library/Containers/com.stephenh.dcutimetable.mac/Data/Library/Preferences/com.stephenh.dcutimetable.mac AppURL http://localhost:8081/
defaults delete ~/Library/Containers/com.stephenh.dcutimetable.mac/Data/Library/Preferences/com.stephenh.dcutimetable.mac AppURL
```

The second command goes back to the live site. The `mobile-preview`
launch configuration serves fixture data on 8082. Debug builds also take
`-DebugSnapshot /path/out.png [-DebugScript '<js>']`, which writes the page and the window's
colours to disk, so the window can be checked without Screen Recording permission.

## Files

- `AppDelegate.swift`: the app's lifecycle, menu actions, and `AppAddress` (where it loads from).
- `WebWindowController.swift`: the window and web view. Links leave for the browser; the
  title bar follows the app's `theme-color`; offline it falls back to WebKit's cached copy.
- `AlertBridge.swift`: answers the page's `MacAlertScheduler` (`mobile/src/data/macShell.ts`),
  schedules the alerts, and opens a clicked one's class.
- `MainMenu.swift`: the menu bar. Copy, paste and select-all only reach a web view through
  Edit menu items.
