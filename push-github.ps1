# Script para fazer push do código para o GitHub
# Execute APÓS criar o repositório manualmente no GitHub

param(
    [Parameter(Mandatory=$true)]
    [string]$GitHubUser,
    
    [Parameter(Mandatory=$false)]
    [string]$RepoName = "whatsapp-webhook"
)

Write-Host "🚀 Configurando repositório remoto..." -ForegroundColor Cyan

# Remove remote se já existir
git remote remove origin 2>$null

# Adiciona o remote
$repoUrl = "https://github.com/$GitHubUser/$RepoName.git"
git remote add origin $repoUrl

Write-Host "📦 Renomeando branch para main..." -ForegroundColor Cyan
git branch -M main

Write-Host "⬆️ Enviando código para o GitHub..." -ForegroundColor Cyan
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Código enviado com sucesso!" -ForegroundColor Green
    Write-Host "🔗 Repositório: https://github.com/$GitHubUser/$RepoName" -ForegroundColor Cyan
} else {
    Write-Host "❌ Erro ao enviar código" -ForegroundColor Red
    Write-Host "Verifique se:" -ForegroundColor Yellow
    Write-Host "  1. O repositório foi criado no GitHub" -ForegroundColor Yellow
    Write-Host "  2. Você tem permissão para fazer push" -ForegroundColor Yellow
    Write-Host "  3. A URL do repositório está correta" -ForegroundColor Yellow
}

