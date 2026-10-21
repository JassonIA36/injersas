// Pantalla de inicio de sesion de /admin

export const loginPage = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Entrar | Panel INJER</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;
    background:linear-gradient(135deg,#08120e 0%,#0b1c16 55%,#0f231c 100%)}
  .card{width:100%;max-width:380px;background:#fff;border-radius:16px;padding:32px 28px;box-shadow:0 20px 60px rgba(0,0,0,.4)}
  img{display:block;margin:0 auto 14px;height:64px;width:auto;max-width:200px;object-fit:contain}
  h1{font-size:1.3rem;margin:0 0 4px;text-align:center}
  p.sub{margin:0 0 22px;text-align:center;color:#64748b;font-size:.95rem}
  label{display:block;font-weight:600;font-size:.9rem;margin-bottom:6px}
  .field{position:relative}
  input{width:100%;padding:13px 76px 13px 14px;font-size:1rem;border:1.5px solid #cbd5e1;border-radius:10px;outline:none}
  input:focus{border-color:#009639;box-shadow:0 0 0 3px rgba(0,150,57,.18)}
  .toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);border:0;background:none;color:#009639;
    font-weight:600;font-size:.85rem;padding:8px;cursor:pointer}
  button.go{width:100%;margin-top:18px;padding:14px;font-size:1rem;font-weight:700;color:#fff;background:#009639;
    border:0;border-radius:10px;cursor:pointer}
  button.go:disabled{opacity:.6;cursor:wait}
  .err{margin-top:14px;padding:10px 12px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:.92rem;display:none}
  a.back{display:block;margin-top:18px;text-align:center;color:#64748b;font-size:.9rem;text-decoration:none}
</style>
</head>
<body>
<main class="card">
  <img src="/assets/logo.jpg" alt="INJER S.A.S.">
  <h1>Panel de edición</h1>
  <p class="sub">Entra para editar tu página</p>
  <form id="f" autocomplete="on">
    <label for="p">Contraseña</label>
    <div class="field">
      <input id="p" type="password" autocomplete="current-password" required autofocus>
      <button type="button" class="toggle" id="t">Mostrar</button>
    </div>
    <button class="go" id="b" type="submit">Entrar</button>
    <div class="err" id="e" role="alert"></div>
  </form>
  <a class="back" href="/">← Volver a la página</a>
</main>
<script>
  var f=document.getElementById('f'),p=document.getElementById('p'),b=document.getElementById('b'),e=document.getElementById('e'),t=document.getElementById('t');
  t.onclick=function(){var s=p.type==='password';p.type=s?'text':'password';t.textContent=s?'Ocultar':'Mostrar'};
  f.onsubmit=function(ev){
    ev.preventDefault();e.style.display='none';b.disabled=true;b.textContent='Entrando…';
    fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})})
      .then(function(r){return r.json().catch(function(){return{}}).then(function(d){return{ok:r.ok,d:d}})})
      .then(function(x){
        if(x.ok){location.replace('/admin');return}
        e.textContent=x.d.error||'No se pudo entrar. Inténtalo de nuevo.';e.style.display='block';
      })
      .catch(function(){e.textContent='Sin conexión. Revisa tu internet e inténtalo de nuevo.';e.style.display='block'})
      .then(function(){b.disabled=false;b.textContent='Entrar';p.select()});
  };
</script>
</body>
</html>`;
