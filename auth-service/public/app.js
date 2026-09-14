const TOKEN_KEY = "wega_access_token";
const CLAIMS_KEY = "wega_access_claims";

function loginHref() {
  const redirect = encodeURIComponent(`${location.origin}/app/callback`);
  return `/auth/login?client_id=intranet&redirect_uri=${redirect}`;
}

function applyLoginLinks() {
  document.querySelectorAll("#login-link, a[href*='/auth/login']").forEach((el) => {
    el.setAttribute("href", loginHref());
  });
}

function token() {
  return sessionStorage.getItem(TOKEN_KEY);
}

function authHeaders() {
  return { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };
}

function decodeJwt(value) {
  const [, payload] = value.split(".");
  return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
}

async function completeCallback() {
  const params = new URLSearchParams(location.search);
  const code = params.get("code");
  const status = document.getElementById("status");
  if (!code) {
    status.className = "flash error";
    status.textContent = "Código de autorização ausente.";
    return;
  }
  const response = await fetch("/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      code,
      client_id: "intranet",
      redirect_uri: `${location.origin}/app/callback`
    })
  });
  const data = await response.json();
  if (!response.ok) {
    status.className = "flash error";
    status.textContent = data.message || "Falha ao emitir o JWT.";
    return;
  }
  sessionStorage.setItem(TOKEN_KEY, data.access_token);
  sessionStorage.setItem(CLAIMS_KEY, JSON.stringify(data.claims));
  location.replace("/");
}

function renderChips(el, items, cls) {
  el.innerHTML = (items || []).map((item) => `<span class="chip ${cls || ""}">${item}</span>`).join("") ||
    '<span class="muted">Nenhum</span>';
}

async function bootHome() {
  applyLoginLinks();
  const guest = document.getElementById("guest");
  const session = document.getElementById("session");
  if (!token()) {
    guest.classList.remove("hidden");
    session.classList.add("hidden");
    return;
  }
  const me = await fetch("/auth/me", { headers: authHeaders() });
  if (!me.ok) {
    sessionStorage.clear();
    guest.classList.remove("hidden");
    return;
  }
  const data = await me.json();
  guest.classList.add("hidden");
  session.classList.remove("hidden");
  document.getElementById("hello").textContent = `Olá, ${data.user.name}`;
  document.getElementById("session-lead").textContent =
    `${data.user.email} · UO ${data.user.organizationalUnit || "n/d"} · ${data.user.company || ""}`;
  document.getElementById("profile").innerHTML = [
    ["Entra ID", data.user.entraId],
    ["Departamento", data.user.department],
    ["Empresa", data.user.company],
    ["País", data.user.country],
    ["Localização", data.user.officeLocation],
    ["Idioma", data.user.preferredLanguage],
    ["Status", data.user.status],
    ["Último acesso", data.user.lastAccessAt]
  ]
    .map(([k, v]) => `<b>${k}</b><span>${v || "—"}</span>`)
    .join("");
  renderChips(document.getElementById("role-chips"), data.roles, "red");
  renderChips(document.getElementById("roles"), data.roles, "red");
  renderChips(document.getElementById("permissions"), data.permissions, "green");
  document.getElementById("jwt").textContent = JSON.stringify(decodeJwt(token()), null, 2);
  document.getElementById("logout").onclick = async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "include", headers: authHeaders(), body: "{}" });
    sessionStorage.clear();
    location.reload();
  };
}

async function bootAdmin() {
  applyLoginLinks();
  const denied = document.getElementById("denied");
  const ok = document.getElementById("ok");
  if (!token()) {
    denied.classList.remove("hidden");
    return;
  }
  const [rolesRes, usersRes, mappingsRes, auditRes] = await Promise.all([
    fetch("/api/roles", { headers: authHeaders() }),
    fetch("/api/users", { headers: authHeaders() }),
    fetch("/api/mappings", { headers: authHeaders() }),
    fetch("/api/audit", { headers: authHeaders() })
  ]);
  if (!rolesRes.ok) {
    denied.classList.remove("hidden");
    return;
  }
  ok.classList.remove("hidden");
  const roles = await rolesRes.json();
  const users = await usersRes.json();
  const mappings = await mappingsRes.json();
  const audit = await auditRes.json();

  document.getElementById("roles").innerHTML = roles
    .map(
      (role) => `<tr>
        <td><b>${role.code}</b><br /><span class="muted">${role.name}</span></td>
        <td>${role.application}</td>
        <td>${role.entraGroups.join(", ") || "—"}</td>
        <td>${role.permissions.join(", ")}</td>
      </tr>`
    )
    .join("");
  document.getElementById("mappings").innerHTML = mappings
    .map((m) => `<p><span class="chip">${m.entraGroupName}</span> → <b>${m.role}</b></p>`)
    .join("");
  document.getElementById("users").innerHTML = users
    .map(
      (u) => `<p><b>${u.name}</b><br /><span class="muted">${u.email}</span><br />${u.roles
        .map((r) => r.code)
        .join(", ") || "sem role"}</p>`
    )
    .join("") || "<p class='muted'>Nenhum usuário persistido ainda.</p>";
  document.getElementById("audit").innerHTML = audit
    .slice(0, 8)
    .map((l) => `<p><span class="chip ${l.success ? "green" : "red"}">${l.eventType}</span> ${l.email || ""}</p>`)
    .join("") || "<p class='muted'>Sem eventos.</p>";
}
