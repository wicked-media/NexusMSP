param(
  [string]$Source = "frontend/public/brand/nexus-mark.png",
  [string]$Output = "frontend/public/brand/pack"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sourcePath = (Resolve-Path (Join-Path $root $Source)).Path
$outputPath = Join-Path $root $Output
New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

function New-Canvas([int]$width, [int]$height, [System.Drawing.Color]$background) {
  $bitmap = New-Object System.Drawing.Bitmap $width, $height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $graphics.Clear($background)
  $graphics.Dispose()
  return $bitmap
}

function Set-Quality([System.Drawing.Graphics]$graphics) {
  $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
  $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
}

function Draw-FittedMark(
  [System.Drawing.Bitmap]$canvas,
  [System.Drawing.Image]$mark,
  [int]$padding,
  [System.Drawing.Color]$tint = [System.Drawing.Color]::Empty
) {
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  Set-Quality $graphics
  $target = New-Object System.Drawing.Rectangle $padding, $padding, ($canvas.Width - (2 * $padding)), ($canvas.Height - (2 * $padding))

  if ($tint.IsEmpty) {
    $graphics.DrawImage($mark, $target)
  } else {
    $matrix = New-Object System.Drawing.Imaging.ColorMatrix
    $matrix.Matrix00 = 0; $matrix.Matrix01 = 0; $matrix.Matrix02 = 0
    $matrix.Matrix10 = 0; $matrix.Matrix11 = 0; $matrix.Matrix12 = 0
    $matrix.Matrix20 = 0; $matrix.Matrix21 = 0; $matrix.Matrix22 = 0
    $matrix.Matrix30 = 0; $matrix.Matrix31 = 0; $matrix.Matrix32 = 0; $matrix.Matrix33 = 1
    $matrix.Matrix40 = $tint.R / 255.0
    $matrix.Matrix41 = $tint.G / 255.0
    $matrix.Matrix42 = $tint.B / 255.0
    $attributes = New-Object System.Drawing.Imaging.ImageAttributes
    $attributes.SetColorMatrix($matrix)
    $sourceRect = New-Object System.Drawing.Rectangle 0, 0, $mark.Width, $mark.Height
    $graphics.DrawImage($mark, $target, $sourceRect.X, $sourceRect.Y, $sourceRect.Width, $sourceRect.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)
    $attributes.Dispose()
  }
  $graphics.Dispose()
}

function Save-Png([System.Drawing.Bitmap]$bitmap, [string]$name) {
  $path = Join-Path $outputPath $name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bitmap.Dispose()
}

function New-MarkAsset([int]$size, [int]$padding, [System.Drawing.Color]$background, [string]$name, [System.Drawing.Color]$tint = [System.Drawing.Color]::Empty) {
  $canvas = New-Canvas $size $size $background
  Draw-FittedMark $canvas $script:mark $padding $tint
  Save-Png $canvas $name
}

function Add-RoundedRectangle([System.Drawing.Drawing2D.GraphicsPath]$path, [System.Drawing.RectangleF]$rect, [float]$radius) {
  $diameter = 2 * $radius
  $arc = New-Object System.Drawing.RectangleF $rect.X, $rect.Y, $diameter, $diameter
  $path.AddArc($arc, 180, 90)
  $arc.X = $rect.Right - $diameter; $path.AddArc($arc, 270, 90)
  $arc.Y = $rect.Bottom - $diameter; $path.AddArc($arc, 0, 90)
  $arc.X = $rect.Left; $path.AddArc($arc, 90, 90)
  $path.CloseFigure()
}

$script:mark = [System.Drawing.Image]::FromFile($sourcePath)
$transparent = [System.Drawing.Color]::Transparent
$midnight = [System.Drawing.ColorTranslator]::FromHtml("#071018")
$ink = [System.Drawing.ColorTranslator]::FromHtml("#08111f")
$paper = [System.Drawing.ColorTranslator]::FromHtml("#f7fafc")
$white = [System.Drawing.Color]::White

# Transparent masters and monochrome variants.
New-MarkAsset 4096 384 $transparent "nexus-mark-master-4096.png"
New-MarkAsset 2048 192 $transparent "nexus-mark-full-colour-2048.png"
New-MarkAsset 2048 192 $transparent "nexus-mark-white-2048.png" $white
New-MarkAsset 2048 192 $transparent "nexus-mark-black-2048.png" $ink

# Ready-to-use presentation tiles.
New-MarkAsset 2048 280 $midnight "nexus-mark-on-midnight-2048.png"
New-MarkAsset 2048 280 $paper "nexus-mark-on-white-2048.png"

# App icon with a premium rounded Nexus tile.
$app = New-Canvas 1024 1024 $transparent
$appGraphics = [System.Drawing.Graphics]::FromImage($app)
Set-Quality $appGraphics
$appPath = New-Object System.Drawing.Drawing2D.GraphicsPath
Add-RoundedRectangle $appPath (New-Object System.Drawing.RectangleF 32, 32, 960, 960) 208
$gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
  (New-Object System.Drawing.PointF 64, 64),
  (New-Object System.Drawing.PointF 960, 960),
  ([System.Drawing.ColorTranslator]::FromHtml("#0b1f2b")),
  ([System.Drawing.ColorTranslator]::FromHtml("#05090f"))
)
$appGraphics.FillPath($gradient, $appPath)
$border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(90, 16, 185, 129)), 3
$appGraphics.DrawPath($border, $appPath)
$gradient.Dispose(); $border.Dispose(); $appPath.Dispose(); $appGraphics.Dispose()
Draw-FittedMark $app $script:mark 188
Save-Png $app "nexus-app-icon-1024.png"

# Compact web/app sizes.
foreach ($size in @(512, 256, 128, 64, 48, 32, 16)) {
  New-MarkAsset $size ([Math]::Max(1, [Math]::Round($size * 0.11))) $transparent ("nexus-mark-{0}.png" -f $size)
}

function New-Wordmark([string]$name, [System.Drawing.Color]$textColor, [System.Drawing.Color]$background) {
  $canvas = New-Canvas 2400 600 $background
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  Set-Quality $graphics
  $markRect = New-Object System.Drawing.Rectangle 56, 56, 488, 488
  $graphics.DrawImage($script:mark, $markRect)
  $font = New-Object System.Drawing.Font "Segoe UI", 198, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $brush = New-Object System.Drawing.SolidBrush $textColor
  $graphics.DrawString("NexusMSP", $font, $brush, 558, 158)
  $font.Dispose(); $brush.Dispose(); $graphics.Dispose()
  Save-Png $canvas $name
}

New-Wordmark "nexus-wordmark-for-dark-2400.png" $white $transparent
New-Wordmark "nexus-wordmark-for-light-2400.png" $ink $transparent

# A single visual index for quick review and handoff.
$sheet = New-Canvas 2400 1600 $paper
$sheetGraphics = [System.Drawing.Graphics]::FromImage($sheet)
Set-Quality $sheetGraphics
$titleFont = New-Object System.Drawing.Font "Segoe UI", 88, ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
$bodyFont = New-Object System.Drawing.Font "Segoe UI", 34, ([System.Drawing.FontStyle]::Regular), ([System.Drawing.GraphicsUnit]::Pixel)
$titleBrush = New-Object System.Drawing.SolidBrush $ink
$mutedBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml("#52606d"))
$sheetGraphics.DrawString("NexusMSP Brand System", $titleFont, $titleBrush, 120, 86)
$sheetGraphics.DrawString("Signal Weave - connected operations, secure flow, forward movement", $bodyFont, $mutedBrush, 126, 205)

$darkBrush = New-Object System.Drawing.SolidBrush $midnight
$lightBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
$sheetGraphics.FillRectangle($darkBrush, 120, 330, 1020, 820)
$sheetGraphics.FillRectangle($lightBrush, 1260, 330, 1020, 820)
$sheetGraphics.DrawImage($script:mark, (New-Object System.Drawing.Rectangle 300, 510, 660, 660))
$sheetGraphics.DrawImage($script:mark, (New-Object System.Drawing.Rectangle 1440, 510, 660, 660))
$sheetGraphics.DrawString("MIDNIGHT", $bodyFont, (New-Object System.Drawing.SolidBrush $white), 168, 375)
$sheetGraphics.DrawString("DAYLIGHT", $bodyFont, $mutedBrush, 1308, 375)

$swatches = @(
  @{ Hex = "#10B981"; Name = "Nexus Emerald" },
  @{ Hex = "#06B6D4"; Name = "Signal Cyan" },
  @{ Hex = "#2F7EF8"; Name = "Control Blue" },
  @{ Hex = "#071018"; Name = "Midnight" }
)
$x = 120
foreach ($swatch in $swatches) {
  $color = [System.Drawing.ColorTranslator]::FromHtml($swatch.Hex)
  $swatchBrush = New-Object System.Drawing.SolidBrush $color
  $sheetGraphics.FillRectangle($swatchBrush, $x, 1280, 470, 130)
  $sheetGraphics.DrawString("$($swatch.Name)  $($swatch.Hex)", $bodyFont, $titleBrush, $x, 1430)
  $swatchBrush.Dispose()
  $x += 570
}

$darkBrush.Dispose(); $lightBrush.Dispose(); $titleFont.Dispose(); $bodyFont.Dispose(); $titleBrush.Dispose(); $mutedBrush.Dispose(); $sheetGraphics.Dispose()
Save-Png $sheet "nexus-brand-preview.png"

$script:mark.Dispose()

Write-Output "Brand pack generated at $outputPath"
