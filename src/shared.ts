// ========== Shared utilities ==========

export function html(body: string): Response {
  return new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

export function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatTime(t: string): string {
  return t ? t.substring(0, 5) : "";
}

export function escapeHtml(value: any): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function escapeJsString(value: any): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

export function renderPage(content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>EduScheduler</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="topbar">
  <div class="logo">EduScheduler</div>
  <nav class="main-nav">
    <a href="/edit">Edit Schedule</a>
    <a href="/view">View Schedule</a>
    <a href="/teachers">Teacher Schedule</a>
  </nav>
</header>
<main>
  ${content}
</main>
</body>
</html>`;
}
