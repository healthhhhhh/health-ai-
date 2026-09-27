# HealthMate iOS

SwiftUI · iOS 17+ · Swift Concurrency · Observation · XcodeGen.

```
HealthMate/
  App/            entry point, composition root (AppServices), RootView
  Navigation/     TabView: Home · Chat · Health · Plans · Profile
  DesignSystem/   generated tokens, theme (type/tone/gradients), motion, components, mascot
  Features/       Onboarding (welcome, sign-in), Home (view + view model), planned tabs, gallery
Packages/HealthMateCore/   pure Swift: models, services (mock + HTTP), formatting, presenters
HealthMateTests/           view-model tests (optimistic update, rollback, celebration)
```

- Generate the project: `xcodegen generate` (the `.xcodeproj` is git-ignored).
- Data source: `HM_DATA_SOURCE` = `mock` (default) or `api` with `HM_API_BASE_URL` in `project.yml`.
- Final mascot artwork: add an image set named `Mascot` to `Assets.xcassets`.
- Design catalogue: run the app → Profile → Design system.
- HealthKit, notifications, camera and microphone entitlements are added in their phases (7–10);
  none are requested yet.
