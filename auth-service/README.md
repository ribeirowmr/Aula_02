# Auth Service Wega

Serviço centralizado de **autenticação e autorização** da Intranet Wega.

O **Microsoft Entra ID** permanece como fonte de identidade (login, MFA e credenciais).  
O **Auth Service** valida o retorno OIDC, consulta o Microsoft Graph, mapeia grupos para Roles internas, gerencia permissões, persiste o cadastro do usuário (sem senha), registra auditoria e emite o JWT usado pelos sistemas internos.

```text
Usuário → Intranet → Microsoft Entra ID → Auth Service → JWT/Roles → Comex / Financeiro / outros
```

## O que este serviço faz

- Authorization Code Flow com PKCE contra o Entra ID
- Redirect URI de desenvolvimento: `http://localhost:3000/auth/redirect`
- Redirect URI de produção: `https://auth.wega.ind.br/auth/redirect`
- Consulta ao Graph (`/me` e `/me/memberOf`) para grupos e atributos organizacionais
- Mapeamento `Grupo Entra → Role interna → Permissões`
- Persistência de usuário, sessão, refresh token (hash) e logs
- JWT RS256 com `iss`, `aud`, `exp`, `roles`, `permissions` e `uo`
- JWKS em `/auth/jwks.json` para as aplicações validarem a assinatura

## Estratégia de grupos e roles (seed)

| Grupo Entra ID     | Role interna    | Exemplos de permissões                                      |
| ------------------ | --------------- | ----------------------------------------------------------- |
| `CONNECT-ADM`      | `COMEX-ADMIN`   | criar, editar, excluir, relatórios, administrar usuários    |
| `CONNECT-FINANCEIRO` | `COMEX-FINANCE` | criar, editar, consultar relatórios                         |
| `FINANCEIRO-ADM`   | `FIN-ADMIN`     | permissões administrativas do sistema financeiro            |
| `AUTH-ADM`         | `AUTH-ADMIN`    | administração do próprio Auth Service                       |

A associação a um grupo **não** libera permissões diretamente. O grupo só indica a Role; as permissões vivem no Auth Service e podem ser alteradas sem mudar a estrutura de grupos no Entra ID.

Unidade organizacional, idioma, empresa e país vêm de **atributos do usuário** no Entra ID (`department`, `companyName`, `country`, `officeLocation`, `preferredLanguage`), não de grupos `UO-PT-BR` / `UO-EN`.

## Como executar localmente

```bash
cd auth-service
cp .env.example .env
npm install
npx prisma db push
npm run prisma:seed
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

Com `AUTH_MODE=mock` (padrão), o login simula o Entra ID com quatro colaboradores:

- Maria Souza (`CONNECT-ADM` + `AUTH-ADM`) → `COMEX-ADMIN` e `AUTH-ADMIN`
- João Pereira (`CONNECT-FINANCEIRO`) → `COMEX-FINANCE`
- Ana Ribeiro (`FINANCEIRO-ADM`) → `FIN-ADMIN`
- Pedro Lima (sem grupo) → autenticado, sem roles

Nenhuma senha é armazenada.

## Integração com Microsoft Entra ID

1. Crie um App Registration no Entra ID.
2. Redirect URI: `http://localhost:3000/auth/redirect` (dev) e `https://auth.wega.ind.br/auth/redirect` (prod).
3. Permissões mínimas do Graph: `User.Read`, `GroupMember.Read.All` (admin consent).
4. Preencha no `.env`:

```env
AUTH_MODE=entra
ENTRA_TENANT_ID=...
ENTRA_CLIENT_ID=...
ENTRA_CLIENT_SECRET=...
ENTRA_REDIRECT_URI=http://localhost:3000/auth/redirect
```

5. Reinicie o serviço.

## Integração de um sistema interno

1. Redirecione o usuário para:

```text
GET /auth/login?client_id=comex&redirect_uri=https://comex.wega.ind.br/callback
```

2. Após o Entra ID, o Auth Service devolve um `code` para o `redirect_uri` da aplicação.
3. A aplicação troca o código:

```http
POST /auth/token
{
  "client_id": "comex",
  "redirect_uri": "https://comex.wega.ind.br/callback",
  "code": "..."
}
```

4. Valide o JWT com o JWKS (`/auth/jwks.json`): assinatura, `iss`, `aud`, `exp`.

Exemplo de claims:

```json
{
  "sub": "id-interno",
  "name": "Maria Souza",
  "email": "maria.admin@wega.com.br",
  "roles": ["COMEX-ADMIN"],
  "uo": "BR-SC",
  "iss": "https://auth.wega.ind.br",
  "aud": "comex"
}
```

## Principais endpoints

| Método | Caminho | Descrição |
| ------ | ------- | --------- |
| GET | `/health` | Saúde do serviço |
| GET | `/auth/login` | Inicia OIDC |
| GET | `/auth/redirect` | Callback do Entra ID |
| POST | `/auth/token` | Troca code por JWT |
| POST | `/auth/refresh` | Rotaciona refresh token |
| POST | `/auth/logout` | Revoga sessão |
| GET | `/auth/me` | Perfil, roles e permissões |
| POST | `/auth/introspect` | Introspecção do token |
| GET | `/auth/jwks.json` | Chaves públicas |
| GET | `/api/users` | Usuários persistidos (`AUTH-ADMIN`) |
| GET | `/api/roles` | Roles e permissões |
| GET | `/api/mappings` | Grupo Entra → Role |
| GET | `/api/audit` | Logs de autenticação e autorização |

## Segurança

- OAuth 2.0 / OpenID Connect / Authorization Code + PKCE
- Sem armazenamento de senhas
- Refresh tokens apenas em hash SHA-256, com rotação e revogação
- JWT de curta duração, assinado com RS256
- HTTPS e `Secure` cookies em produção
- Princípio do menor privilégio nas permissões do Graph e nas Roles internas
- Auditoria de login, logout, falhas, emissão/rotação de token e mudanças de acesso

## Testes

```bash
cd auth-service
npm test
```
