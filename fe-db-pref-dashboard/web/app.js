async function loadUsers() {
  const status = document.getElementById("status");
  const body = document.getElementById("users-body");

  let data;
  try {
    const response = await fetch("/api/users");
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    data = await response.json();
  } catch (error) {
    status.textContent = "Failed to load users";
    body.innerHTML = `<tr><td colspan="5" class="error">${escapeHtml(String(error))}</td></tr>`;
    return;
  }

  const users = data.users || [];
  status.textContent = `${users.length} user${users.length === 1 ? "" : "s"}`;

  if (users.length === 0) {
    body.innerHTML = `<tr><td colspan="5" class="empty">No users found.</td></tr>`;
    return;
  }

  body.innerHTML = users
    .map(
      (user) => `
        <tr>
          <td>${escapeHtml(user.username)}</td>
          <td class="num up">${user.up}</td>
          <td class="num down">${user.down}</td>
          <td class="num cleared">${user.cleared}</td>
          <td class="num">${user.up + user.down + user.cleared}</td>
        </tr>`
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

loadUsers();
