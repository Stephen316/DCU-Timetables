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
xcodebuild -project DCUTimetableMac.xcodeproj -scheme DCUTimetableMac -configuration Release -derivedDataPath build/dd build
open "build/dd/Build/Products/Release/DCU Timetable.app"
```

Or open `DCUTimetableMac.xcodeproj` in Xcode and press Run. To keep it, drag the `.app` into
`/Applications`. It's signed to run on this Mac only; another Mac needs `DEVELOPMENT_TEAM`
set and the app notarised.

## Pointing it at a dev server

```bash
open "build/dd/Build/Products/Debug/DCU Timetable.app" --args -AppURL http://localhost:8082/
```

`-AppURL` works with any build (`defaults write com.stephenh.dcutimetable.mac AppURL …`
makes it stick; `defaults delete …` goes back to the live site). The `mobile-preview`
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
