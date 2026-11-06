# Lấy điểm App Store + Google Play của NSTT, ghi data/ratings.json:
# điểm hiện tại, lịch sử, mốc đã chốt, bậc quà đã mở, Đích Toả Sáng, nhật ký sự kiện (bằng chứng phát quà).
# Chạy được trên Windows PowerShell 5.1 và PowerShell 7 (GitHub Actions).
# Chạy: powershell -ExecutionPolicy Bypass -File scripts\fetch-ratings.ps1
#
# Rule (cấu hình trong config.json):
# - Mốc được chốt khi điểm HIỂN THỊ (làm tròn 1 chữ số) >= mốc trong rule.confirmRuns lần cập nhật liên tiếp,
#   chỉ tính các lần cập nhật nằm trong thời gian chiến dịch. Lần lấy điểm bị lỗi không tính và không làm đứt chuỗi.
# - Đã chốt thì không thu hồi.
# - Mỗi mốc chốt mở bậc quà kế tiếp chưa mở (tối đa số bậc trong config.tiers).
#   Nhiều mốc chốt cùng lúc: iOS trước Android, trong từng OS mốc thấp trước.
# - Đích Toả Sáng: đạt khi cả hai OS đã chốt mốc finish.
#
# Tham số -FakeIos / -FakeAndroid / -Now chỉ dùng để kiểm thử (bỏ qua việc gọi store).
param(
    [string]$Root = (Split-Path $PSScriptRoot -Parent),
    [int]$HistoryMax = 3000,
    [double]$FakeIos = -1,
    [double]$FakeAndroid = -1,
    [string]$Now = ''
)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$cfg = Get-Content (Join-Path $Root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$outPath = Join-Path $Root 'data/ratings.json'
$nowDto = if ($Now) { [DateTimeOffset]::Parse($Now, $inv) } else { [DateTimeOffset]::UtcNow }
$now = $nowDto.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ', $inv)

function Round1([double]$x) { [math]::Round($x, 1, [MidpointRounding]::AwayFromZero) }
function ToDouble([string]$s) { [double]::Parse(($s -replace ',', '.'), $inv) }
function Key1($x) { ([double]$x).ToString('0.0', $inv) }
# PowerShell 7 tự đổi chuỗi ngày ISO trong JSON thành DateTime: đưa về lại chuỗi ISO UTC
function Iso($v) { if ($v -is [datetime]) { $v.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ', $inv) } elseif ($v -is [DateTimeOffset]) { $v.UtcDateTime.ToString('yyyy-MM-ddTHH:mm:ssZ', $inv) } elseif ($null -eq $v) { $null } else { [string]$v } }
function ToMap($o) { $m = [ordered]@{}; if ($o) { foreach ($p in $o.PSObject.Properties) { $m[$p.Name] = $p.Value } }; $m }
function ToList($o) { $l = New-Object System.Collections.ArrayList; if ($o) { foreach ($e in @($o)) { [void]$l.Add($e) } }; , $l }

# Đọc dữ liệu cũ (nếu có) để giữ lịch sử và mốc đã chốt
$old = $null
if (Test-Path $outPath) { try { $old = Get-Content $outPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $old = $null } }

function Get-Ios {
    $c = $cfg.stores.ios
    $r = Invoke-RestMethod "https://itunes.apple.com/lookup?id=$($c.appId)&country=$($c.country)&t=$([DateTime]::UtcNow.Ticks)" -TimeoutSec 30
    $a = $r.results[0]
    if (-not $a) { throw 'App Store lookup trả về rỗng' }
    $score = [double]$a.averageUserRating
    [ordered]@{
        score = [math]::Round($score, 4); display = (Round1 $score); count = [int]$a.userRatingCount
        exact = $true; fetchedAt = $now; error = $null
    }
}

function Get-Android {
    $c = $cfg.stores.android
    $resp = Invoke-WebRequest "https://play.google.com/store/apps/details?id=$($c.package)&hl=vi&gl=vn" -UseBasicParsing -TimeoutSec 60 `
        -Headers @{ 'Accept-Language' = 'vi-VN,vi;q=0.9' }
    $h = $resp.Content
    $m = [regex]::Match($h, 'Được xếp hạng (\d[,\.]\d) sao/5 sao')
    if (-not $m.Success) { throw 'Không tìm thấy điểm trên trang Google Play (có thể Google đã đổi giao diện)' }
    $display = ToDouble $m.Groups[1].Value
    $hist = [ordered]@{}
    # aria-label="127.449 bài đánh giá 5 sao" — không so khớp chữ có dấu để tránh lệch chuẩn Unicode
    foreach ($hm in [regex]::Matches($h, 'aria-label="([\d\.,]+) [^"]{3,30} ([1-5]) sao"')) {
        $s = $hm.Groups[2].Value
        if (-not $hist.Contains($s)) { $hist[$s] = [long]($hm.Groups[1].Value -replace '[\.,]', '') }
    }
    $count = 0; $sum = 0
    foreach ($k in $hist.Keys) { $count += $hist[$k]; $sum += [int]$k * $hist[$k] }
    $mean = if ($count) { $sum / $count } else { $display }
    [ordered]@{
        score = [math]::Round($mean, 4); display = $display; count = $count; histogram = $hist
        exact = $false; fetchedAt = $now; error = $null
    }
}

function Get-Fake([double]$v) {
    [ordered]@{ score = $v; display = (Round1 $v); count = 1000; exact = $true; fetchedAt = $now; error = $null; fake = $true }
}

$stores = [ordered]@{}
foreach ($key in 'ios', 'android') {
    try {
        $fake = if ($key -eq 'ios') { $FakeIos } else { $FakeAndroid }
        $stores[$key] = if ($fake -ge 0) { Get-Fake $fake } elseif ($key -eq 'ios') { Get-Ios } else { Get-Android }
        "{0}: {1} (trung bình {2}, {3} lượt)" -f $key, $stores[$key].display, $stores[$key].score, $stores[$key].count
    } catch {
        Write-Warning "$key lỗi: $($_.Exception.Message)"
        $prev = if ($old -and $old.stores.$key) { $old.stores.$key } else { $null }
        $o = [ordered]@{}
        if ($prev) { foreach ($p in $prev.PSObject.Properties) { $o[$p.Name] = $p.Value } }
        $o['error'] = $_.Exception.Message
        $stores[$key] = $o
    }
}

# ---------- Trạng thái chốt mốc (đọc lại từ file cũ) ----------
$start = [DateTimeOffset]::Parse($cfg.campaign.start, $inv)
$end = [DateTimeOffset]::Parse($cfg.campaign.end, $inv)
$inWindow = ($nowDto -ge $start) -and ($nowDto -le $end)
$needRuns = if ($cfg.rule -and $cfg.rule.confirmRuns) { [int]$cfg.rule.confirmRuns } else { 2 }
$tierTotal = @($cfg.tiers).Count

$confirmed = [ordered]@{}; $streak = [ordered]@{}
foreach ($key in 'ios', 'android') {
    $confirmed[$key] = if ($old -and $old.confirmed) { ToMap $old.confirmed.$key } else { [ordered]@{} }
    $streak[$key] = if ($old -and $old.streak) { ToMap $old.streak.$key } else { [ordered]@{} }
}
$tiers = if ($old -and $old.tiers) { ToList $old.tiers } else { ToList $null }
$finale = if ($old -and $old.finale) { ToMap $old.finale } else { [ordered]@{ reachedAt = $null } }
$log = if ($old -and $old.log) { ToList $old.log } else { ToList $null }
$legacy = if ($old -and $old.legacyAchieved) { $old.legacyAchieved } else { $null }
$newly = New-Object System.Collections.ArrayList   # mốc vừa chốt trong lần chạy này, theo thứ tự mở bậc

# ---------- Chuyển dữ liệu theo rule cũ (achieved = chạm 1 lần) sang cấu trúc mới ----------
if ($old -and $old.achieved -and -not $old.version) {
    $legacy = $old.achieved
    $moved = 0
    foreach ($key in 'ios', 'android') {
        $list = @($cfg.stores.$key.milestones | ForEach-Object { Key1 $_ })
        foreach ($p in $old.achieved.$key.PSObject.Properties) {
            $k = Key1 $p.Name
            $atIso = Iso $p.Value; $at = [DateTimeOffset]::Parse($atIso, $inv)
            if ($list -contains $k -and -not $confirmed[$key].Contains($k) -and $at -ge $start -and $at -le $end) {
                $confirmed[$key][$k] = [ordered]@{ at = $atIso; source = 'legacy'; note = 'Chuyển từ rule cũ (chạm 1 lần)'; openedTier = $null }
                [void]$newly.Add(@{ os = $key; k = $k }); $moved++
            }
        }
    }
    [void]$log.Add([ordered]@{ t = $now; event = 'migrate'; detail = "Chuyển sang rule 12 bậc. Giữ nguyên dữ liệu cũ ở legacyAchieved; $moved mốc nằm trong thời gian chiến dịch được chuyển thành mốc đã chốt." })
    "  >> chuyển dữ liệu rule cũ: $moved mốc"
}

# ---------- Cập nhật chuỗi xác nhận và chốt mốc ----------
foreach ($key in 'ios', 'android') {
    $s = $stores[$key]
    if (-not $inWindow) { $streak[$key] = [ordered]@{}; continue }        # ngoài chiến dịch: không tính
    if ($s.error -or $null -eq $s.display) { continue }                   # lấy điểm lỗi: không tính, không đứt chuỗi
    $disp = [double]$s.display
    foreach ($ms in ($cfg.stores.$key.milestones | Sort-Object { [double]$_ })) {
        $k = Key1 $ms
        if ($confirmed[$key].Contains($k)) { continue }
        if ($disp -ge [double]$ms - 1e-9) {
            $prev = $streak[$key][$k]
            $hits = if ($prev) { [int]$prev.hits + 1 } else { 1 }
            $since = if ($prev) { Iso $prev.since } else { $now }
            if ($hits -ge $needRuns) {
                $confirmed[$key][$k] = [ordered]@{ at = $now; firstSeenAt = $since; display = $disp; runs = $hits; source = 'rule'; openedTier = $null }
                $streak[$key].Remove($k)
                [void]$newly.Add(@{ os = $key; k = $k })
                [void]$log.Add([ordered]@{ t = $now; event = 'confirm'; os = $key; milestone = $k; display = $disp; firstSeenAt = $since; runs = $hits })
                "  >> $key chốt mốc $k"
            } else {
                $streak[$key][$k] = [ordered]@{ hits = $hits; since = $since; lastAt = $now }
            }
        } elseif ($streak[$key].Contains($k)) {
            $streak[$key].Remove($k)                                         # tụt dưới mốc: đứt chuỗi
        }
    }
}

# ---------- Mở bậc quà ----------
foreach ($n in $newly) {
    $entry = $confirmed[$n.os][$n.k]
    if ($tiers.Count -lt $tierTotal) {
        $t = $tiers.Count + 1
        $name = ($cfg.tiers | Where-Object { [int]$_.tier -eq $t } | Select-Object -First 1).name
        [void]$tiers.Add([ordered]@{ tier = $t; openedAt = $now; os = $n.os; milestone = $n.k; confirmedAt = (Iso $entry.at); name = $name })
        $entry['openedTier'] = $t
        [void]$log.Add([ordered]@{ t = $now; event = 'tier'; tier = $t; os = $n.os; milestone = $n.k })
        "  >> mở bậc $t nhờ $($n.os) $($n.k)"
    } else {
        [void]$log.Add([ordered]@{ t = $now; event = 'tier-full'; os = $n.os; milestone = $n.k; detail = 'Đã mở hết các bậc, mốc này không mở thêm bậc' })
    }
}

# ---------- Đích Toả Sáng ----------
# Chỉ chạy khi config còn khai báo finish cho cả hai OS (thang 1 line hiện tại không dùng khối này)
$hasFinish = ($null -ne $cfg.stores.ios.finish) -and ($null -ne $cfg.stores.android.finish)
$iosFin = if ($hasFinish) { Key1 $cfg.stores.ios.finish } else { $null }
$andFin = if ($hasFinish) { Key1 $cfg.stores.android.finish } else { $null }
if ($hasFinish -and -not $finale.reachedAt -and $confirmed.ios.Contains($iosFin) -and $confirmed.android.Contains($andFin)) {
    $finale = [ordered]@{ reachedAt = $now; iosAt = Iso $confirmed.ios[$iosFin].at; androidAt = Iso $confirmed.android[$andFin].at }
    [void]$log.Add([ordered]@{ t = $now; event = 'finale'; detail = "iOS $iosFin và Android $andFin đều đã chốt" })
    "  >> đạt Đích Toả Sáng"
}

# ---------- Lịch sử ----------
$history = ToList $(if ($old) { $old.history } else { $null })
[void]$history.Add([ordered]@{
    t = $now
    ios = $stores.ios.score; iosDisplay = $stores.ios.display; iosCount = $stores.ios.count
    android = $stores.android.score; androidDisplay = $stores.android.display; androidCount = $stores.android.count
})
while ($history.Count -gt $HistoryMax) { $history.RemoveAt(0) }

$out = [ordered]@{
    version = 2
    sample = $false
    updatedAt = $now
    rule = [ordered]@{ confirmRuns = $needRuns; campaignStart = $cfg.campaign.start; campaignEnd = $cfg.campaign.end; inWindow = $inWindow }
    stores = $stores
    confirmed = $confirmed
    streak = $streak
    tiers = @($tiers)
    finale = $finale
    log = @($log)
    legacyAchieved = $legacy
    history = @($history)
}
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
[IO.File]::WriteAllText($outPath, ($out | ConvertTo-Json -Depth 10), $utf8NoBom)
"Đã ghi $outPath ($($history.Count) điểm lịch sử, $($tiers.Count)/$tierTotal bậc đã mở)"
