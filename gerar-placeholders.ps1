# ============================================================================
#  Adventure Burguer - Gerador de imagens placeholder
#  Cria imagens cinza escuras com o nome e o tamanho escritos nelas,
#  para voce ver o layout antes de ter as fotos reais.
#
#  Como usar:  clique com o botao direito > "Executar com o PowerShell"
#              ou rode:  powershell -ExecutionPolicy Bypass -File gerar-placeholders.ps1
#
#  Depois e so substituir cada arquivo pela foto real, mantendo o MESMO NOME.
# ============================================================================

Add-Type -AssemblyName System.Drawing

$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
$img  = Join-Path $raiz 'assets\img'
$prod = Join-Path $img 'produtos'

foreach ($d in @($img, $prod)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function New-Placeholder {
  param(
    [string]$Path,
    [int]$W,
    [int]$H,
    [string]$Label,
    [string]$Accent = '#FFC21A'
  )

  $bmp = New-Object System.Drawing.Bitmap($W, $H)
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode     = 'AntiAlias'
  $g.TextRenderingHint = 'ClearTypeGridFit'

  # fundo em degrade escuro
  $rect = New-Object System.Drawing.Rectangle(0, 0, $W, $H)
  $c1   = [System.Drawing.ColorTranslator]::FromHtml('#1c1c1c')
  $c2   = [System.Drawing.ColorTranslator]::FromHtml('#0b0b0b')
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c2, 45.0)
  $g.FillRectangle($grad, $rect)

  # moldura tracejada
  $accentColor = [System.Drawing.ColorTranslator]::FromHtml($Accent)
  $pen = New-Object System.Drawing.Pen($accentColor, 3)
  $pen.DashStyle = 'Dash'
  $m = [Math]::Max(10, [int]($W * 0.02))
  $g.DrawRectangle($pen, $m, $m, ($W - 2*$m), ($H - 2*$m))

  # icone
  $iconSize = [Math]::Max(28, [int]($H * 0.16))
  $fIcon = New-Object System.Drawing.Font('Segoe UI Emoji', $iconSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment     = 'Center'
  $fmt.LineAlignment = 'Center'
  $brIcon = New-Object System.Drawing.SolidBrush($accentColor)
  $g.DrawString([char]0xD83C + [string][char]0xDF54, $fIcon, $brIcon,
    (New-Object System.Drawing.RectangleF(0, ($H*0.30), $W, ($H*0.18))), $fmt)

  # nome do arquivo
  $nameSize = [Math]::Max(13, [int]($W * 0.045))
  $fName = New-Object System.Drawing.Font('Segoe UI', $nameSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $brName = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::White)
  $g.DrawString($Label, $fName, $brName,
    (New-Object System.Drawing.RectangleF(($W*0.06), ($H*0.48), ($W*0.88), ($H*0.16))), $fmt)

  # dimensoes
  $dimSize = [Math]::Max(11, [int]($W * 0.035))
  $fDim = New-Object System.Drawing.Font('Segoe UI', $dimSize, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $brDim = New-Object System.Drawing.SolidBrush($accentColor)
  $g.DrawString("$W x $H px", $fDim, $brDim,
    (New-Object System.Drawing.RectangleF(0, ($H*0.63), $W, ($H*0.12))), $fmt)

  $ext = [System.IO.Path]::GetExtension($Path).ToLower()
  if ($ext -eq '.png') {
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Jpeg)
  }

  $g.Dispose(); $bmp.Dispose(); $grad.Dispose(); $pen.Dispose()
  Write-Host ("  OK  " + (Split-Path $Path -Leaf).PadRight(34) + " $W x $H")
}

Write-Host ""
Write-Host "Gerando placeholders..." -ForegroundColor Yellow
Write-Host ""

# ---- Imagens gerais -------------------------------------------------------
New-Placeholder (Join-Path $img 'logo.png')            512  512  'LOGO'          '#FFC21A'
New-Placeholder (Join-Path $img 'favicon.png')         512  512  'FAVICON'       '#FFC21A'
New-Placeholder (Join-Path $img 'hero.jpg')           1920 1080  'HERO / CAPA'   '#E01F26'
New-Placeholder (Join-Path $img 'og-cover.jpg')       1200  630  'OG COVER'      '#E01F26'
New-Placeholder (Join-Path $img 'cta-bg.jpg')         1920  700  'FUNDO CTA'     '#E01F26'
New-Placeholder (Join-Path $img 'promo-destaque.jpg') 1200  900  'PROMO DESTAQUE' '#E01F26'
New-Placeholder (Join-Path $img 'promo-2.jpg')         800  600  'PROMO 2'       '#FFC21A'
New-Placeholder (Join-Path $img 'promo-3.jpg')         800  600  'PROMO 3'       '#FFC21A'
New-Placeholder (Join-Path $img 'promo-4.jpg')         800  600  'PROMO 4'       '#FFC21A'
New-Placeholder (Join-Path $img 'sobre-1.jpg')        1000 1200  'SOBRE 1'       '#FFC21A'
New-Placeholder (Join-Path $img 'sobre-2.jpg')         700  700  'SOBRE 2'       '#FFC21A'

# ---- Produtos (todos 800 x 800) ------------------------------------------
$produtos = @(
  'classic-burguer','bacon-burguer','salada-burguer','american-burguer',
  'doritos-burguer','stacker-burguer','onions-burguer','bacon-cheddar',
  'especial-cheddar','chicken-burguer',
  'duplo-bacon','duplo-cheddar','triplo-cheddar','adventure-40',
  'combo-classic','combo-bacon','combo-doritos','combo-stacker',
  'combo-chicken','combo-40',
  'batata','batata-cheddar-bacon','onion-rings','maionese-da-casa',
  'refrigerantes','cervejas','energeticos'
)

foreach ($p in $produtos) {
  New-Placeholder (Join-Path $prod "$p.jpg") 800 800 $p.ToUpper() '#FFC21A'
}

Write-Host ""
Write-Host ("Pronto! " + ($produtos.Count + 11) + " imagens geradas em assets\img\") -ForegroundColor Green
Write-Host "Substitua cada arquivo pela foto real mantendo o mesmo nome." -ForegroundColor Green
Write-Host ""
