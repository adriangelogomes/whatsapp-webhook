# 🚨 Troubleshooting - Erro de Deploy

## ❌ Erro: Página HTML do GitHub (Unicorn Error)

Se você está vendo uma página HTML de erro do GitHub durante o deploy no EasyPanel, isso geralmente indica um problema no processo de build/deploy, não no código.

## 🔍 Possíveis Causas

### 1. **Timeout no Build**
O build do Docker pode estar demorando muito e o EasyPanel está dando timeout.

**Solução:**
- Verifique os logs do build no EasyPanel
- Aumente o timeout se possível
- Verifique se o `package-lock.json` está no repositório

### 2. **Problema de Acesso ao GitHub**
O EasyPanel pode não estar conseguindo acessar o repositório.

**Solução:**
- Verifique se o repositório está público ou se há permissões configuradas
- Verifique se a URL do repositório está correta no EasyPanel
- Tente fazer um novo deploy

### 3. **Erro no Dockerfile**
Pode haver um problema no Dockerfile que está causando falha no build.

**Solução:**
- Verifique os logs do build no EasyPanel
- Teste o build localmente: `docker build -t whatsapp-webhook .`

### 4. **Problema com package-lock.json**
Se o `package-lock.json` não estiver no repositório, o `npm ci` pode falhar.

**Solução:**
- Certifique-se de que `package-lock.json` está commitado
- Execute `npm install` localmente e faça commit do `package-lock.json`

## ✅ Verificações Rápidas

### 1. Verificar se package-lock.json existe

```bash
git ls-files | grep package-lock.json
```

Se não existir:
```bash
npm install
git add package-lock.json
git commit -m "fix: adiciona package-lock.json"
git push
```

### 2. Testar build localmente

```bash
docker build -t whatsapp-webhook .
```

Se o build local funcionar, o problema é no EasyPanel.

### 3. Verificar sintaxe do código

```bash
node -c index.js
```

Se não houver erros, o código está correto.

## 🔧 Solução Passo a Passo

1. **Verifique os logs do EasyPanel**
   - Acesse o painel do EasyPanel
   - Vá em "Logs" ou "Build Logs"
   - Procure por erros específicos

2. **Verifique o repositório GitHub**
   - Confirme que o código foi enviado corretamente
   - Verifique se não há arquivos corrompidos

3. **Tente fazer rebuild**
   - No EasyPanel, cancele o build atual
   - Inicie um novo build/deploy

4. **Verifique variáveis de ambiente**
   - Confirme que todas as variáveis obrigatórias estão configuradas:
     - `RABBIT_URL`
     - `WEBHOOK_SECRET`
     - Outras variáveis opcionais

## 📋 Checklist de Deploy

- [ ] `package-lock.json` está no repositório
- [ ] Código foi commitado e enviado para GitHub
- [ ] Build local funciona (`docker build`)
- [ ] Sintaxe do código está correta (`node -c index.js`)
- [ ] Variáveis de ambiente configuradas no EasyPanel
- [ ] Logs do EasyPanel foram verificados

## 🆘 Se Nada Funcionar

1. **Limpe o cache do build**
   - No EasyPanel, tente limpar o cache de build

2. **Redeploy completo**
   - Delete o serviço atual
   - Crie um novo serviço
   - Configure novamente

3. **Contate suporte do EasyPanel**
   - Forneça os logs de build
   - Informe o erro específico que está vendo

