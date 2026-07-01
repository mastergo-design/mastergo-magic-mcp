#!/usr/bin/env bash
# 从 GitHub Releases 自动生成 CHANGELOG.md
# 由 CI（.github/workflows/publish.yml）发版后调用，也可本地手动执行：bash scripts/generate-changelog.sh
# 依赖：gh CLI 已登录且对仓库有读权限
set -euo pipefail

OUT="${1:-CHANGELOG.md}"

{
  echo "# Changelog"
  echo ""
  echo "> 本文件由 GitHub Releases 自动生成，请勿手动编辑；发版后由 CI（.github/workflows/publish.yml）自动更新。"
  echo ""
  # 1. 先拉 release 列表（含发布顺序与 prerelease 标记），list 不返回 body
  # 2. 再逐个 view 取 body，组装成 Keep-a-Changelog 风格
  gh release list --limit 200 --json tagName,publishedAt,isPrerelease --jq \
    '. | sort_by(.publishedAt) | reverse | .[] | "\(.tagName)\t\(.publishedAt)\t\(.isPrerelease)"' \
  | while IFS=$'\t' read -r tag pub pre; do
      [ -z "$tag" ] && continue
      body=$(gh release view "$tag" --json body --jq '.body // "_no notes_"')
      # 正式版用二级标题，预发布用三级标题以示区分
      if [ "$pre" = "true" ]; then hdr="###"; else hdr="##"; fi
      printf '%s %s (%s)\n\n' "$hdr" "$tag" "${pub:0:10}"
      printf '%s\n\n\n' "$body"
    done
} > "$OUT"

echo "✓ CHANGELOG 已生成：${OUT}（$(wc -l < "${OUT}") 行）"
