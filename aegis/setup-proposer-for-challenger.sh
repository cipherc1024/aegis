#!/usr/bin/env bash
# Aegis proposer 一键接入 challenger（第一台机器，Linux / macOS）
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未找到 node。请先安装 Node.js LTS（>=20）： https://nodejs.org/"
  exit 1
fi
node scripts/setup-proposer-for-challenger.mjs --interactive "$@"
