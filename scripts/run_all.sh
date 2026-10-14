#!/bin/bash
# 一键运行全部回归脚本
# 用法：bash scripts/run_all.sh
cd "$(dirname "$0")/.." || exit 1

PY=${PYTHON:-python3}
if command -v /Users/jackyzhao/.workbuddy/binaries/python/versions/3.13.12/bin/python3 >/dev/null 2>&1; then
  PY=/Users/jackyzhao/.workbuddy/binaries/python/versions/3.13.12/bin/python3
fi
"$PY" scripts/check_wxml.py || exit 1
echo ""

# FSRS 预打包产物完整性：产物由 scripts/build_fsrs_vendor.cjs 生成，禁止手改
# （--check 不需要 ts-fsrs 源码，未装 devDependencies 也能跑）
node scripts/build_fsrs_vendor.cjs --check || exit 1
echo ""

# 备考容量模拟器自检：锁住「评分种子必须随累计复习次数推进」这一不变量。
# 早期版本用「当日第几次作答」当种子（每次到期复习都会重置为 1），等价于
# 每张卡评级终身固定，10% 的卡永远评「重来」天天到期，负荷被虚增近一个数量级。
node scripts/sim_exam_capacity.cjs --check
if [ $? -ne 0 ]; then echo "🔴 容量模拟器自检失败"; exit 1; fi
echo ""

SCRIPTS=(
  regress_card_shards
  regress_sample_cards
  regress_builtin_switch
  regress_builtin_store
  regress_sm2_schedule
  regress_fsrs_shadow
  regress_daily_quota
  regress_importer_csv
  regress_import_dedup
  regress_importer_imagemarker
  regress_deck_name
  regress_json_backup
  regress_rich_links
  regress_rename_deck
  regress_export_anki_txt
  regress_confirm_import_guard
  regress_publish_policy
)

total_pass=0
total_fail=0
failed_list=""

for s in "${SCRIPTS[@]}"; do
  if [ ! -f "scripts/$s.cjs" ]; then
    echo "跳过（不存在）：$s"
    continue
  fi
  out=$(node "scripts/$s.cjs" 2>&1)
  line=$(echo "$out" | grep -E '通过' | tail -1)
  if [ -z "$line" ]; then
    line=$(echo "$out" | tail -1)
  fi
  printf "%-32s %s\n" "$s" "$line"
  if echo "$out" | grep -q "FAIL"; then
    failed_list="$failed_list $s"
    echo "$out" | grep "FAIL" | sed 's/^/    /'
  fi
  p=$(echo "$line" | grep -oE '通过 [0-9]+' | grep -oE '[0-9]+')
  f=$(echo "$line" | grep -oE '失败 [0-9]+' | grep -oE '[0-9]+')
  total_pass=$((total_pass + ${p:-0}))
  total_fail=$((total_fail + ${f:-0}))
done

echo ""
echo "════════════════════════════════════════"
echo "合计：通过 $total_pass / 失败 $total_fail"
if [ -n "$failed_list" ]; then
  echo "失败脚本：$failed_list"
  exit 1
fi
echo "全部通过 ✅"
