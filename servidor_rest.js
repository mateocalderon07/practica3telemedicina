var express = require("express");
var app = express();

var jwt = require("jwt-simple");
var clave = "miSecretoMasOscuro"; // clave para codificar / decodificar el token

var mysql = require("mysql");
var database = {
  host: "localhost",
  user: "root",
  password: "",
  database: "telemed26",
  port: 3306,
  // Las columnas DECIMAL (horas_estimadas) llegan como texto: se convierten a número
  typeCast: function (field, next) {
    if (field.type === "NEWDECIMAL") {
      var valor = field.string();
      return valor === null ? null : Number(valor);
    }
    return next();
  }
};

var conexion = mysql.createConnection(database);
console.log("Conectando con la base de datos...");
conexion.connect(function (err) {
  if (err) {
    console.log("Se ha producido un error al conectar a la base de datos", err);
    process.exit(1);
  } else {
    console.log("Base de datos conectada correctamente (REST)");
  }
});

app.use("/appGestor", express.static("cliente_rest"));
app.use("/appSanitario", express.static("cliente_rpc"));
app.use("/comun", express.static("comun")); // estilos.css compartido por las dos apps
app.use(express.json());

// Las restricciones (login y número de serie únicos, claves foráneas, CHECK)
// las controla la BD: aquí solo se traduce el error a un código HTTP
function responderError(res, err, mensajeDuplicado) {
  if (err.code === "ER_DUP_ENTRY") {
    return res.status(400).json(mensajeDuplicado);
  }
  // 4025: restricción CHECK incumplida (MariaDB)
  if (err.code === "ER_NO_REFERENCED_ROW_2" || err.errno === 4025) {
    return res.status(400).json("Datos no válidos.");
  }
  console.error(err.code, err.sqlMessage);
  res.status(500).json("Error al realizar la consulta");
}

// ---------- Servicios públicos (no necesitan token) ----------

// Si las credenciales son correctas devuelve el id del gestor y su token
app.post("/api/gestores/login", (req, res) => {
  var sql = "SELECT id FROM gestores WHERE usuario = ? AND password = ? LIMIT 1";
  conexion.query(sql, [req.body.login, req.body.password], function (err, rows) {
    if (err) return responderError(res, err);
    if (rows.length === 0) return res.status(403).json("Credenciales incorrectas.");
    var contenido = { // contenido del token
      usuario: rows[0].id,
      expira: Date.now() + 60 * 60 * 1000 // expira dentro de 1 hora (en ms)
    };
    var token = jwt.encode(contenido, clave);
    res.status(200).json({ id: rows[0].id, token: token });
  });
});

app.post("/api/gestores", function(req, res) {
  var g = req.body; // {nombre, apellidos, usuario, password}
  var sql = "INSERT INTO gestores (nombre, apellidos, usuario, password) VALUES (?, ?, ?, ?)";
  conexion.query(sql, [g.nombre, g.apellidos, g.usuario, g.password], function (err, result) {
    if (err) return responderError(res, err, "El login ya existe");
    res.status(201).json(result.insertId);
  });
});

// Antes de este use, los servicios son públicos. Todo lo que hay a partir de aquí
// necesita un token válido en la URL: /api/...?token=XXXXXXXX
app.use("/api", function (req, res, next) {
  var token = req.query.token;
  if (!token) { // no se ha pasado un token
    res.status(301).json("No se ha encontrado token");
    return;
  }

  // Decodificar el token (si se ha manipulado o no es un token, decode lanza un error)
  try {
    var contenidoToken = jwt.decode(token, clave);
  } catch (error) {
    res.status(301).json("El token es incorrecto");
    return;
  }

  // Validar el formato del token
  if (!contenidoToken || !contenidoToken.expira || !contenidoToken.usuario) {
    res.status(301).json("El formato del token no es adecuado");
    return;
  }

  // Comprobar la fecha de expiración
  if (contenidoToken.expira < Date.now()) {
    res.status(301).json("El token ha expirado");
    return;
  }
  // Todo ha ido bien: express continúa con el servicio pedido
  next();
});

// ---------- Servicios privados (necesitan token) ----------

app.get("/api/ubicaciones", (req, res) => {
  conexion.query("SELECT * FROM ubicaciones ORDER BY id", function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.get("/api/categorias", (req, res) => {
  conexion.query("SELECT * FROM categorias ORDER BY id", function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.get("/api/modelos", (req, res) => {
  conexion.query("SELECT * FROM modelos ORDER BY id", function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.put("/api/gestores/:id", function(req, res) {
  var g = req.body; // {nombre, apellidos, usuario, password}
  var sql, params;
  if (g.password) {
    sql = "UPDATE gestores SET nombre = ?, apellidos = ?, usuario = ?, password = ? WHERE id = ?";
    params = [g.nombre, g.apellidos, g.usuario, g.password, req.params.id];
  } else { // si viene vacía se mantiene la contraseña actual
    sql = "UPDATE gestores SET nombre = ?, apellidos = ?, usuario = ? WHERE id = ?";
    params = [g.nombre, g.apellidos, g.usuario, req.params.id];
  }
  conexion.query(sql, params, function (err, result) {
    if (err) return responderError(res, err, "El login ya existe");
    if (result.affectedRows === 0) return res.status(404).json("El gestor no existe.");
    res.status(200).json("Se han actualizado correctamente los datos.");
  });
});

app.get("/api/gestores/:id", function(req, res) {
  var sql = "SELECT id, nombre, apellidos, usuario FROM gestores WHERE id = ? LIMIT 1";
  conexion.query(sql, [req.params.id], function (err, rows) {
    if (err) return responderError(res, err);
    if (rows.length === 0) return res.status(404).json("Gestor no encontrado.");
    res.status(200).json(rows[0]);
  });
});

app.get("/api/sanitarios/:id", function(req, res) {
  var sql = "SELECT id, nombre, apellidos, usuario FROM sanitarios WHERE id = ? LIMIT 1";
  conexion.query(sql, [req.params.id], function (err, rows) {
    if (err) return responderError(res, err);
    if (rows.length === 0) return res.status(404).json("Sanitario no encontrado.");
    res.status(200).json(rows[0]);
  });
});

app.get("/api/recursos", function(req, res) {
  // La categoría no está en el recurso: se filtra a través de su modelo
  var condiciones = [];
  var params = [];
  if (req.query.categoria) {
    condiciones.push("m.categoria = ?");
    params.push(req.query.categoria);
  }
  if (req.query.modelo) {
    condiciones.push("r.modelo = ?");
    params.push(req.query.modelo);
  }
  if (req.query.ubicacion) {
    condiciones.push("r.ubicacion = ?");
    params.push(req.query.ubicacion);
  }
  if (req.query.estado !== undefined && req.query.estado !== "" && req.query.estado !== "-1") {
    condiciones.push("r.estado = ?");
    params.push(req.query.estado);
  }
  var sql = "SELECT r.* FROM recurso r JOIN modelos m ON r.modelo = m.id";
  if (condiciones.length > 0) sql += " WHERE " + condiciones.join(" AND ");
  sql += " ORDER BY r.id";

  conexion.query(sql, params, function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.get("/api/recursos/:id", function(req, res) {
  conexion.query("SELECT * FROM recurso WHERE id = ? LIMIT 1", [req.params.id], function (err, rows) {
    if (err) return responderError(res, err);
    if (rows.length === 0) return res.status(404).json("Recurso no encontrado.");
    res.status(200).json(rows[0]);
  });
});

app.post("/api/recursos", function(req, res) {
  var recurso = {
    modelo: parseInt(req.body.modelo),
    ubicacion: parseInt(req.body.ubicacion),
    numero_serie: req.body.numero_serie,
    estado: parseInt(req.body.estado)
  };
  var sql = "INSERT INTO recurso (modelo, ubicacion, numero_serie, estado) VALUES (?, ?, ?, ?)";
  conexion.query(sql, [recurso.modelo, recurso.ubicacion, recurso.numero_serie, recurso.estado], function (err, result) {
    if (err) return responderError(res, err, "El número de serie ya existe");
    recurso.id = result.insertId;
    res.status(201).json(recurso);
  });
});

app.put("/api/recursos/:id", function(req, res) {
  var r = req.body; // {modelo, numero_serie, ubicacion, estado}
  var sql = "UPDATE recurso SET modelo = ?, numero_serie = ?, ubicacion = ?, estado = ? WHERE id = ?";
  var params = [parseInt(r.modelo), r.numero_serie, parseInt(r.ubicacion), parseInt(r.estado), req.params.id];
  conexion.query(sql, params, function (err, result) {
    if (err) return responderError(res, err, "El número de serie ya existe");
    if (result.affectedRows === 0) return res.status(404).json("Error actualizando el recurso.");
    res.status(200).json("El recurso se ha actualizado en la base de datos.");
  });
});

app.get("/api/recursos/:id/reservas", function(req, res) {
  var sql = "SELECT * FROM reservas WHERE recurso = ? ORDER BY fecha_peticion";
  conexion.query(sql, [req.params.id], function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.get("/api/recursos/:id/resenyas", function(req, res) {
  var sql = "SELECT * FROM resenyas WHERE recurso = ? ORDER BY fecha";
  conexion.query(sql, [req.params.id], function (err, rows) {
    if (err) return responderError(res, err);
    res.status(200).json(rows);
  });
});

app.delete("/api/recursos/:id", function(req, res) {
  // Sus reservas y reseñas se borran solas (ON DELETE CASCADE en la BD)
  conexion.query("DELETE FROM recurso WHERE id = ?", [req.params.id], function (err, result) {
    if (err) return responderError(res, err);
    if (result.affectedRows === 0) return res.status(404).json("No se ha encontrado el recurso para eliminar.");
    res.status(200).json("Recurso eliminado correctamente.");
  });
});

app.listen(3000, () => {
  console.log('Servidor en http://localhost:3000');
});
