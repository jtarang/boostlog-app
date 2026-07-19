#!/bin/sh
# Xcode Cloud runs this right after cloning, before resolving/building the
# Xcode project. Xcode Cloud won't run our JS toolchain, so we install Node,
# fetch deps, and run `cap sync` here — otherwise the native app builds without
# the current web layer + Capacitor plugins.
set -e

# Repo checkout root (package.json / capacitor.config.json live here, not in ios/App).
cd "$CI_PRIMARY_REPOSITORY_PATH"

# Xcode Cloud images don't guarantee Node — install it via the bundled Homebrew.
if ! command -v node >/dev/null 2>&1; then
  brew install node
fi

npm ci
npx cap sync ios
