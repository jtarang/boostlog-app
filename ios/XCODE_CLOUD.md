# boostLog on Xcode Cloud → TestFlight

Xcode Cloud builds the Capacitor iOS app (`app.boostlog`) straight from git and
distributes to TestFlight. It **manages signing for you** (no certs / API key),
but it does a clean clone and only builds the Xcode project — so a build hook
runs our JS toolchain first.

## The build hook (already in the repo)
`ios/App/ci_scripts/ci_post_clone.sh` runs after Xcode Cloud clones the repo:
installs Node, `npm ci`, then `npx cap sync ios` — copying the web layer +
Capacitor plugins into the native project. Without it, Xcode Cloud would ship a
stale/empty shell. (Xcode Cloud auto-detects `ci_scripts/` next to the Xcode
project; the file must stay executable.)

## One-time setup (in Xcode / App Store Connect)
1. **Share the scheme**: Product → Scheme → Manage Schemes… → check **Shared**
   on `App`. Xcode Cloud builds a shared scheme.
2. **Create the App Store Connect app** for bundle `app.boostlog` (if not done).
3. **Create the workflow**: Xcode → Product → **Xcode Cloud → Create Workflow**
   (or the Cloud tab in the Report navigator). Grant access to the GitHub repo.
   - **Start condition**: Branch Changes → `main`.
   - **Environment**: latest Xcode.
   - **Action**: **Archive** (Release, iOS).
   - **Post-action**: **TestFlight (Internal Testing)** → pick a tester group.
4. **Signing**: accept Xcode Cloud's cloud-managed signing when prompted — it
   provisions automatically.

## Build numbers
Enable Xcode Cloud's build-number management (workflow setting) or it uses the
CI build number, so each archive is unique without editing the project.

## Notes
- fastlane (`ios/App/fastlane`) is now optional — Xcode Cloud supersedes it for
  CI. Keep it if you want ad-hoc local uploads; otherwise that branch can be
  dropped.
- Public App Store release still faces the Guideline 4.2 (webview) review risk;
  TestFlight is unaffected.
