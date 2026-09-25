# DCU Timetable for Windows and macOS

The student-facing React/Vite frontend runs inside Tauri 2. It lives alongside, rather
than replacing, the SwiftUI iOS app and the Next.js admin console. The DCU timetable is
public; student accounts and shared features use the **same Supabase project and RLS** as
the iOS app. No admin/service-role key belongs in this frontend.

## Develop

Install [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS
(Rust and Xcode Command Line Tools on macOS; Rust, C++ Build Tools and WebView2 on Windows),
then:

```sh
cd desktop
cp .env.example .env.local
# Fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY with the public iOS project's values.
npm ci
npm run tauri dev
```

`npm run dev` serves the React frontend in a browser for UI development, but the desktop
app uses Tauri's scoped HTTP plugin to read DCU's public API without browser CORS limits.
Use `npm run tauri dev` to verify live timetable requests. `npm run build` type-checks and
builds the frontend. `npm run tauri build -- --bundles app` on macOS, or
`npm run tauri build -- --bundles nsis` on Windows, builds a native package. Unsigned
builds may trigger OS trust prompts; distribution signing/notarization needs separately
managed certificates and is not configured here.

The Supabase Auth project's URL configuration must allow desktop confirmation links to
return to a web page where the student can then sign in. Do not place a service-role key,
admin credentials, or student records in `.env.local` or the app bundle.

The bundled engineering module/rotation files in `ios/DCUTimetable/Resources/` are
shared with the desktop build, so changes to the iOS fixtures also affect desktop.
