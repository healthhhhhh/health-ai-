# HealthMate iOS

SwiftUI · iOS 17+ · Swift Concurrency · Observation · XcodeGen.

```
HealthMate/
  App/            entry point, composition root (AppServices), RootView
  Navigation/     TabView: Home · Chat · Health · Plans · Profile
  DesignSystem/   generated tokens, theme (type/tone/gradients), motion, components, mascot
  Features/       Onboarding, Home, Chat, Health, Plan, Documents, Care, Voice, Notifications,
                  Profile, Settings, Preview mode, design gallery
  Services/       session, HealthKit, speech, location, reminders, Preview support
Packages/HealthMateCore/   pure Swift: models, services (Preview + HTTP), safety rules, formatting, presenters
HealthMateTests/           view-model tests
HealthMateUITests/         UI flows on the simulator
```

## Run

Needs macOS, Xcode 16 and XcodeGen (`brew install xcodegen`).

```bash
cd apps/ios
xcodegen generate            # the .xcodeproj is git-ignored; run again after project.yml changes
open HealthMate.xcodeproj    # pick an iOS 17+ simulator, then ⌘R
```

- **Data source:** `HM_DATA_SOURCE` in `project.yml`. `preview` (the default) runs the whole app on an
  on-device sample account with no server. `live` uses the HealthMate API and Apple Health. `sample`
  shows labelled demo data on Home only. The API address is `HM_API_BASE_URL` (default
  `http://localhost:4000/v1`, which the simulator reaches directly).
- **Debug launch arguments** (Product › Scheme › Edit Scheme › Run › Arguments):
  - `-hmDataSource live` (or `preview`, `sample`) overrides the data source.
  - `-hmDemoEmail <email> -hmDemoPassword <password>` signs in automatically; tokens stay in memory.
  - `-hasCompletedOnboarding YES` skips onboarding; `-hmResetOnboarding YES` starts from the welcome screen.
  - `-hmInitialTab home|chat|health|plans|profile` opens a tab.
  - `-hmPreviewState normal|loading|slow|empty|error|offline|permission` forces a Preview state.
- **Against the local API:** start it from the repository root (see the root README), for example
  `npm run demo -w @healthmate/api` for the demo account `demo@healthmate.example` /
  `demo-password-123` with scripted AI, then launch with `-hmDataSource live`.
- The simulator has no camera, and Apple Health has no data until you add some in the Health app.
- Design catalogue: Profile › Settings › Design system.
- Final mascot artwork: add an image set named `Mascot` to `Assets.xcassets`.
- Permissions are declared in `project.yml`: Apple Health (read), camera, microphone, speech
  recognition and location while in use.

## Test

```bash
cd apps/ios/Packages/HealthMateCore && swift test    # macOS or Linux
```

App and UI tests: ⌘U in Xcode, or as CI runs them:

```bash
xcodebuild test -project HealthMate.xcodeproj -scheme HealthMate \
  -destination "id=<simulator udid>" CODE_SIGNING_ALLOWED=NO
```

The signed-in UI test needs the demo API on `localhost:4000` and skips otherwise.
