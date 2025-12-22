# Script para criar e fazer push do repositório no GitHub
# Execute após autenticar: gh auth login

Write-Host "🚀 Criando repositório no GitHub..." -ForegroundColor Cyan

# Verifica se está autenticado
$authStatus = gh auth status 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Você precisa autenticar primeiro!" -ForegroundColor Red
    Write-Host "Execute: gh auth login" -ForegroundColor Yellow
    exit 1
}

# Cria o repositório e faz push
Write-Host "📦 Criando repositório 'whatsapp-webhook'..." -ForegroundColor Cyan
gh repo create whatsapp-webhook --public --source=. --remote=origin --push

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Repositório criado e código enviado com sucesso!" -ForegroundColor Green
    Write-Host "🔗 Acesse: https://github.com/$(gh api user --jq .login)/whatsapp-webhook" -ForegroundColor Cyan
} else {
    Write-Host "❌ Erro ao criar repositório" -ForegroundColor Red
    exit 1
}

