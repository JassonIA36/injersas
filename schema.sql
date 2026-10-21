-- Textos editables: una fila por clave (data-edit)
CREATE TABLE IF NOT EXISTS contenido (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

-- Fotos subidas (una fila por subida; el id nunca se reutiliza)
CREATE TABLE IF NOT EXISTS imagenes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  datos BLOB NOT NULL,
  tipo TEXT NOT NULL,
  fecha INTEGER NOT NULL
);

-- Elementos de las listas (servicios, galeria, etc.); campos es JSON
CREATE TABLE IF NOT EXISTS listas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seccion TEXT NOT NULL,
  orden INTEGER NOT NULL,
  campos TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listas_seccion ON listas (seccion, orden);

-- Sesiones del administrador (tipo 'sesion') y contador de intentos
-- fallidos por IP (tipo 'intento')
CREATE TABLE IF NOT EXISTS sesiones (
  id TEXT PRIMARY KEY,
  tipo TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  expira INTEGER NOT NULL
);
