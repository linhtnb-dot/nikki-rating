# Lấy điểm App Store + Google Play của NSTT, ghi data/ratings.json (điểm hiện tại, lịch sử, thời điểm đạt mốc).
# Chạy được trên Windows PowerShell 5.1 và PowerShell 7 (GitHub Actions).
# Chạy: powershell -ExecutionPolicy Bypass -File scripts\fetch-ratings.ps1
param(
    [string]$Root = (Split-Path $PSScriptRoot -Parent),
    [int]$HistoryMax = 3000
)
$ErrorActionPreference = 'Stop'
$inv = [Globalization.CultureInfo]::InvariantCulture
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
$cfg = Get-Content (Join-Path $Root 'config.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$outPath = Join-Path $Root 'data/ratings.json'
$now = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')

function Round1([double]$x) { [math]::Round($x, 1, [MidpointRounding]::AwayFromZero) }
function ToDouble([string]$s) { [double]::Parse(($s -replace ',', '.'), $inv) }

# Đọc dữ liệu cũ (nếu có) để giữ lịch sử và mốc đã đạt
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

$stores = [ordered]@{}
foreach ($key in 'ios', 'android') {
    try {
        $stores[$key] = if ($key -eq 'ios') { Get-Ios } else { Get-Android }
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

# Mốc đã đạt: tính khi điểm hiển thị chạm mốc lần đầu, giữ nguyên kể cả khi điểm tụt sau đó
$achieved = [ordered]@{}
foreach ($key in 'ios', 'android') {
    $a = [ordered]@{}
    if ($old -and $old.achieved -and $old.achieved.$key) { foreach ($p in $old.achieved.$key.PSObject.Properties) { $a[$p.Name] = $p.Value } }
    $disp = $stores[$key].display
    if ($null -ne $disp -and -not $stores[$key].error) {
        foreach ($ms in $cfg.stores.$key.milestones) {
            $k = ([double]$ms.score).ToString('0.0', $inv)
            if (-not $a.Contains($k) -and [double]$disp -ge [double]$ms.score - 1e-9) { $a[$k] = $now; "  >> $key đạt mốc $k" }
        }
    }
    $achieved[$key] = $a
}

# Lịch sử
$history = New-Object System.Collections.ArrayList
if ($old -and $old.history) { foreach ($e in $old.history) { [void]$history.Add($e) } }
[void]$history.Add([ordered]@{
    t = $now
    ios = $stores.ios.score; iosDisplay = $stores.ios.display; iosCount = $stores.ios.count
    android = $stores.android.score; androidDisplay = $stores.android.display; androidCount = $stores.android.count
})
while ($history.Count -gt $HistoryMax) { $history.RemoveAt(0) }

$out = [ordered]@{
    sample = $false
    updatedAt = $now
    stores = $stores
    achieved = $achieved
    history = @($history)
}
New-Item -ItemType Directory -Force -Path (Split-Path $outPath) | Out-Null
[IO.File]::WriteAllText($outPath, ($out | ConvertTo-Json -Depth 8), $utf8NoBom)
"Đã ghi $outPath ($($history.Count) điểm lịch sử)"
