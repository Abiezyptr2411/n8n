# ============================================================
#  test-flow.ps1 — Script test lengkap Midtrans + n8n
#  Jalankan: .\test-flow.ps1
# ============================================================

$BASE = "http://localhost:3000"

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  MIDTRANS + n8n — TEST FLOW" -ForegroundColor Magenta
Write-Host "================================================" -ForegroundColor Magenta

# ── STEP 1: Buat Transaksi ─────────────────────────────────
Write-Host ""
Write-Host "[1] Membuat transaksi baru..." -ForegroundColor Cyan
$body1 = @{
  orderId       = "ORDER-$(Get-Date -Format 'yyyyMMddHHmmss')"
  amount        = 150000
  customerEmail = "syahdillaabiezy@gmail.com"
  customerName  = "Syahdilla"
} | ConvertTo-Json

$tx = Invoke-RestMethod -Method POST -Uri "$BASE/create-transaction" `
  -ContentType "application/json" -Body $body1

Write-Host "✅ Transaksi dibuat!" -ForegroundColor Green
Write-Host "   Token     : $($tx.token)"
Write-Host "   Pay URL   : $($tx.redirect_url)"

$orderId = ($body1 | ConvertFrom-Json).orderId

# ── STEP 2: Simulasi Notifikasi Settlement ─────────────────
Write-Host ""
Write-Host "[2] Simulasi notifikasi SETTLEMENT dari Midtrans..." -ForegroundColor Cyan
$body2 = @{
  order_id           = $orderId
  transaction_status = "settlement"
  gross_amount       = 150000
  payment_type       = "bank_transfer"
  customer_details   = @{ email = "syahdillaabiezy@gmail.com"; first_name = "Syahdilla" }
} | ConvertTo-Json -Depth 3

$notif = Invoke-RestMethod -Method POST -Uri "$BASE/midtrans-notification" `
  -ContentType "application/json" -Body $body2

Write-Host "✅ Notifikasi diterima & dikirim ke n8n!" -ForegroundColor Green
Write-Host "   Status: $($notif.status)"

# ── STEP 3: Cek data di dashboard ─────────────────────────
Write-Host ""
Write-Host "[3] Data transaksi di dashboard..." -ForegroundColor Cyan
$data = Invoke-RestMethod -Uri "$BASE/transactions"
Write-Host "   Total transaksi: $($data.total)" -ForegroundColor Yellow
$data.data | ForEach-Object {
  Write-Host "   ─ $($_.order_id) | $($_.status.ToUpper()) | Rp $($_.amount) | $($_.customer_email)"
}

# ── STEP 4: Manual Sync ke n8n ────────────────────────────
Write-Host ""
Write-Host "[4] Manual SYNC semua transaksi ke n8n..." -ForegroundColor Cyan
$sync = Invoke-RestMethod -Method POST -Uri "$BASE/sync-n8n"
Write-Host "✅ Sync selesai! $($sync.synced) transaksi dikirim ke n8n" -ForegroundColor Green

Write-Host ""
Write-Host "================================================" -ForegroundColor Magenta
Write-Host "  Buka dashboard: http://localhost:3000" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Magenta
Write-Host ""
