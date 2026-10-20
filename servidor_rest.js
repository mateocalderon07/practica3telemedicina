var express = require("express");
var app = express();

// 1. Importar el cliente de Supabase
const { createClient } = require("@supabase/supabase-js");

// 2. Configurar con la URL y la clave pública (publishable key) del proyecto
const supabaseUrl = "https://vbcwjigkncwiqszrvtrg.supabase.co";
const supabaseKey = "sb_publishable_hOAlKT22WqH5OEWmwZ_nNA_I85wl2nC";
const supabase = createClient(supabaseUrl, supabaseKey);

var jwt = require("jwt-simple");
var clave = "miSecretoMasOscuro"; // clave para codificar / decodificar el token

app.use("/appGestor", express.static("cliente_rest"));
app.use("/comun", express.static("comun")); // estilos.css de la app
app.use(express.json());

// Las restricciones (login y número de serie únicos, claves foráneas, CHECK)
// las controla la BD: aquí solo se traduce el error de PostgreSQL a un código HTTP
function responderError(res, err, mensajeDuplicado) {
  if (err.code === "23505") { // valor duplicado en un campo UNIQUE
    return res.status(400).json(mensajeDuplicado);
  }
  // 23503: clave foránea que no existe, 23514: restricción CHECK incumplida,
  // 22P02: valor con formato incorrecto (p. ej. un id que no es un número)
  if (err.code === "23503" || err.code === "23514" || err.code === "22P02") {
    return res.status(400).json("Datos no válidos.");
  }
  console.error(err.code, err.message);
  res.status(500).json("Error al realizar la consulta");
}

// ---------- Servicios públicos (no necesitan token) ----------

// Si las credenciales son correctas devuelve el id del gestor y su token
app.post("/api/gestores/login", async (req, res) => {
  const { data, error } = await supabase
    .from("gestores")
    .select("id")
    .eq("usuario", req.body.login)
    .eq("password", req.body.password)
    .limit(1);
  if (error) return responderError(res, error);
  if (data.length === 0) return res.status(403).json("Credenciales incorrectas.");
  var contenido = { // contenido del token
    usuario: data[0].id,
    expira: Date.now() + 60 * 60 * 1000 // expira dentro de 1 hora (en ms)
  };
  var token = jwt.encode(contenido, clave);
  res.status(200).json({ id: data[0].id, token: token });
});

app.post("/api/gestores", async (req, res) => {
  var g = req.body; // {nombre, apellidos, usuario, password}
  const { data, error } = await supabase
    .from("gestores")
    .insert({ nombre: g.nombre, apellidos: g.apellidos, usuario: g.usuario, password: g.password })
    .select("id")
    .single();
  if (error) return responderError(res, error, "El login ya existe");
  res.status(201).json(data.id);
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

app.get("/api/ubicaciones", async (req, res) => {
  const { data, error } = await supabase.from("ubicaciones").select("*").order("id");
  if (error) return responderError(res, error);
  res.status(200).json(data);
});

app.get("/api/categorias", async (req, res) => {
  const { data, error } = await supabase.from("categorias").select("*").order("id");
  if (error) return responderError(res, error);
  res.status(200).json(data);
});

app.get("/api/modelos", async (req, res) => {
  const { data, error } = await supabase.from("modelos").select("*").order("id");
  if (error) return responderError(res, error);
  res.status(200).json(data);
});

app.put("/api/gestores/:id", async (req, res) => {
  var g = req.body; // {nombre, apellidos, usuario, password}
  var cambios = { nombre: g.nombre, apellidos: g.apellidos, usuario: g.usuario };
  if (g.password) cambios.password = g.password; // si viene vacía se mantiene la contraseña actual

  const { data, error } = await supabase
    .from("gestores")
    .update(cambios)
    .eq("id", req.params.id)
    .select("id"); // devuelve las filas actualizadas
  if (error) return responderError(res, error, "El login ya existe");
  if (data.length === 0) return res.status(404).json("El gestor no existe.");
  res.status(200).json("Se han actualizado correctamente los datos.");
});

app.get("/api/gestores/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("gestores")
    .select("id, nombre, apellidos, usuario")
    .eq("id", req.params.id)
    .maybeSingle(); // un objeto, o null si no existe
  if (error) return responderError(res, error);
  if (data === null) return res.status(404).json("Gestor no encontrado.");
  res.status(200).json(data);
});

app.get("/api/sanitarios/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("sanitarios")
    .select("id, nombre, apellidos, usuario")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) return responderError(res, error);
  if (data === null) return res.status(404).json("Sanitario no encontrado.");
  res.status(200).json(data);
});

app.get("/api/recursos", async (req, res) => {
  // La categoría no está en el recurso: se filtra a través de su modelo.
  // "modelos!inner(categoria)" hace un JOIN con modelos para poder filtrar por su categoría
  var columnas = req.query.categoria ? "*, modelos!inner(categoria)" : "*";
  var consulta = supabase.from("recurso").select(columnas);
  if (req.query.categoria) consulta = consulta.eq("modelos.categoria", req.query.categoria);
  if (req.query.modelo) consulta = consulta.eq("modelo", req.query.modelo);
  if (req.query.ubicacion) consulta = consulta.eq("ubicacion", req.query.ubicacion);
  if (req.query.estado !== undefined && req.query.estado !== "" && req.query.estado !== "-1") {
    consulta = consulta.eq("estado", req.query.estado);
  }

  const { data, error } = await consulta.order("id");
  if (error) return responderError(res, error);
  // Se quita el objeto "modelos" del JOIN para devolver solo los datos del recurso
  data.forEach(function (r) { delete r.modelos; });
  res.status(200).json(data);
});

app.get("/api/recursos/:id", async (req, res) => {
  const { data, error } = await supabase.from("recurso").select("*").eq("id", req.params.id).maybeSingle();
  if (error) return responderError(res, error);
  if (data === null) return res.status(404).json("Recurso no encontrado.");
  res.status(200).json(data);
});

app.post("/api/recursos", async (req, res) => {
  var recurso = {
    modelo: parseInt(req.body.modelo),
    ubicacion: parseInt(req.body.ubicacion),
    numero_serie: req.body.numero_serie,
    estado: parseInt(req.body.estado)
  };
  const { data, error } = await supabase.from("recurso").insert(recurso).select().single();
  if (error) return responderError(res, error, "El número de serie ya existe");
  res.status(201).json(data); // el recurso creado, con su id
});

app.put("/api/recursos/:id", async (req, res) => {
  var r = req.body; // {modelo, numero_serie, ubicacion, estado}
  var cambios = {
    modelo: parseInt(r.modelo),
    numero_serie: r.numero_serie,
    ubicacion: parseInt(r.ubicacion),
    estado: parseInt(r.estado)
  };
  const { data, error } = await supabase.from("recurso").update(cambios).eq("id", req.params.id).select("id");
  if (error) return responderError(res, error, "El número de serie ya existe");
  if (data.length === 0) return res.status(404).json("Error actualizando el recurso.");
  res.status(200).json("El recurso se ha actualizado en la base de datos.");
});

app.get("/api/recursos/:id/reservas", async (req, res) => {
  const { data, error } = await supabase
    .from("reservas")
    .select("*")
    .eq("recurso", req.params.id)
    .order("fecha_peticion");
  if (error) return responderError(res, error);
  res.status(200).json(data);
});

app.get("/api/recursos/:id/resenyas", async (req, res) => {
  const { data, error } = await supabase
    .from("resenyas")
    .select("*")
    .eq("recurso", req.params.id)
    .order("fecha");
  if (error) return responderError(res, error);
  res.status(200).json(data);
});

app.delete("/api/recursos/:id", async (req, res) => {
  // Sus reservas y reseñas se borran solas (ON DELETE CASCADE en la BD)
  const { data, error } = await supabase.from("recurso").delete().eq("id", req.params.id).select("id");
  if (error) return responderError(res, error);
  if (data.length === 0) return res.status(404).json("No se ha encontrado el recurso para eliminar.");
  res.status(200).json("Recurso eliminado correctamente.");
});

// En Render el puerto lo asigna la plataforma (variable PORT); en local se usa el 3000
var puerto = process.env.PORT || 3000;
app.listen(puerto, () => {
  console.log("Servidor en el puerto " + puerto);
});
