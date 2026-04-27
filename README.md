# 🗺️ Premiatta RouteMap — Sistema Premium de Roteirização

Sistema completo de roteirização com múltiplas paradas, exportação e visual premium inspirado na identidade da Premiatta Petfood.

---

## 📁 Estrutura de Arquivos

```
premiatta-route/
├── index.html   ← Estrutura HTML da aplicação
├── style.css    ← Estilos premium (tema preto/dourado)
├── app.js       ← Lógica JavaScript completa
└── README.md    ← Este arquivo
```

---

## ⚙️ Configuração da API Key (obrigatório)

### Passo 1 — Criar projeto no Google Cloud

1. Acesse [https://console.cloud.google.com](https://console.cloud.google.com)
2. Clique em **"Novo Projeto"** e dê um nome (ex: `premiatta-routemap`)
3. Selecione o projeto criado

### Passo 2 — Ativar as APIs necessárias

No menu lateral, vá em **APIs e Serviços → Biblioteca** e ative:

| API | Função |
|-----|--------|
| **Maps JavaScript API** | Renderiza o mapa interativo |
| **Places API** | Autocomplete de endereços |
| **Directions API** | Cálculo de rotas e alternativas |

### Passo 3 — Gerar a API Key

1. Vá em **APIs e Serviços → Credenciais**
2. Clique em **"+ Criar Credenciais" → "Chave de API"**
3. Copie a chave gerada
4. (Recomendado) Clique em **"Restringir Chave"**:
   - Restrição de aplicativo: **Referenciadores HTTP** → adicione seu domínio
   - Restrição de API: selecione as 3 APIs acima

### Passo 4 — Inserir a chave na aplicação

Abra o arquivo `app.js` e edite a **linha 3**:

```javascript
// ANTES:
const GOOGLE_MAPS_API_KEY = "SUA_CHAVE_AQUI";

// DEPOIS (exemplo):
const GOOGLE_MAPS_API_KEY = "AIzaSyBxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
```

---

## 🚀 Como Executar

### Opção 1 — Abrir diretamente no navegador
Basta dar duplo clique em `index.html`. O mapa carrega automaticamente após inserir a API Key.

### Opção 2 — Servidor local (recomendado para evitar bloqueios CORS)

**Com Python:**
```bash
# Python 3
cd premiatta-route
python -m http.server 8080
# Acesse: http://localhost:8080
```

**Com Node.js (npx):**
```bash
cd premiatta-route
npx serve .
# Acesse a URL exibida no terminal
```

**Com VS Code:**
Instale a extensão **Live Server** → clique com botão direito em `index.html` → **"Open with Live Server"**

---

## 🎯 Funcionalidades

### Endereços com Autocomplete
- **Local de Partida**: campo com sugestões em tempo real via Places API
- **Paradas intermediárias**: adicione ilimitadas paradas dinamicamente
- **Destino Final**: campo com autocomplete
- Botão ✕ para limpar cada campo individualmente

### Mapa Interativo
- Carrega automaticamente com tema escuro personalizado
- Marcadores coloridos: 🟢 Origem · 🟡 Paradas · 🔴 Destino
- Zoom automático para exibir toda a rota
- Rotas alternativas em cinza semi-transparente

### Cálculo de Rota
- Rota otimizada passando por todas as paradas
- Exibe **distância total** e **tempo estimado**
- Atualiza ao recalcular com qualquer alteração
- Toggle para otimizar automaticamente a ordem das paradas

### Rotas Alternativas
- Exibe até 3 rotas alternativas disponíveis
- Clique para alternar entre elas no mapa
- Mostra distância e tempo de cada opção

### Modos de Transporte
- 🚗 Carro
- 🚲 Bicicleta
- 🚶 A pé
- 🚌 Transporte público

### Drag & Drop
- Arraste as paradas pelo ícone ⠿ para reordenar
- Animação suave ao soltar

### Direções Passo a Passo
- Lista completa de instruções com distância de cada trecho
- Painel recolhível na parte inferior do mapa

### Exportações
| Botão | Ação |
|-------|------|
| **Google Maps** | Abre a rota no Google Maps em nova aba |
| **PDF** | Gera PDF com cabeçalho, resumo e direções |
| **CSV** | Exporta lista de endereços em planilha |
| **Copiar** | Copia resumo da rota para área de transferência |

---

## ⌨️ Atalhos de Teclado

| Atalho | Ação |
|--------|------|
| `Ctrl + Enter` | Calcular rota |

---

## 🎨 Design

- **Paleta**: Preto `#0A0A0A` · Dourado `#F5B400` · Branco `#FFFFFF`
- **Fontes**: Bebas Neue (títulos) + DM Sans (corpo)
- **Tema do mapa**: Dark style personalizado
- **Responsivo**: Desktop e mobile
- **Animações**: Hover suave, loading spinner, toast notifications

---

## 🔧 Personalizações Comuns

### Alterar cidade padrão do mapa
Em `app.js`, edite o `center` do mapa (linha ~60):
```javascript
center: { lat: -23.5505, lng: -46.6333 }, // São Paulo
```

### Alterar idioma do mapa
Na URL da API (carregada dinamicamente), mude `language=pt-BR`.

### Alterar cor da rota
Em `app.js`, edite `strokeColor` (linha ~73):
```javascript
strokeColor: "#F5B400", // dourado → pode mudar para qualquer cor hex
```

---

## 🔒 Custos da API

O Google Maps oferece **$200 de crédito gratuito/mês**, o que cobre:
- ~28.000 carregamentos de mapa
- ~40.000 consultas de autocomplete
- ~40.000 cálculos de rota

Para uso interno/baixo volume, geralmente **gratuito**.

---

## 📦 Dependências (todas via CDN — sem instalação)

| Biblioteca | Versão | Uso |
|-----------|--------|-----|
| Google Maps JS API | Latest | Mapa, Places, Directions |
| Lucide Icons | Latest | Ícones SVG minimalistas |
| SortableJS | 1.15.2 | Drag & drop das paradas |
| jsPDF | 2.5.1 | Exportação em PDF |
| Google Fonts | — | Bebas Neue + DM Sans |

---

*Premiatta RouteMap — Sistema Premium de Roteirização*
