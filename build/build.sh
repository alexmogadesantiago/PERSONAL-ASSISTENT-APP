#!/bin/sh
# Genera los artefactos distribuibles (Linux/macOS). Ver build.ps1 para Windows.
#   ./build/build.sh [target ...]
#   targets: windows-x64 windows-arm64 linux-x64 linux-arm64 raspberrypi-arm64
set -eu
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(tr -d ' \n' < "$REPO_ROOT/VERSION")"
DIST="$REPO_ROOT/dist"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

TARGETS="${*:-windows-x64 windows-arm64 linux-x64 linux-arm64 raspberrypi-arm64}"
mkdir -p "$DIST"
echo "==> Personal Assistant build v$VERSION"

sha() { command -v sha256sum >/dev/null 2>&1 && sha256sum "$1" | cut -d' ' -f1 || shasum -a 256 "$1" | cut -d' ' -f1; }
MANIFEST=""

for t in $TARGETS; do
  case "$t" in
    windows-*) os=windows; arch="${t#windows-}" ;;
    linux-*) os=linux; arch="${t#linux-}" ;;
    raspberrypi-*) os=linux; arch="${t#raspberrypi-}" ;;
    *) echo "target desconocido: $t" >&2; exit 64 ;;
  esac
  pkg="automation-platform-$VERSION-$t"
  echo "  · $t"
  mkdir -p "$STAGE/$pkg"
  ( cd "$REPO_ROOT" && tar -c \
      --exclude='./.git' --exclude='./.env' --exclude='./dist' \
      --exclude='./node_modules' --exclude='./output/*/*.md' \
      --exclude='./config/user_profile.json' . ) | ( cd "$STAGE/$pkg" && tar -x )
  printf '{"version":"%s","target":"%s","os":"%s","arch":"%s","builtAt":"%s"}\n' \
    "$VERSION" "$t" "$os" "$arch" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$STAGE/$pkg/release.json"

  if [ "$os" = "windows" ]; then out="$DIST/$pkg.zip"; ( cd "$STAGE" && zip -qr "$out" "$pkg" )
  else out="$DIST/$pkg.tar.gz"; ( cd "$STAGE" && tar -czf "$out" "$pkg" ); fi
  h="$(sha "$out")"
  printf '%s  %s\n' "$h" "$(basename "$out")" > "$out.sha256"
  MANIFEST="$MANIFEST{\"file\":\"$(basename "$out")\",\"target\":\"$t\",\"os\":\"$os\",\"arch\":\"$arch\",\"sha256\":\"$h\"},"
  rm -rf "$STAGE/$pkg"
done

printf '{"product":"automation-platform","version":"%s","generatedAt":"%s","artifacts":[%s]}\n' \
  "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${MANIFEST%,}" > "$DIST/release-$VERSION.json"

echo; echo "==> Artefactos en $DIST :"; ls -la "$DIST" | grep "$VERSION"
